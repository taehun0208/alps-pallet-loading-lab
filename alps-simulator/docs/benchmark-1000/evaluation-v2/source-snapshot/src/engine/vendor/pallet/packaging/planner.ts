import type { Candidate, Constraints, Observation, Pallet, Placement, Scenario } from '../types';
import { frontierOrigins } from '../frontier';
import { inspectConstraints } from '../constraints';
import { calculateLoads, contactsFor, intersects, landingHeight, oriented, top, volume, withLoads } from '../geometry';
import { virtualObservation } from '../remainingSites';
import { balance } from '../features';
import { rng } from '../rng';
import { massCenter, permittedOrientations } from './spec';
import { reachability } from './robot';

export const METHODS = {first:'First Fit',greedy:'Greedy Extreme Point',tetris:'3D Tetris Heuristic',future:'Future-aware Planner',robust:'Robust Future-aware Planner'} as const;
export type Method=keyof typeof METHODS;
export const WEIGHT_LABELS={space:'현재 공간 효율',support:'지지',load:'하중 여유',cog:'무게중심',flat:'평탄도',compatibility:'미래 큰 공간',access:'로봇 접근',height:'높이 비용',fragility:'파손 위험',cycle:'로봇 시간',failure:'미래 실패',future:'미래 강건성'};
export type PackageWeights=Record<keyof typeof WEIGHT_LABELS,number>;
export interface PackageSettings {seed:number;samples:20|50|100;depth:3|5|10;beamWidth:number;rootCandidates:number;maxCandidates:number;maxFutureChecks:number;weights:PackageWeights}
export const PACKAGE_SETTINGS:PackageSettings={seed:2026,samples:20,depth:5,beamWidth:10,rootCandidates:3,maxCandidates:96,maxFutureChecks:12000,weights:{space:24,support:18,load:16,cog:12,flat:8,compatibility:30,access:8,height:10,fragility:14,cycle:4,failure:30,future:25}};
export function validateSettings(s:PackageSettings){if(![20,50,100].includes(s.samples)||![3,5,10].includes(s.depth)||!Number.isInteger(s.seed)||!Number.isInteger(s.beamWidth)||s.beamWidth<1||s.beamWidth>30||!Number.isInteger(s.rootCandidates)||s.rootCandidates<1||s.rootCandidates>8||!Number.isInteger(s.maxCandidates)||s.maxCandidates<8||s.maxCandidates>256||!Number.isInteger(s.maxFutureChecks)||s.maxFutureChecks<100||s.maxFutureChecks>100000||Object.values(s.weights).some(v=>!Number.isFinite(v)||v<0||v>100))throw Error('탐색 설정 범위를 확인하세요.');}
export interface PackageCandidate {id:string;placement:Placement;valid:boolean;reasons:string[];path:Candidate['path'];score:number|null;terms:Partial<PackageWeights>;values:Partial<PackageWeights>;future:null|{mean:number;worst:number;robust:number;failure:number;samples:number;minDepth:number;maxDepth:number;capped:boolean};loads:Record<string,number>;maxLoadUtilization:number;reach:number;grasp:string|null;compatibility:number;regionArea:number;stack:Placement[]}
export interface PackageInput {scenario:Pick<Scenario,'pallet'|'types'|'constraints'>;placements:Placement[];current:Observation;remaining:Record<string,number>;method:Method;settings:PackageSettings;step:number}
export interface PackagePlan {contextSignature?:string;candidates:PackageCandidate[];selectedId:string|null;generated:number;checked:number;orientationRejected:number;orientationOptions:number;rejected:Record<string,number>;valid:number;milliseconds:number;futureChecks:number;cacheHits:number;sequences:string[][];capped:boolean}
type Rect={x:number;y:number;w:number;d:number};
// Disjoint obstacles split maximal axis-aligned rectangles. These are geometric space probes,
// not proof that a future box meets all physical constraints; rollouts run the full checker.
export function freeFloor(placed:Placement[],p:Pallet):Rect[]{
 let regions:Rect[]=[{x:0,y:0,w:p.width,d:p.depth}];
 for(const b of placed.filter(v=>v.position.z===0)){
  const bx=b.position.x,by=b.position.y,ex=bx+b.size.w,ey=by+b.size.d;
  regions=regions.flatMap(r=>{const rx=r.x+r.w,ry=r.y+r.d;if(bx>=rx||by>=ry||ex<=r.x||ey<=r.y)return [r];return [
   {x:r.x,y:r.y,w:bx-r.x,d:r.d},{x:ex,y:r.y,w:rx-ex,d:r.d},{x:r.x,y:r.y,w:r.w,d:by-r.y},{x:r.x,y:ey,w:r.w,d:ry-ey},
  ].filter(v=>v.w>0&&v.d>0);});
  regions=regions.filter((r,i,a)=>!a.some((q,j)=>i!==j&&(q.w*q.d>r.w*r.d||j<i)&&q.x<=r.x&&q.y<=r.y&&q.x+q.w>=r.x+r.w&&q.y+q.d>=r.y+r.d)).sort((a,b)=>b.w*b.d-a.w*a.d).slice(0,64);
 }return regions;
}
export function futureSpace(placed:Placement[],input:Pick<PackageInput,'scenario'|'remaining'>){
 const {pallet,types}=input.scenario,regions=freeFloor(placed,pallet),large=types.filter(t=>input.remaining[t.id]>0).sort((a,b)=>volume(b.size)-volume(a.size)).slice(0,3),loads=calculateLoads(placed);let total=0,value=0;
 for(const t of large){const quantity=input.remaining[t.id],mass=volume(t.size)*quantity;total+=mass;let fit=0;
  for(const o of t.packaging?permittedOrientations(t.packaging):t.orientations){const s=oriented(t.size,o);for(const r of regions)if(s.w<=r.w&&s.d<=r.d&&s.h<=pallet.maxHeight)fit=Math.max(fit,Math.min(quantity,Math.floor(r.w/s.w)*Math.floor(r.d/s.d)));
   // A single strong, exposed upper support can also preserve a large usable surface.
   for(const b of placed)if(b.packaging?.stackable!==false&&s.w<=b.size.w&&s.d<=b.size.d&&top(b)+s.h<=pallet.maxHeight&&(b.packaging?.maxTopLoad??b.maxLoadKg??0)>=loads[b.id]+t.weight){const v={position:{...b.position,z:top(b)},size:s};if(!placed.some(other=>intersects(v,other)))fit=Math.max(fit,1);}
  }value+=mass*Math.min(1,fit/Math.max(1,quantity));
 }
 return {value:total?value/total:1,area:Math.max(0,...regions.map(r=>r.w*r.d)),regions};
}
function classify(reason:string){return /회전|Orientation|방향 유지/.test(reason)?'orientation':/경계|최대 적재|바닥 아래/.test(reason)?'boundary':/겹침/.test(reason)?'collision':/하중|적재 금지|LOAD/.test(reason)?'load':/지지|무게중심|기둥|SUPPORT/.test(reason)?'support':'robot';}
function scored(c:PackageCandidate,input:PackageInput,futureProbe:boolean){
 const {pallet}=input.scenario,stack=c.stack,b=c.placement,height=Math.max(1,...stack.map(top)),center=balance(stack,pallet).center,totalVolume=stack.reduce((n,b)=>n+volume(b.size),0),space=totalVolume/(pallet.width*pallet.depth*height),cog=1-Math.min(1,Math.hypot(center.x-pallet.width/2,center.y-pallet.depth/2)/Math.hypot(pallet.width/2,pallet.depth/2));
 const mean=stack.reduce((n,b)=>n+top(b),0)/stack.length,spread=Math.sqrt(stack.reduce((n,b)=>n+(top(b)-mean)**2,0)/stack.length)/pallet.maxHeight;
 const future=futureProbe?futureSpace(stack,input):{value:0,area:0};c.compatibility=future.value;c.regionArea=future.area;
 let fragility=0;for(const s of stack){const spec=s.packaging,load=c.loads[s.id]||0;fragility+=(spec?.fragility==='HIGH'?1:spec?.fragility==='MEDIUM'?.4:0)*load/Math.max(1,spec?.maxTopLoad??100);}
 // Preserve strong bases: fragile incoming cartons also incur the risk of still being buried.
 fragility+=b.packaging?.fragility==='HIGH'?.25*Math.max(0,1-top(b)/pallet.maxHeight):0;
 const values:Partial<PackageWeights>={space,support:b.supportRatio,load:1-Math.min(1,c.maxLoadUtilization),cog,flat:1-Math.min(1,spread),compatibility:future.value,access:input.scenario.constraints.packagingRobot?Math.max(0,1-c.reach/input.scenario.constraints.packagingRobot.maxReach):1,height:-top(b)/pallet.maxHeight*(1+b.weight/input.scenario.constraints.gripper.payload),fragility:-fragility,cycle:-c.path.seconds/30,failure:0,future:0};
 const terms:Partial<PackageWeights>={};for(const key of Object.keys(values) as (keyof PackageWeights)[])terms[key]=values[key]!*input.settings.weights[key];
 if(input.method==='first'||input.method==='greedy'||input.method==='tetris')terms.compatibility=0;
 if(input.method==='tetris'){terms.flat=(values.flat??0)*input.settings.weights.flat*2;terms.height=(values.height??0)*input.settings.weights.height*2;}
 c.values=values;c.terms=terms;c.score=Object.values(terms).reduce((a,b)=>a+b,0);return c;
}
function rolloutOrigins(p:Pallet,size:{w:number;d:number;h:number},placed:Placement[]){
 const points=new Map<string,{x:number;y:number}>();
 const add=(x:number,y:number)=>{if(x>=0&&y>=0&&x+size.w<=p.width&&y+size.d<=p.depth)points.set(`${x}:${y}`,{x,y});};
 for(const x of [0,p.width-size.w])for(const y of [0,p.depth-size.d])add(x,y);
 for(const b of placed){const x=b.position.x,y=b.position.y;for(const dx of [0,b.size.w-size.w])for(const dy of [0,b.size.d-size.d])add(x+dx,y+dy);add(x+b.size.w,y);add(x,y+b.size.d);add(x-size.w,y);add(x,y-size.d);}
 return [...points.values()].map(v=>({...v,z:landingHeight(v.x,v.y,size,placed)}));
}
export function candidates(input:PackageInput,limit=input.settings.maxCandidates,futureProbe=true){
 const {scenario:s,current,placements}=input,orientations=current.packaging?permittedOrientations(current.packaging).filter(o=>current.orientationAllowed.includes(o)):current.orientationAllowed;
 const raw=orientations.flatMap(orientation=>{const size=oriented(current.size,orientation);return (futureProbe?frontierOrigins(s.pallet,size,placements,s.constraints.horizontalGap):rolloutOrigins(s.pallet,size,placements)).map(position=>({size,position,orientation}));});
 const inside=(r:typeof raw[number])=>r.position.x>=0&&r.position.y>=0&&r.position.x+r.size.w<=s.pallet.width&&r.position.y+r.size.d<=s.pallet.depth&&top(r as Placement)<=s.pallet.maxHeight;
 raw.sort((a,b)=>Number(inside(b))-Number(inside(a))||a.position.z-b.position.z||a.position.y-b.position.y||a.position.x-b.position.x);
 // Fair deterministic sampling across orientations, heights, and corners before expensive physics.
 const buckets=new Map<string,typeof raw>();for(const r of raw){const key=`${r.orientation}:${r.position.z}:${Number(r.position.x+r.size.w/2>s.pallet.width/2)}:${Number(r.position.y+r.size.d/2>s.pallet.depth/2)}:${inside(r)}`;const v=buckets.get(key)??[];v.push(r);buckets.set(key,v);}
 const budget:typeof raw=[];for(let i=0;budget.length<limit;i++){let any=false;for(const b of buckets.values())if(b[i]&&budget.length<limit){budget.push(b[i]);any=true;}if(!any)break;}
 const checked=budget.map((r,i):PackageCandidate=>{
  const box:Placement={...current,...r,supports:[],supportRatio:0,loadAbove:0},inspected=inspectConstraints(box,current,placements,s.pallet,s.constraints),loads=calculateLoads(inspected.stack);
  const maxLoadUtilization=Math.max(0,...inspected.stack.map(b=>{const cap=b.packaging?.maxTopLoad??b.maxLoadKg??100;return cap?loads[b.id]/cap:loads[b.id]>0?Infinity:0;}));
  const target=inspected.path.points.find(p=>p.label==='내려놓기')?.tcp??massCenter(box),reach=s.constraints.packagingRobot?reachability(target,s.constraints.packagingRobot).distance:0;
  const c:PackageCandidate={id:`pkg-${i}`,placement:inspected.placement,valid:!inspected.reasons.length,reasons:inspected.reasons,path:inspected.path,score:null,terms:{},values:{},future:null,loads,maxLoadUtilization,reach,grasp:inspected.path.graspFace??null,compatibility:0,regionArea:0,stack:withLoads(inspected.stack)};
  // No score is assigned to rejected candidates.
  return c.valid?scored(c,input,futureProbe):c;
 });return {candidates:checked,generated:raw.length,orientationRejected:6-orientations.length,orientationOptions:6,capped:raw.length>limit};
}
export function virtualSequences(remaining:Record<string,number>,settings:PackageSettings,step=0):string[][]{
 const random=rng(settings.seed+step*7919),entries=Object.entries(remaining).sort(([a],[b])=>a.localeCompare(b));
 return Array.from({length:settings.samples},()=>{const counts=Object.fromEntries(entries),seq:string[]=[];for(let d=0;d<settings.depth;d++){let total=Object.values(counts).reduce((a,b)=>a+b,0);if(!total)break;let k=random()*total;for(const [id] of entries){k-=counts[id];if(k<0){seq.push(id);counts[id]--;break;}}}return seq;});
}
export function robustStatistics(scores:number[]){const sorted=[...scores].sort((a,b)=>a-b),mean=scores.reduce((a,b)=>a+b,0)/Math.max(1,scores.length),worst=sorted.slice(0,Math.max(1,Math.ceil(sorted.length*.1))).reduce((a,b)=>a+b,0)/Math.max(1,Math.ceil(sorted.length*.1));return {mean,worst,robust:.7*mean+.3*worst};}
const rank=(a:PackageCandidate,b:PackageCandidate)=>(b.score??-Infinity)-(a.score??-Infinity)||a.id.localeCompare(b.id);
export function planPackaging(input:PackageInput):PackagePlan{
 validateSettings(input.settings);const started=performance.now(),root=candidates(input),valid=root.candidates.filter(c=>c.valid).sort(rank),sequences=virtualSequences(input.remaining,input.settings,input.step);let checks=0,hits=0,capped=root.capped;
 const useFuture=input.method==='future'||input.method==='robust',shortlist=valid.slice(0,input.settings.rootCandidates),cache=new Map<string,{children:PackageCandidate[];count:number}>();
 if(useFuture&&sequences.some(s=>s.length)){
  const perRun=Math.max(8,Math.floor(input.settings.maxFutureChecks/Math.max(1,shortlist.length*sequences.length)));
  for(const initial of shortlist){const scores:number[]=[],failures:number[]=[],depths:number[]=[];let incomplete=false;
   for(const sequence of sequences){
    type State={stack:Placement[];value:number;failures:number;key:string};
    let beam:State[]=[{stack:initial.stack,value:0,failures:0,key:initial.id}],used=0,completed=0;
    for(let d=0;d<sequence.length;d++){
     const type=input.scenario.types.find(t=>t.id===sequence[d]);if(!type)throw Error('알 수 없는 잔량 종류');
     const next:State[]=[],levelBudget=Math.max(8,Math.floor((perRun-used)/Math.max(1,sequence.length-d)));let levelUsed=0;
     for(const state of beam){const key=`${state.key}/${d}:${type.id}`;let found=cache.get(key);
      if(!found){if(used+8>perRun||levelUsed+8>levelBudget){incomplete=true;continue;}const context={...input,current:virtualObservation(type,`future-${d}`),placements:state.stack,remaining:{},method:'greedy' as const},result=candidates(context,8,false);found={children:result.candidates.filter(v=>v.valid).sort(rank).slice(0,3),count:result.candidates.length};cache.set(key,found);used+=found.count;levelUsed+=found.count;checks+=found.count;}else hits++;
      if(!found.children.length)next.push({...state,failures:state.failures+1,value:state.value-1,key:`${key}:fail`});
      else for(const child of found.children){const added=volume(child.placement.size)/(input.scenario.pallet.width*input.scenario.pallet.depth*input.scenario.pallet.maxHeight);next.push({stack:child.stack,value:state.value+1+added,failures:state.failures,key:`${key}:${child.id}`});}
     }
     if(!next.length){incomplete=true;break;}
     // Each sample maintains at most N states at every depth; no true arrival queue enters here.
     beam=next.sort((a,b)=>b.value-a.value||a.key.localeCompare(b.key)).slice(0,input.settings.beamWidth);completed++;
    }
    const best=beam[0],unexplored=sequence.length-completed;incomplete ||= unexplored>0;
    scores.push(Math.max(-1,Math.min(1,best.value/Math.max(1,sequence.length))));failures.push((best.failures+unexplored)/Math.max(1,sequence.length));depths.push(completed);
   }
   const stats=robustStatistics(scores),failure=failures.reduce((a,b)=>a+b,0)/failures.length;initial.future={...stats,failure,samples:scores.length,minDepth:Math.min(...depths),maxDepth:Math.max(...depths),capped:incomplete};
   const f=input.method==='robust'?stats.robust:stats.mean;initial.values.future=f;initial.values.failure=-failure;initial.terms.future=input.settings.weights.future*f;initial.terms.failure=-input.settings.weights.failure*failure;initial.score=Object.values(initial.terms).reduce((a,b)=>a+b,0);capped ||= incomplete;
  }
 }
 const selected=input.method==='first'?root.candidates.find(c=>c.valid):useFuture&&shortlist.length?shortlist.sort(rank)[0]:valid[0];
 const rejected:Record<string,number>={orientation:0,boundary:0,collision:0,load:0,support:0,robot:0};for(const c of root.candidates.filter(c=>!c.valid))for(const category of new Set(c.reasons.map(classify)))rejected[category]++;
 return {...root,checked:root.candidates.length,selectedId:selected?.id??null,valid:valid.length,rejected,milliseconds:performance.now()-started,futureChecks:checks,cacheHits:hits,sequences:useFuture?sequences:[],capped};
}
// Adapter retains the existing Three.js scene, camera, selection, and CoG marker.
export function sceneCandidate(c:PackageCandidate):Candidate{return {id:c.id,placement:c.placement,valid:c.valid,reasons:c.reasons,path:c.path,score:c.score??-Infinity,fastScore:c.score??-Infinity,future:null,terms:{} as Candidate['terms'],features:{} as Candidate['features']};}

