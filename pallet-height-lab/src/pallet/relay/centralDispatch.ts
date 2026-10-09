import type {FlowProposal} from './streamPlanner';
/** Central assignment owns box/robot uniqueness. Local candidate generation is only a feasibility service. */
export interface DispatchSummary {mode:'central';offered:number;commands:number;visited:number;capped:boolean;assignments:{pallet?:number;robot:number;boxId:string;cellVersion:number}[]}
export function assignCentrally(offers:FlowProposal[],busy:number[]=[],maxNodes=512){
 const groups=new Map<number,FlowProposal[]>();
 for(const p of offers){if(busy.includes(p.robot)||!p.candidates.length)continue;const list=groups.get(p.robot)||[];if(!list.some(v=>v.boxId===p.boxId))list.push(p);groups.set(p.robot,list);}
 const robots=[...groups.keys()].sort((a,b)=>a-b);let visited=0,capped=false,best:FlowProposal[]=[],bestValue=-Infinity;
 // Rank preserves conveyor urgency (offers are already ordered by approaching departure).
 // Quality is bounded, so raw packing-score magnitudes cannot dominate the assignment.
 const quality=(p:FlowProposal,rank:number)=>2/(1+rank)+(1+p.candidates[0].score/(1+Math.abs(p.candidates[0].score)))/2-(p.dispatchCost??0);
 function visit(i:number,chosen:FlowProposal[],ids:Set<string>,value:number){
  if(visited>=maxNodes){capped=true;return;}visited++;
  if(chosen.length>best.length||chosen.length===best.length&&value>bestValue){best=[...chosen];bestValue=value;}
  if(i===robots.length||chosen.length+robots.length-i<best.length)return;
  const options=groups.get(robots[i])!;
  for(let rank=0;rank<options.length;rank++){const p=options[rank];if(ids.has(p.boxId))continue;ids.add(p.boxId);chosen.push(p);visit(i+1,chosen,ids,value+quality(p,rank));chosen.pop();ids.delete(p.boxId);if(capped)return;}
  visit(i+1,chosen,ids,value);
 }
 visit(0,[],new Set(),0);
 const commands=best.map(p=>({...p,reason:'중앙 배정 · '+p.reason}));
 const dispatch:DispatchSummary={mode:'central',offered:[...groups.values()].reduce((n,v)=>n+v.length,0),commands:commands.length,visited,capped,assignments:commands.map(p=>({robot:p.robot,pallet:p.pallet,boxId:p.boxId,cellVersion:p.cellVersion}))};
 return{commands,dispatch};
}
