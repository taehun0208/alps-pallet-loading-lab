import { candidateOrigins } from './vendor/pallet/candidates';
import { frontierOrigins, balancedOrigins, geometricFeasible, type RawCandidate } from './vendor/pallet/frontier';
import { inspectConstraints } from './vendor/pallet/constraints';
import { allowedOrientations } from './vendor/pallet/orientations';
import { oriented, landingHeight, top, EPS } from './vendor/pallet/geometry';
import { features, terms } from './vendor/pallet/features';
import { rng } from './vendor/pallet/scenarios';
import { fingerprint } from './vendor/pallet/benchmark/statistics';
import type { Candidate, Observation, Placement, PlanningInput, DecisionRequest } from './types';

export const DENSE_POLICY_VERSION='floor-dense/2';
export const DENSE_PRIORITY=[
 'lowest placement bottom z', 'least exact newly buried column void',
 'least narrow side-strip proxy', 'most side contact with the same top height',
 'most box-side / pallet-edge contact', 'smallest occupied XY bounding rectangle',
 'lowest global top', 'smallest horizontal cargo CoG offset', 'lowest cargo CoG',
 'deterministic y, x and orientation tie break',
] as const;
/** Newly covered air between the previous local skyline and this box bottom.
 * Exact footprint-cell integration, excluding pre-existing cavities under older boxes.
 */
export function newColumnVoid(box:Placement,stack:Placement[]):number{
 if(box.position.z<=EPS)return 0;
 const left=box.position.x,right=left+box.size.w,front=box.position.y,back=front+box.size.d;
 const overlapping=stack.filter(p=>p.position.x<right-EPS&&p.position.x+p.size.w>left+EPS&&p.position.y<back-EPS&&p.position.y+p.size.d>front+EPS);
 const xs=[...new Set([left,right,...overlapping.flatMap(p=>[Math.max(left,p.position.x),Math.min(right,p.position.x+p.size.w)])])].sort((a,b)=>a-b);
 const ys=[...new Set([front,back,...overlapping.flatMap(p=>[Math.max(front,p.position.y),Math.min(back,p.position.y+p.size.d)])])].sort((a,b)=>a-b);
 let amount=0;
 for(let x=1;x<xs.length;x++)for(let y=1;y<ys.length;y++){
  const mx=(xs[x]+xs[x-1])/2,my=(ys[y]+ys[y-1])/2;
  const before=Math.max(0,...overlapping.filter(p=>mx>=p.position.x&&mx<p.position.x+p.size.w&&my>=p.position.y&&my<p.position.y+p.size.d).map(top));
  amount+=(xs[x]-xs[x-1])*(ys[y]-ys[y-1])*Math.max(0,box.position.z-before);
 }
 return amount;
}
function faceContacts(box:Placement,input:PlanningInput){
 const p=box.position,s=box.size,pallet=input.pallet;
 let contact=0,sameTop=0;
 // Pallet edges are virtual packing boundaries, not load-bearing walls.
 if(Math.abs(p.x)<EPS)contact+=s.d*s.h;if(Math.abs(p.x+s.w-pallet.width)<EPS)contact+=s.d*s.h;
 if(Math.abs(p.y)<EPS)contact+=s.w*s.h;if(Math.abs(p.y+s.d-pallet.depth)<EPS)contact+=s.w*s.h;
 for(const other of input.placements){
  const dz=Math.max(0,Math.min(top(box),top(other))-Math.max(p.z,other.position.z));if(dz<=EPS)continue;
  let length=0;
  if(Math.abs(p.x+s.w-other.position.x)<EPS||Math.abs(other.position.x+other.size.w-p.x)<EPS)length+=Math.max(0,Math.min(p.y+s.d,other.position.y+other.size.d)-Math.max(p.y,other.position.y));
  if(Math.abs(p.y+s.d-other.position.y)<EPS||Math.abs(other.position.y+other.size.d-p.y)<EPS)length+=Math.max(0,Math.min(p.x+s.w,other.position.x+other.size.w)-Math.max(p.x,other.position.x));
  contact+=length*dz;if(Math.abs(top(other)-top(box))<EPS)sameTop+=length;
 }
 return {contact,sameTop};
}
/** Finite side-strip heuristic: narrow gaps between this box and an adjacent side
 * obstacle/wall, compared with the smallest known remaining footprint width/depth.
 * Corner strips can overlap. This is a tie-breaking proxy, not inaccessible area.
 */
