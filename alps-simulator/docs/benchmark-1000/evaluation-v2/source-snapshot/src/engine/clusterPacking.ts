import {candidateOrigins} from './vendor/pallet/candidates';
import {geometricFeasible} from './vendor/pallet/frontier';
import {inspectConstraints} from './vendor/pallet/constraints';
import {features,terms} from './vendor/pallet/features';
import {extraOrigins,fromOrigin,denseRank,compareDenseRank} from './floorDense';
import {contact,department} from '../metrics/clustering';
import type {Candidate,DecisionRequest,Placement,PlanningInput} from './types';

export const CLUSTER_POLICY_VERSION='cluster-packing/1';
/** Floor first and exact new buried void first for all three policies.
 * Only the tie-breaking objective changes. Deliberately dispersed is an artificial
 * negative control; it still obeys every shared physical constraint.
 */
export function clusterRank(box:Placement,input:PlanningInput,policy:DecisionRequest['algorithm']){
 const dense=denseRank(box,input);let same=0,zone=0,total=0;
 for(const other of input.placements){const c=contact(box,other);total+=c.area;if(box.typeId===other.typeId)same+=c.area;if(department(box.typeId)===department(other.typeId))zone+=c.area;}
 const norm=2*(box.size.w*box.size.d+box.size.w*box.size.h+box.size.d*box.size.h);
 const purity=same/norm,zonePurity=zone/norm;
 // Layer policy allows same-SKU preference only inside a 250mm bottom-height band.
 // Connected policy considers every valid upper-layer height after filling the floor.
 const layer=policy==='cluster-layer'?0:Math.floor(box.position.z/250);
 return [box.position.z<1e-5?0:1,dense[1],layer,policy==='dispersed'?purity:-purity,
  policy==='dispersed'?zonePurity:-zonePurity,dense[0],dense[2],-total,...dense.slice(3)];
}
export function searchCluster(request:DecisionRequest,base:Candidate[],deadline:number,publish:(candidate:Candidate)=>void){
 const input=request.input,seen=new Set<string>();let best:Candidate|null=null,rank:number[]|null=null,checks=0;
 const key=(p:Placement)=>[...Object.values(p.position),...Object.values(p.size)].join(':');
 const consider=(candidate:Candidate)=>{const r=clusterRank(candidate.placement,input,request.algorithm);if(performance.now()<deadline&&(!rank||compareDenseRank(r,rank)<0)){best=candidate;rank=r;publish(candidate);}};
 for(const c of base)if(c.valid){seen.add(key(c.placement));consider(c);}
 const expanded={...input,settings:{...input.settings,maxCandidates:128}};
 const origins=[...candidateOrigins(expanded,false).budget,...candidateOrigins(expanded,true).budget,...extraOrigins(input,deadline).raw];
 for(const raw of origins){
  if(performance.now()>=deadline)break;
  const proposal=fromOrigin(raw,input),k=key(proposal);if(seen.has(k))continue;seen.add(k);
  if(!geometricFeasible(raw,input.placements,input.pallet,input.constraints))continue;
  const check=inspectConstraints(proposal,input.current,input.placements,input.pallet,input.constraints);checks++;if(check.reasons.length)continue;
  const r=clusterRank(check.placement,input,request.algorithm);if(rank&&compareDenseRank(r,rank)>=0)continue;
  const f=features(check.stack,input.pallet,check.path.seconds,{...input,settings:{...input.settings,inventoryMode:'none'}});
  consider({id:`cluster-${k}`,placement:check.placement,valid:true,reasons:[],path:check.path,features:f,terms:terms(f,input.pallet,input.settings.weights,input.constraints.stability),score:0,fastScore:0,future:null});
 }
 return {candidate:best,diagnostics:{policy:CLUSTER_POLICY_VERSION,mode:request.algorithm,fullConstraintChecks:checks,origins:seen.size,rank:rank??[],stop:performance.now()>=deadline?'deadline':'finite_pool_exhausted'}};
}
