import {contactsFor} from '../geometry';
import {plan as legacyPlan} from '../planner';
import {scenario} from '../scenarios';
import {DEFAULT_SEARCH} from '../types';
import type {PlanningInput,Placement} from '../types';
import type {Box,Candidate,Config,Observed,Placed,Pose,SearchStats,Solid} from './types';
import {area,bounds,collides,EPS,worldParts} from './shape';
import {assess} from './mechanics';
import {suctionCandidates,transport} from './grasp';
export const baseline=(input:PlanningInput)=>legacyPlan(input);
export function baselineInput(box:Box,stack:Placed[],c:Config):PlanningInput{
 const s=scenario('mixed',c.seed),convert=(p:Placed):Placement=>({id:p.box.id,typeId:p.box.id,size:p.rotation===90?{w:p.box.nominal.d,d:p.box.nominal.w,h:p.box.nominal.h}:p.box.nominal,position:p.position,orientation:p.rotation,weight:p.box.mass,supports:[],supportRatio:1,loadAbove:0,material:'paper',maxLoadKg:p.box.strength.topLoadKg??undefined,strengthFactor:p.box.strength.residual});
 return{runId:'adaptive-baseline',stepId:stack.length,pallet:c.pallet,types:[{id:box.id,name:box.id,size:box.nominal,weight:box.mass,quantity:1,orientations:box.rotations,color:box.color,maxLoadKg:box.strength.topLoadKg??undefined}],constraints:{...s.constraints,supportRatio:c.supportRatio,contactTolerance:c.contactMm,stability:{...s.constraints.stability!,lateralAccelerationG:0,minMarginRatio:0,slendernessMode:'score'},gripper:{...s.constraints.gripper,payload:c.gripper.payloadKg},workspace:{xMin:-1400,xMax:5000,yMin:-1400,yMax:5000,zMax:c.workspaceHeight}},placements:stack.map(convert).map(p=>({...p,supports:contactsFor(p,stack.filter(v=>v.box.id!==p.id).map(convert),c.contactMm)})),current:{id:box.id,typeId:box.id,size:box.nominal,weight:box.mass,status:'normal',orientationAllowed:box.rotations,material:'paper',maxLoadKg:box.strength.topLoadKg??undefined,strengthFactor:box.strength.residual},remaining:{},algorithm:'greedy',settings:{...structuredClone(DEFAULT_SEARCH),policy:'legacy',maxCandidates:c.maxCandidates,inventoryMode:'none',portfolio:false}};
}
import {ancestors,buildGraph,extendGraph,observationKey,PlanningMemory,searchStats} from './dependency';
function contains(a:Solid,b:Solid){return b.x>=a.x-EPS&&b.y>=a.y-EPS&&b.z>=a.z-EPS&&b.x+b.w<=a.x+a.w+EPS&&b.y+b.d<=a.y+a.d+EPS&&b.z+b.h<=a.z+a.h+EPS;}
export function subtractSpace(spaces:Solid[],o:Solid,c:Config):Solid[]{
 const split=spaces.flatMap(s=>{
  if(!collides(s,o))return[s];const x=Math.max(s.x,o.x),y=Math.max(s.y,o.y),z=Math.max(s.z,o.z),r=Math.min(s.x+s.w,o.x+o.w),f=Math.min(s.y+s.d,o.y+o.d),t=Math.min(s.z+s.h,o.z+o.h);
  return[{...s,w:x-s.x},{...s,x:r,w:s.x+s.w-r},{...s,d:y-s.y},{...s,y:f,d:s.y+s.d-f},{...s,h:z-s.z},{...s,z:t,h:s.z+s.h-t}].filter(v=>Math.min(v.w,v.d,v.h)>EPS);
 });return split.filter((s,i,arr)=>!arr.some((o,j)=>i!==j&&contains(o,s)&&(j<i||!contains(s,o)))).sort((a,b)=>b.w*b.d*b.h-a.w*a.d*a.h).slice(0,c.maxEms);
}
export function emptySpaces(stack:Placed[],c:Config):Solid[]{return stack.reduce((spaces,p)=>subtractSpace(spaces,bounds(worldParts(p)),c),[{x:0,y:0,z:0,w:c.pallet.width,d:c.pallet.depth,h:c.pallet.maxHeight}]);}
export function generate(box:Box,stack:Placed[],c:Config,retainedSpaces?:Solid[]){
 const spaces=retainedSpaces||emptySpaces(stack,c),result:Pose[]=[],seen=new Set<string>();
 for(const rotation of box.rotations){const local=bounds(worldParts({box,rotation,position:{x:0,y:0,z:0}})),add=(x:number,y:number,z:number)=>{const p={position:{x:x-local.x,y:y-local.y,z:z-local.z},rotation},key=[x,y,z,rotation].join(':');if(!seen.has(key)){seen.add(key);result.push(p);}};
  for(const s of spaces)if(local.w<=s.w+EPS&&local.d<=s.d+EPS&&local.h<=s.h+EPS)for(const x of [s.x,s.x+s.w-local.w])for(const y of [s.y,s.y+s.d-local.d])add(x,y,s.z);
  for(const p of stack)for(const s of worldParts(p)){for(const x of [s.x,s.x+s.w-local.w])for(const y of [s.y,s.y+s.d-local.d])add(x,y,s.z+s.h);}
 }
 const obstacles=stack.map(p=>({bounds:bounds(worldParts(p)),parts:worldParts(p)}));
 return result.filter(p=>{const parts=worldParts({box,...p}),b=bounds(parts);return b.x>=-EPS&&b.y>=-EPS&&b.z>=-EPS&&b.x+b.w<=c.pallet.width+EPS&&b.y+b.d<=c.pallet.depth+EPS&&b.z+b.h<=c.pallet.maxHeight+EPS&&!obstacles.some(o=>collides(b,o.bounds,c.penetrationMm)&&parts.some(a=>o.parts.some(v=>collides(a,v,c.penetrationMm))));}).sort((a,b)=>a.position.z-b.position.z||a.position.y-b.position.y||a.position.x-b.position.x).slice(0,c.maxCandidates);
}
export function planObserved(arrived:Observed[],stack:Observed[],wait:Record<string,number>,c:Config,attempts:Record<string,number>={},memory?:PlanningMemory):{candidates:Candidate[];selected:Candidate|null;capped:boolean;stats?:SearchStats}{
 const start=performance.now(),deadline=start+c.timeBudgetMs,candidates:Candidate[]=[],stats=searchStats(),opt=c.mode==='C'&&c.ordering?.enabled?c.ordering:null;
 const known=arrived.map(v=>({id:v.box.id,rotations:v.box.rotations.map(rotation=>bounds(worldParts({box:v.box,rotation,position:{x:0,y:0,z:0}})))}));let capped=false;
 const spaces=opt?.spaceCache?emptySpaces(stack,c):undefined;if(spaces)stats.spaceUpdates+=stack.length;
 const graph=opt&&(opt.cdg||opt.dependencyWeight>0)?buildGraph(stack,c,opt.cdg?opt.removalChecks:0,deadline):null;
 let pool=c.mode==='C'&&c.features.buffer?arrived:[...arrived].slice(0,1);
 if(opt?.equivalence){const groups=new Map<string,Observed>(),priority=(v:Observed)=>c.weights.waiting*Math.min(1,(wait[v.box.id]||0)/c.maxWait)+c.weights.retry/(1+(attempts[v.box.id]||0));
  for(const p of pool){const key=observationKey(p)+(opt.prior?JSON.stringify(memory?.prior.get(p.box.id)?.pose||null):''),old=groups.get(key);if(!old||priority(p)>priority(old)||priority(p)===priority(old)&&p.box.id.localeCompare(old.box.id)<0)groups.set(key,p);}
  stats.equivalentSkipped=pool.length-groups.size;const ids=new Set([...groups.values()].map(p=>p.box.id));pool=pool.filter(p=>ids.has(p.box.id));
 }
 for(const observed of pool){
  const box=observed.box,grasps=suctionCandidates(box,c),grasp=grasps.find(g=>g.valid)||null,pickPoint=grasp?{x:grasp.point.x+observed.position.x,y:grasp.point.y+observed.position.y,z:grasp.point.z+observed.position.z}:undefined;
  if(c.mode==='A'){
   const old=baseline(baselineInput(box,stack,c)),chosen=old.candidates.find(v=>v.id===old.selectedId);
   for(const v of old.candidates.slice(0,12)){const pose={position:v.placement.position,rotation:v.placement.orientation as 0|90},mechanics=assess([...stack,{box,...pose}],c,box.id),motion=transport({box,...pose},stack,grasp,c);candidates.push({id:box.id+':'+v.id,boxId:box.id,...pose,score:v.score,terms:{baseline:v.score},reasons:v.reasons.length?['unavailable']:[],assessment:mechanics,grasp,pickPoint,grasps:grasps.slice(0,4),path:motion.path,seconds:motion.seconds});}
   if(chosen){let v=candidates.find(v=>v.id===box.id+':'+chosen.id);if(!v){const pose={position:chosen.placement.position,rotation:chosen.placement.orientation as 0|90},motion=transport({box,...pose},stack,grasp,c);v={id:box.id+':'+chosen.id,boxId:box.id,...pose,score:chosen.score,terms:{baseline:chosen.score},reasons:[],assessment:assess([...stack,{box,...pose}],c),grasp,pickPoint,grasps:grasps.slice(0,4),path:motion.path,seconds:motion.seconds};candidates.push(v);}return{candidates,selected:v,capped:old.capped};}continue;
  }
  const evaluate=(pose:Pose,id:string):Candidate=>{
   stats.checked++;const placement={box,...pose},a=assess([...stack,placement],c,box.id),motion=transport(placement,stack,grasp,c);
   const reasons=a.reasons.filter(r=>c.mode==='C'?(c.features.load||!['load','strength'].includes(r)):!['load','strength'].includes(r));
   if(c.mode==='C'&&c.features.suction&&!grasp)reasons.push('grasp');if(c.mode==='C'&&c.features.path)reasons.push(...motion.reasons);
   const envelope=bounds(worldParts(placement)),top=envelope.z+envelope.h,maxUtil=Math.max(0,...Object.values(a.loads).map(l=>l.capacityKg===null?0:l.aboveKg/Math.max(1e-6,l.capacityKg)));
   // Same EMS result/order/cap as a full rebuild; invalid candidates need no preference score.
   const free=opt?.spaceCache?(reasons.length?[]:subtractSpace(spaces!,envelope,c)):emptySpaces([...stack,placement],c);
   stats.spaceUpdates+=opt?.spaceCache?Number(!reasons.length):stack.length+1;
   const largest=Math.max(0,...free.map(s=>s.w*s.d*s.h)),container=c.pallet.width*c.pallet.depth*c.pallet.maxHeight;
   const future=known.filter(v=>v.id!==box.id),fit=future.length?future.filter(v=>v.rotations.some(b=>free.some(s=>b.w<=s.w&&b.d<=s.d&&b.h<=s.h))).length/future.length:1,parts=worldParts(placement),topArea=area(parts.filter(p=>Math.abs(p.z+p.h-top)<=c.contactMm)),footArea=area(parts);
   const terms:Record<string,number>={height:1-top/c.pallet.maxHeight,space:(largest/container+fit)/2,support:Math.min(1,a.supportRatio),load:Math.max(0,1-maxUtil),path:1/(1+motion.seconds/10),suction:grasp?.quality||0,waiting:Math.min(1,(wait[box.id]||0)/c.maxWait),retry:1/(1+(attempts[box.id]||0)),foundation:(topArea/Math.max(1,footArea))*(Math.min(1,footArea/(c.pallet.width*c.pallet.depth*.3)))*(1-pose.position.z/c.pallet.maxHeight)};
   if(c.frontFill&&c.environment==='roll')terms.space=(terms.space+1-pose.position.y/c.pallet.depth)/2;
   const sum=Object.values(c.weights).reduce((a,b)=>a+b,0);let score=Object.entries(terms).reduce((s,[k,v])=>s+Math.max(0,Math.min(1,v))*c.weights[k as keyof Config['weights']],0)/Math.max(1,sum);
   if(graph&&!reasons.length){const g=extendGraph(graph.graph,stack,placement,c,graph.paths,graph.meter,deadline,a),count=ancestors(g,box.id).size;terms.dependencyCount=count;terms.dependencyCost=count/Math.max(1,stack.length);score-=opt!.dependencyWeight*terms.dependencyCost;stats.dependencyEdges=Math.max(stats.dependencyEdges,g.edges.length);}
   return{id,boxId:box.id,...pose,reasons:[...new Set(reasons)],assessment:a,grasp,pickPoint,grasps:grasps.slice(0,4),path:motion.path,seconds:motion.seconds,terms,score};
  };
  let reused=false,checked=0;const prior=opt?.prior?memory?.prior.get(box.id):undefined,key=observationKey(observed);
  if(prior&&prior.key===key&&performance.now()<deadline){stats.priorChecks++;checked++;const candidate=evaluate(prior.pose,box.id+':prior');
   // Prior reuse always applies ALL constraints, even when an ablation disables a planning filter.
   const full=[...candidate.assessment.reasons,...(!grasp?['grasp']:[]),...transport({box,...prior.pose},stack,grasp,c).reasons];candidate.reasons=[...new Set([...candidate.reasons,...full])];candidates.push(candidate);
   if(!candidate.reasons.length){reused=true;stats.priorHits++;}else memory?.prior.delete(box.id);
  }
  if(!reused){const origins=generate(box,stack,c,spaces);if(!spaces)stats.spaceUpdates+=stack.length;
   for(let i=0;i<origins.length&&checked<c.maxCandidates;i++){
    if(performance.now()>deadline){capped=true;break;}const pose=origins[i];if(prior&&prior.key===key&&JSON.stringify(prior.pose)===JSON.stringify(pose))continue;
    candidates.push(evaluate(pose,box.id+':'+i));checked++;
   }
  }
  if(opt?.prior&&memory){const best=candidates.filter(v=>v.boxId===box.id&&!v.reasons.length).sort((a,b)=>b.score-a.score)[0];if(best)memory.prior.set(box.id,{key,pose:{position:{...best.position},rotation:best.rotation}});else memory.prior.delete(box.id);}
  if(capped)break;
 }
 if(memory){const ids=new Set(arrived.map(p=>p.box.id));for(const id of memory.prior.keys())if(!ids.has(id))memory.prior.delete(id);}
 if(graph)stats.dependencyChecks=graph.meter.checks;stats.capped=Number(capped);
 const valid=candidates.filter(v=>v.reasons.length===0).sort((a,b)=>b.score-a.score||a.boxId.localeCompare(b.boxId));
 return{candidates,selected:valid[0]||null,capped,stats};
}
