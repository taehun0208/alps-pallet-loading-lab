import { stability } from '../stability';
import type { Algorithm,Frame,Scenario } from '../types';
export function strategyMetrics(frame:Frame,s:Scenario,algorithm:Algorithm){
  const decisions=frame.records.flatMap(r=>r.analysis?[r.analysis]:[]),debug=decisions.flatMap(a=>a.strategyDebug?[a.strategyDebug]:[]),feasible=debug.flatMap(d=>d.criticalBoxes.map(c=>c.feasibleAfter)),times=decisions.map(a=>a.milliseconds);
  const total=s.types.reduce((n,t)=>n+t.quantity,0),placed=frame.placements.length;
  return {algorithm,seed:s.arrival.seed,totalBoxes:total,placedBoxes:placed,
    failedBoxes:frame.records.filter(r=>r.disposition==='blocked').length,
    unprocessedBoxes:Math.max(0,total-frame.processed-Number(frame.blocked)),unplacedBoxes:total-placed,
    averageSupport:placed?frame.placements.reduce((n,b)=>n+b.supportRatio,0)/placed:0,
    stabilityViolations:stability(frame.placements,s.constraints.stability).violations.length,
    averageDecisionMs:times.length?times.reduce((a,b)=>a+b,0)/times.length:0,maxDecisionMs:Math.max(0,...times),
    // A replan means recomputing an uncommitted decision after an observed change, not each arrival.
    replans:frame.replanCount??frame.records.filter(r=>r.observation.status==='resized').length,
    averageFutureFeasible:feasible.length?feasible.reduce((a,b)=>a+b,0)/feasible.length:null,
    minFutureFeasible:feasible.length?Math.min(...feasible):null,
    futureDeadEnds:debug.reduce((n,d)=>n+d.deadEnds,0),futurePlacementLoss:debug.reduce((n,d)=>n+d.futurePlacementLoss,0),
    reservedSlotCount:debug.at(-1)?.reservedSlots.length??0,reservationChanges:debug.reduce((n,d)=>n+d.reservationChanges,0),
  };
}