function narrowSideStrips(box:Placement,input:PlanningInput){
 const remaining=input.types.filter(t=>(input.remaining[t.id]??0)>0);
 if(!remaining.length)return 0;
 const sizes=remaining.flatMap(t=>allowedOrientations(t.size,t.orientations,t.handling,t.maxLoadByAxis).map(o=>oriented(t.size,o)));
 const minX=Math.min(...sizes.map(s=>s.w)),minY=Math.min(...sizes.map(s=>s.d));
 let total=0;
 for(const axis of ['x','y'] as const){
  const along=axis==='x'?'y':'x',width=axis==='x'?'w':'d',length=axis==='x'?'d':'w',limit=axis==='x'?input.pallet.width:input.pallet.depth,min=axis==='x'?minX:minY;
  const start=box.position[along],end=start+box.size[length];
  const neighbors=input.placements.filter(p=>top(p)>box.position.z+EPS&&p.position.z<top(box)-EPS&&p.position[along]<end-EPS&&p.position[along]+p.size[length]>start+EPS);
  const edges=[...new Set([start,end,...neighbors.flatMap(p=>[Math.max(start,p.position[along]),Math.min(end,p.position[along]+p.size[length])])])].sort((a,b)=>a-b);
  for(let i=1;i<edges.length;i++){
   const mid=(edges[i]+edges[i-1])/2,cover=neighbors.filter(p=>mid>=p.position[along]&&mid<p.position[along]+p.size[length]);
   let before=box.position[axis],after=limit-box.position[axis]-box.size[width];
   for(const p of cover){const right=p.position[axis]+p.size[width];if(right<=box.position[axis]+EPS)before=Math.min(before,box.position[axis]-right);if(p.position[axis]>=box.position[axis]+box.size[width]-EPS)after=Math.min(after,p.position[axis]-box.position[axis]-box.size[width]);}
   for(const gap of [before,after])if(gap>EPS&&gap<min-EPS)total+=gap*(edges[i]-edges[i-1]);
  }
 }
 return total;
}
export function denseRank(box:Placement,input:PlanningInput):number[]{
 const stack=[...input.placements,box],mass=stack.reduce((s,p)=>s+p.weight,0);
 const cx=stack.reduce((s,p)=>s+p.weight*(p.position.x+p.size.w/2),0)/mass,cy=stack.reduce((s,p)=>s+p.weight*(p.position.y+p.size.d/2),0)/mass,cz=stack.reduce((s,p)=>s+p.weight*(p.position.z+p.size.h/2),0)/mass;
 const bounds=(Math.max(...stack.map(p=>p.position.x+p.size.w))-Math.min(...stack.map(p=>p.position.x)))*(Math.max(...stack.map(p=>p.position.y+p.size.d))-Math.min(...stack.map(p=>p.position.y)));
 const contacts=faceContacts(box,input);
 return [box.position.z,newColumnVoid(box,input.placements),narrowSideStrips(box,input),-contacts.sameTop,-contacts.contact,bounds,Math.max(...stack.map(top)),Math.hypot(cx-input.pallet.width/2,cy-input.pallet.depth/2),cz,box.position.y,box.position.x,box.orientation===0?0:1];
}
export function compareDenseRank(a:readonly number[],b:readonly number[]):number{
 for(let i=0;i<a.length;i++){const delta=a[i]-b[i];if(Math.abs(delta)>1e-7)return delta;}return 0;
}
const originKey=(r:RawCandidate)=>[r.position.x,r.position.y,r.position.z,r.size.w,r.size.d,r.size.h,r.orientation].join(':');
export function extraOrigins(input:PlanningInput,deadline:number){
 const raw:RawCandidate[]=[],clock=()=>performance.now();let complete=true;
 for(const orientation of allowedOrientations(input.current.size,input.current.orientationAllowed,input.current.handling,input.current.maxLoadByAxis)){
  if(clock()>=deadline){complete=false;break;}
  const size=oriented(input.current.size,orientation),base=frontierOrigins(input.pallet,size,input.placements,input.constraints.horizontalGap);
  raw.push(...base.map(position=>({position,size,orientation})));
  const balance=balancedOrigins(size,input.placements,input.current.weight),cx=(input.pallet.width-size.w)/2,cy=(input.pallet.depth-size.d)/2;
  balance.push({x:cx,y:cy,z:landingHeight(cx,cy,size,input.placements)});raw.push(...balance.map(position=>({position,size,orientation,balanceTarget:true})));
  // Exact edge-aligned coordinates plus midpoints between adjacent legal origin
  // coordinates expose corridor centers omitted by the original edge-only pool.
  const xs=[...new Set(base.map(p=>p.x).filter(x=>x>=0&&x+size.w<=input.pallet.width))].sort((a,b)=>a-b),ys=[...new Set(base.map(p=>p.y).filter(y=>y>=0&&y+size.d<=input.pallet.depth))].sort((a,b)=>a-b);
  const middle=(a:number[])=>a.slice(1).map((v,i)=>(v+a[i])/2),mx=middle(xs),my=middle(ys);
  for(const x of [...xs,...mx]){
   if(clock()>=deadline){complete=false;break;}
   for(const y of [...ys,...my])raw.push({position:{x,y,z:landingHeight(x,y,size,input.placements)},size,orientation});
  }
 }
 return {raw:[...new Map(raw.map(r=>[originKey(r),r])).values()].sort((a,b)=>a.position.z-b.position.z||a.position.y-b.position.y||a.position.x-b.position.x),complete};
}
export function fromOrigin(raw:RawCandidate,input:PlanningInput):Placement{
 const o=input.current;return {id:o.id,typeId:o.typeId,position:{...raw.position},size:{...raw.size},orientation:raw.orientation,weight:o.weight,supports:[],supportRatio:0,loadAbove:0,
  packaging:o.packaging,maxLoadKg:o.maxLoadKg,maxLoadSource:o.maxLoadSource,maxLoadByAxis:o.maxLoadByAxis,material:o.material,handling:o.handling,strengthFactor:o.strengthFactor,friction:o.friction};
}
interface DenseRoot { placement:Placement; path:Candidate['path']; rank:number[]; candidate?:Candidate }
function rootCandidate(root:DenseRoot,input:PlanningInput):Candidate{
 if(root.candidate)return root.candidate;
 const checked=inspectConstraints(root.placement,input.current,input.placements,input.pallet,input.constraints);
 if(checked.reasons.length)throw Error('A previously validated dense root became invalid');
 const f=features(checked.stack,input.pallet,checked.path.seconds,{...input,settings:{...input.settings,inventoryMode:'none'}}),t=terms(f,input.pallet,input.settings.weights,input.constraints.stability);
 return {id:`dense-${originKey(root.placement)}`,placement:checked.placement,valid:true,reasons:[],path:checked.path,features:f,terms:t,score:0,fastScore:0,future:null};
}
/** Paired sampled scenarios, identical for every root; no actual future arrivals.
 * Root candidates are constrained to the same minimum bottom z and minimum new void.
 * Volume first, count second, then predicted new void and the deterministic dense rank.
 */
