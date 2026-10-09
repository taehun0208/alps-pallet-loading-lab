/** Scores rank modeled feasible alternatives; they are not safety probabilities. */
export type OrchestrationMode='central'|'independent';
export type OrchestrationObjective='throughput'|'balanced';
export interface OrchestrationBid {
 robot:number;score:number;arrivalSeconds:number;workSeconds:number;
 remainingVolumeRatio:number;futureFitRatio:number;eligible:boolean;reason:string;
}
export interface OrchestrationAssignment {
 boxId:string;robot:number;launchNow:boolean;score:number;reason:string;bids:OrchestrationBid[];
}
export interface OrchestrationSnapshot {
 mode:OrchestrationMode;objective?:OrchestrationObjective;at:number;observedBoxes:number;evaluatedBids:number;assignments:OrchestrationAssignment[];
}
export interface AssignmentOffer {boxId:string;passes:number;bids:OrchestrationBid[]}
export function rankAssignments(offers:AssignmentOffer[]):OrchestrationAssignment[]{
 const ordered=[...offers].sort((a,b)=>b.passes-a.passes||a.boxId.localeCompare(b.boxId));
 type Match={picks:{offer:AssignmentOffer;bid:OrchestrationBid}[];repeated:number;score:number};
 const better=(a:Match,b:Match)=>a.repeated>b.repeated||a.repeated===b.repeated&&(a.picks.length>b.picks.length||a.picks.length===b.picks.length&&a.score>b.score);
 let states=new Map<number,Match>([[0,{picks:[],repeated:0,score:0}]]);
 for(const offer of ordered){
  const next=new Map(states),future=Math.max(-Infinity,...offer.bids.filter(b=>!b.eligible).map(b=>b.score));
  // A downstream option wins only on modeled utility. Once recirculated, prioritize service.
  const now=offer.bids.filter(b=>b.eligible&&(offer.passes>=1||b.score>=future));
  for(const [mask,state] of states)for(const bid of now){
   if(mask&(1<<bid.robot))continue;
   const key=mask|(1<<bid.robot),candidate={picks:[...state.picks,{offer,bid}],repeated:state.repeated+(offer.passes>=1?1:0),score:state.score+bid.score};
   if(!next.has(key)||better(candidate,next.get(key)!))next.set(key,candidate);
  }
  states=next;
 }
 const best=[...states.values()].reduce((a,b)=>better(b,a)?b:a),chosen=new Map(best.picks.map(p=>[p.offer.boxId,p.bid]));
 return ordered.flatMap(offer=>{
  const bids=[...offer.bids].sort((a,b)=>b.score-a.score||a.arrivalSeconds-b.arrivalSeconds||a.robot-b.robot);
  // Soft downstream intentions never consume an immediate robot slot.
  const winner=chosen.get(offer.boxId)??(offer.passes<1?bids.find(b=>!b.eligible):undefined);
  if(!winner)return [];
  return [{boxId:offer.boxId,robot:winner.robot,launchNow:winner.eligible,score:winner.score,
   reason:`중앙 배정 R${winner.robot+1} · ${winner.eligible?'현재 집기':'하류 도착 대기'} · ${winner.reason}`,bids}];
 });
}
