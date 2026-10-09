import { allowedOrientations } from './orientations';
import { oriented,volume } from './geometry';
import { frontierOrigins,balancedOrigins,diverseBudget } from './frontier';
import { inspectConstraints } from './constraints';
import type { PlanningInput,Placement,Observation,BoxType,RemainingSites } from './types';
export function virtualObservation(type:BoxType,id:string):Observation{return {id,typeId:type.id,size:{...type.size},weight:type.weight,status:'normal',orientationAllowed:[...type.orientations],packaging:type.packaging,maxLoadKg:type.maxLoadKg,maxLoadSource:type.maxLoadSource,maxLoadByAxis:type.maxLoadByAxis,handling:type.handling,material:type.material,strengthFactor:type.strengthFactor,friction:type.friction};}

// Bounded, fully checked one-box opportunities. A site count is not a packing-capacity guarantee.
export function remainingSites(input:PlanningInput,placed:Placement[]):RemainingSites{
 const types:RemainingSites['types']=[];let tested=0,demand=0,fitDemand=0,opportunity=0;
 for(const type of input.types){const quantity=input.remaining[type.id]||0;if(quantity<=0)continue;
  const observation=virtualObservation(type,`reserve-${type.id}`),raw=allowedOrientations(type.size,type.orientations,type.handling,type.maxLoadByAxis).flatMap(orientation=>{const size=oriented(type.size,orientation);
   const origins=frontierOrigins(input.pallet,size,placed,input.constraints.horizontalGap).map(position=>({position,size,orientation,balanceTarget:false}));
   for(const position of balancedOrigins(size,placed,type.weight)){const old=origins.find(r=>Math.abs(r.position.x-position.x)<1e-6&&Math.abs(r.position.y-position.y)<1e-6);if(old)old.balanceTarget=true;else origins.push({position,size,orientation,balanceTarget:true});}
   return origins;
  });
  const probes=diverseBudget(raw,placed,input.pallet,input.constraints,input.settings.reserveProbes??8);let fitSites=0,sampleSites=0;const reasons=new Set<string>();
  for(const r of probes){sampleSites++;tested++;const b:Placement={...observation,position:r.position,size:r.size,orientation:r.orientation,supports:[],supportRatio:0,loadAbove:0},check=inspectConstraints(b,observation,placed,input.pallet,input.constraints);
   if(!check.reasons.length)fitSites++;else for(const reason of check.reasons)reasons.add(reason.split(' · ')[0]);
  }
  if(!sampleSites)reasons.add('검토 위치에서 경계·높이·지지 조건을 만족하지 못함');
  const mass=quantity*volume(type.size);demand+=mass;fitDemand+=fitSites?mass:0;opportunity+=mass*(sampleSites?fitSites/sampleSites:0);
  types.push({id:type.id,quantity,fitSites,sampleSites,reasons:fitSites?[]:[...reasons]});
 }
 return {fitFraction:demand?fitDemand/demand:1,opportunity:demand?opportunity/demand:1,tested,types};
}
export function lostRemaining(input:PlanningInput,before:RemainingSites,after:RemainingSites){
 let demand=0,lost=0;for(const type of input.types){const v=(input.remaining[type.id]||0)*volume(type.size);demand+=v;if(before.types.find(t=>t.id===type.id)?.fitSites&&!after.types.find(t=>t.id===type.id)?.fitSites)lost+=v;}return demand?lost/demand:0;
}