function denseLookahead(input:PlanningInput,roots:DenseRoot[],deadline:number,publish:(candidate:Candidate)=>void){
 const depth=Math.min(4,Object.values(input.remaining).reduce((s,n)=>s+n,0)),samples=3;
 if(!depth||roots.length<2)return {candidate:null,completeScenarios:0,simulations:0,interrupted:false};
 const random=rng(parseInt(fingerprint({seed:input.settings.plannerSeed,current:input.current.id,remaining:input.remaining,policy:'dense-volume'}),16));
 const sequences=Array.from({length:samples},(_,sample)=>{
  const counts={...input.remaining},sequence:Observation[]=[];
  for(let at=0;at<depth;at++){
   let draw=random()*Object.values(counts).reduce((s,n)=>s+n,0);const t=input.types.find(t=>(draw-=counts[t.id]??0)<0)!;counts[t.id]--;
   sequence.push({id:`dense-forecast-${sample}-${at}-${t.id}`,typeId:t.id,size:{...t.size},weight:t.weight,status:'normal',orientationAllowed:[...t.orientations],maxLoadKg:t.maxLoadKg,maxLoadSource:t.maxLoadSource,maxLoadByAxis:t.maxLoadByAxis,material:t.material,handling:t.handling,strengthFactor:t.strengthFactor,friction:t.friction});
  }
  return sequence;
 });
 const totals=roots.map(()=>({volume:0,count:0,void:0}));let completeScenarios=0,simulations=0,interrupted=false,candidate:Candidate|null=null;
 for(const sequence of sequences){
  const results:{volume:number;count:number;void:number}[]=[];
  for(const root of roots){
   if(performance.now()>=deadline){interrupted=true;break;}
   let stack=inspectConstraints(root.placement,input.current,input.placements,input.pallet,input.constraints).stack,amount=0,count=0,voidAmount=0;
   const remaining={...input.remaining};let complete=true;
   for(const current of sequence){
    if(performance.now()>=deadline){complete=false;break;}remaining[current.typeId]--;
    const next:PlanningInput={...input,current,remaining:{...remaining},placements:stack,strategyState:undefined,settings:{...input.settings,inventoryMode:'none',maxCandidates:24}};
    const origins=candidateOrigins(next,true).budget;let chosen:ReturnType<typeof inspectConstraints>|null=null,rank:number[]|null=null;
    for(const raw of origins){
     if(performance.now()>=deadline){complete=false;break;}
     if(!geometricFeasible(raw,stack,input.pallet,input.constraints))continue;
     const checked=inspectConstraints(fromOrigin(raw,next),current,stack,input.pallet,input.constraints);if(checked.reasons.length)continue;
     const r=denseRank(checked.placement,next);if(!rank||compareDenseRank(r,rank)<0){chosen=checked;rank=r;}
    }
    if(!complete)break;
    if(chosen){voidAmount+=rank![1];stack=chosen.stack;amount+=current.size.w*current.size.d*current.size.h;count++;}
   }
   if(!complete){interrupted=true;break;}
   simulations++;results.push({volume:amount,count,void:voidAmount});
  }
  // Partial scenarios cannot bias a root merely because it was evaluated first.
  if(interrupted||results.length!==roots.length)break;
  results.forEach((r,i)=>{totals[i].volume+=r.volume;totals[i].count+=r.count;totals[i].void+=r.void;});completeScenarios++;
  const ranked=roots.map((root,i)=>({root,...totals[i]})).sort((a,b)=>b.volume-a.volume||b.count-a.count||a.void-b.void||compareDenseRank(a.root.rank,b.root.rank));
  const next=rootCandidate(ranked[0].root,input);if(performance.now()<deadline){candidate=next;publish(next);}else{interrupted=true;break;}
 }
 return {candidate,completeScenarios,simulations,interrupted};
}
export function searchFloorDense(request:DecisionRequest,baseCandidates:Candidate[],deadline:number,publish:(candidate:Candidate)=>void){
 const input=request.input,seen=new Set<string>();let best:Candidate|null=null,bestRank:number[]|null=null,checked=0,geometricRejected=0,hardRejected=0,dominated=0,generated=0,expired=false,extraComplete=true;
 const rootGroups=new Map<string,DenseRoot>();let rootTop:DenseRoot[]=[],rootPrefix:number[]|null=null;
 const remember=(root:DenseRoot)=>{
  const prefix=root.rank.slice(0,2),cmp=rootPrefix?compareDenseRank(prefix,rootPrefix):-1;
  if(cmp>0)return;if(cmp<0){rootGroups.clear();rootTop=[];rootPrefix=prefix;}
  const p=root.placement,q=Number(p.position.x+p.size.w/2>=input.pallet.width/2)+2*Number(p.position.y+p.size.d/2>=input.pallet.depth/2),key=`${q}:${p.orientation}`;
  const old=rootGroups.get(key);if(!old||compareDenseRank(root.rank,old.rank)<0)rootGroups.set(key,root);
  if(!rootTop.some(r=>originKey(r.placement)===originKey(p)))rootTop=[...rootTop,root].sort((a,b)=>compareDenseRank(a.rank,b.rank)).slice(0,2);
 };
 const accept=(candidate:Candidate)=>{const rank=denseRank(candidate.placement,input);if(performance.now()>=deadline){expired=true;return;}remember({placement:candidate.placement,path:candidate.path,rank,candidate});if(!bestRank||compareDenseRank(rank,bestRank)<0){best=candidate;bestRank=rank;publish(candidate);}};
 for(const c of baseCandidates){seen.add(originKey(c.placement));if(c.valid)accept(c);}
 const inspect=(raw:RawCandidate[])=>{
  generated+=raw.length;
  for(const r of raw){
   if(performance.now()>=deadline){expired=true;return;}
   const key=originKey(r);if(seen.has(key))continue;seen.add(key);
   if(bestRank&&r.position.z>bestRank[0]+EPS){dominated++;continue;}
   if(!geometricFeasible(r,input.placements,input.pallet,input.constraints)){geometricRejected++;continue;}
   const result=inspectConstraints(fromOrigin(r,input),input.current,input.placements,input.pallet,input.constraints);checked++;
   if(result.reasons.length){hardRejected++;continue;}
   const rank=denseRank(result.placement,input);if(performance.now()>=deadline){expired=true;return;}
   const root:DenseRoot={placement:result.placement,path:result.path,rank};remember(root);
   if(bestRank&&compareDenseRank(rank,bestRank)>=0)continue;
   const candidate=rootCandidate(root,input);
   if(performance.now()<deadline){best=candidate;bestRank=rank;publish(candidate);}else{expired=true;return;}
  }
 };
 if(performance.now()<deadline){const expanded={...input,settings:{...input.settings,maxCandidates:128}};inspect([...candidateOrigins(expanded,false).budget,...candidateOrigins(expanded,true).budget]);}
 if(!expired&&performance.now()<deadline){const extra=extraOrigins(input,deadline);extraComplete=extra.complete;inspect(extra.raw);}
 const roots=[...new Map([...rootTop,...[...rootGroups.values()].sort((a,b)=>compareDenseRank(a.rank,b.rank))].map(r=>[originKey(r.placement),r])).values()].slice(0,6);
 let future:ReturnType<typeof denseLookahead>={candidate:null,completeScenarios:0,simulations:0,interrupted:false};
 if(best&&!expired&&performance.now()<deadline)future=denseLookahead(input,roots,deadline,publish);
 if(future.candidate)best=future.candidate;
 if(performance.now()>=deadline)expired=true;
 return {candidate:best,simulations:future.simulations,completeScenarios:future.completeScenarios,diagnostics:{policy:DENSE_POLICY_VERSION,priority:DENSE_PRIORITY.join(' → '),rank:best?denseRank(best.placement,input):[],rootCandidates:baseCandidates.length,generatedOrigins:generated,uniqueOrigins:seen.size,fullConstraintChecks:checked,geometricRejected,hardRejected,lexicographicallyDominated:dominated,
  forecastRootCount:roots.length,forecastDepth:4,forecastScenarioCap:3,forecastCompleteScenarios:future.completeScenarios,forecastSimulations:future.simulations,forecastObjective:'same lowest z and least new void, then paired predicted added volume, count, predicted new void, dense rank',
  stop:expired?'search_deadline':extraComplete&&!future.interrupted?'enumerated_origins_and_forecasts_exhausted':'partial_search',candidatesComplete:extraComplete&&!expired?1:0}};
}
