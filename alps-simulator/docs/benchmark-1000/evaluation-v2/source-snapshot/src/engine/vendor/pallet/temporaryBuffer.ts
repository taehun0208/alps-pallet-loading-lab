import { candidateSet } from './planner';
import { equilibrium } from './equilibrium';
import { top,EPS } from './geometry';
import type { BufferPlan,Candidate,DeferredBox,Observation,Placement,PlanningInput } from './types';

// One separate, floor-level staging pad. Admission also checks the real pickup
// sweep/workspace from this location; it is not free storage of unlimited size.
export const BUFFER_SOURCE={x:-1300,y:850,z:0};
export const BUFFER_SIZE={w:800,d:650};
const ctx=(input:PlanningInput,box:Observation,placed:Placement[]):PlanningInput=>({...input,available:undefined,buffer:undefined,current:box,placements:placed,remaining:{},settings:{...input.settings,policy:'legacy',inventoryMode:'none',temporaryBuffer:false,maxCandidates:Math.min(64,input.settings.maxCandidates)}});
function topSearch(input:PlanningInput,box:Observation,placed:Placement[]){
 const height=Math.max(0,...placed.map(top));if(height<=EPS)return {site:undefined,tested:0,generated:0,capped:false};
 const root=candidateSet(ctx(input,{...box,pickupPosition:{...BUFFER_SOURCE}},placed),true);
 return {tested:root.candidates.length,generated:root.generated,capped:root.capped,site:root.candidates.filter(c=>c.valid&&c.placement.position.z>=height-EPS).sort((a,b)=>top(a.placement)-top(b.placement)||b.score-a.score)[0]};
}
export const bufferTopSite=(input:PlanningInput,box:Observation,placed:Placement[])=>topSearch(input,box,placed).site;
const stackAfter=(input:PlanningInput,c:Candidate)=>equilibrium([...input.placements,c.placement]).placements;
export function chooseWithBuffer(input:PlanningInput,selected:Candidate|undefined,valid:Candidate[],choices:Candidate[]):{selected:Candidate|undefined;plan:BufferPlan;nodes:number;generated:number;capped:boolean;extra:Candidate[]}{
 let nodes=0,checkedPairs=0,generated=0,capped=false;const extra:Candidate[]=[],held=(input.buffer||[]).filter(h=>input.available?.some(b=>b.id===h.observation.id));
 const upper=(box:Observation,stack:Placement[])=>{checkedPairs++;const result=topSearch(input,box,stack);nodes+=result.tested;generated+=result.generated;capped||=result.capped;return result.site;};
 const result=(c:Candidate|undefined,after:DeferredBox[],addedIds:string[]=[],releasedId?:string)=>({selected:c,plan:{held:after,addedIds,releasedId,checkedPairs},nodes,generated,capped,extra});
 if(held.length){const h=held[0],others=valid.filter(c=>c.placement.id!==h.observation.id),options:Candidate[]=[];
  if(selected&&selected.placement.id!==h.observation.id)options.push(selected);
  for(const c of [...choices,...others])if(c.placement.id!==h.observation.id&&!options.some(o=>o.placement.id===c.placement.id)&&options.length<6)options.push(c);
  for(const c of others)if(!options.includes(c)&&options.length<8)options.push(c);
  // Keep the held box's complete, legal top placement available after each commit.
  for(const c of options){const site=upper(h.observation,stackAfter(input,c));if(site)return result(c,[{...h,reservedTop:site.placement}]);}
  const release=upper(h.observation,input.placements);
  if(release){release.id=`buffer-return:${h.observation.id}`;extra.push(release);return result(release,[],[],h.observation.id);}
  return result(undefined,held);
 }
 if(!selected)return result(selected,[]);
 const risky=choices.filter(c=>c===selected&&(c.reservation?.lostFraction||0)>EPS);
 let budget=0;
 for(const risk of risky){const box=input.available!.find(b=>b.id===risk.placement.id)!;
  if(box.size.w>BUFFER_SIZE.w||box.size.d>BUFFER_SIZE.d||box.handling==='upright'&&box.size.h>input.pallet.maxHeight)continue;
  const lost=risk.reservation!.before.types.filter(t=>t.fitSites>0&&!risk.reservation!.after.types.find(a=>a.id===t.id)?.fitSites);
  for(const t of lost){const alternative=valid.find(c=>c.placement.typeId===t.id&&c.placement.id!==box.id);if(!alternative)continue;
   if(budget++>=4)return result(selected,[]);
   // Expand the failed coarse probe before making a deferral. This remains a
   // bounded search, not a proof of impossibility over continuous coordinates.
   const other=input.available!.find(b=>b.id===alternative.placement.id)!;
   const check=candidateSet(ctx(input,other,stackAfter(input,risk)),true);nodes+=check.candidates.length;generated+=check.generated;capped||=check.capped;checkedPairs++;
   if(check.candidates.some(c=>c.valid))continue;
   const site=upper(box,stackAfter(input,alternative));if(!site)continue;
   const reason=`${box.id} 먼저 배치하면 ${other.id}의 검토 위치가 막힘 · ${other.id} 먼저 + ${box.id} 상단 배치 검증`;
   return result(alternative,[{observation:{...box,pickupPosition:undefined},sinceStep:input.stepId+1,reason,protects:[other.id],source:{...BUFFER_SOURCE},reservedTop:site.placement}],[box.id]);
  }
 }
 return result(selected,[]);
}
