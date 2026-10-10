import { permittedOrientations } from './packaging/spec';
export const candidateMeter={calls:0,generated:0,checked:0};
import { orientationRank,allowedOrientations } from './orientations';
import { oriented,sparseOrigins,top,landingHeight } from './geometry';
import { frontierOrigins,diverseBudget,balancedOrigins } from './frontier';
import { surface } from './surface';
import { inspectConstraints } from './constraints';
import { features,terms } from './features';
import { emptyInventory } from './inventory';
import type { Candidate,PlanningInput,Placement } from './types';
export function candidateOrigins(input:PlanningInput,supportTargets=false){
 const {current,pallet,placements,constraints,settings}=input;
 const raw=(current.packaging?permittedOrientations(current.packaging).filter(o=>current.orientationAllowed.includes(o)):allowedOrientations(current.size,current.orientationAllowed,current.handling,current.maxLoadByAxis)).flatMap(orientation=>{const size=oriented(current.size,orientation);const origins=(settings.candidateMode==='frontier'?frontierOrigins:sparseOrigins)(pallet,size,placements,constraints.horizontalGap).map(position=>({position,size,orientation,balanceTarget:false}));
  if(supportTargets){const targets=balancedOrigins(size,placements,current.weight);if(settings.policy==='online'){const x=(pallet.width-size.w)/2,y=(pallet.depth-size.d)/2;targets.push({x,y,z:landingHeight(x,y,size,placements)});}
   for(const position of targets){const existing=origins.find(r=>Math.abs(r.position.x-position.x)<1e-6&&Math.abs(r.position.y-position.y)<1e-6);if(existing)existing.balanceTarget=true;else origins.push({position,size,orientation,balanceTarget:true});}}return origins;});
 raw.sort((a,b)=>{const inside=(v:typeof a)=>v.position.x>=0&&v.position.y>=0&&v.position.x+v.size.w<=pallet.width&&v.position.y+v.size.d<=pallet.depth;return Number(inside(b))-Number(inside(a))||a.position.z-b.position.z||a.position.y-b.position.y||a.position.x-b.position.x||orientationRank(a.orientation)-orientationRank(b.orientation);});
 const budget=settings.candidateMode==='frontier'?diverseBudget(raw,placements,pallet,constraints,settings.maxCandidates,settings.stockPolicy==='compact',settings.interiorPacking):raw.slice(0,settings.maxCandidates);return {budget,generated:raw.length,capped:raw.length>settings.maxCandidates};
}
export const slotKey=(b:Pick<Placement,'position'|'size'>)=>[b.position.x,b.position.y,b.position.z,b.size.w,b.size.d,b.size.h].join(':');
export function candidateSet(input:PlanningInput,supportTargets=false,extra:Placement[]=[]){
 const {current,pallet,placements,constraints,settings}=input,root=candidateOrigins(input,supportTargets),budget=[...root.budget],baseMap=surface(placements,pallet);
 const keys=new Set(budget.map(slotKey));
 for(const b of extra)if(!keys.has(slotKey(b))){keys.add(slotKey(b));budget.push({position:b.position,size:b.size,orientation:b.orientation,balanceTarget:false});}
 const candidates:Candidate[]=budget.map((r,i)=>{
  const inspected=inspectConstraints({packaging:current.packaging,id:current.id,typeId:current.typeId,position:r.position,size:r.size,orientation:r.orientation,weight:current.weight,supports:[],supportRatio:0,loadAbove:0,maxLoadKg:current.maxLoadKg,maxLoadSource:current.maxLoadSource,handling:current.handling,material:current.material,maxLoadByAxis:current.maxLoadByAxis,strengthFactor:current.strengthFactor,friction:current.friction},current,placements,pallet,constraints);
  const f=inspected.reasons.length?{maxHeight:top(inspected.placement),meanHeight:0,roughness:0,blockedVolume:0,flatRatio:0,imbalance:0,workSeconds:inspected.path.seconds,slenderness:0,loadUtilization:0,lowerBalance:0,inventory:emptyInventory()}:features(inspected.stack,pallet,inspected.path.model==='ideal'?0:inspected.path.seconds,input,baseMap),t=terms(f,pallet,settings.weights,constraints.stability);
  if(settings.policy==='online')t.lowerBalance=-2*(settings.weights.balance+settings.weights.stability)*(f.lowerBalance??0);
  const score=Object.values(t).reduce((a,b)=>a+b,0);
  return {id:`c${i}`,placement:inspected.placement,valid:!inspected.reasons.length,reasons:inspected.reasons,path:inspected.path,features:f,terms:t,fastScore:score,score,future:null,remainingCheck:settings.policy==='online'?'pending':undefined};
 });candidateMeter.calls++;candidateMeter.generated+=root.generated;candidateMeter.checked+=candidates.length;return {candidates,generated:root.generated,capped:root.capped};
}
