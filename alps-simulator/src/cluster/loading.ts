import type {TrialResult} from '../engine/types';
/** Replay recorded decisions; no recomputation, reordering, or fabricated accepted box. */
export function loadingDuration(row:TrialResult){return Math.max(0,row.metrics.totalSeconds,...row.decisions.flatMap(d=>[d.timing.end,d.timing.robotEnd??0]));}
export function loadingFrame(row:TrialResult,seconds:number){
 if(!Number.isFinite(seconds))throw Error('Invalid replay time');
 const time=Math.max(0,Math.min(seconds,loadingDuration(row)));
 const completed=row.decisions.filter(d=>d.accepted&&d.timing.robotEnd!==null&&d.timing.robotEnd<=time);
 const ids=new Set(completed.map(d=>d.box.id));
 const placed=row.placements.filter(p=>ids.has(p.id));
 const moving=row.decisions.find(d=>d.accepted&&d.timing.robotStart!==null&&d.timing.robotEnd!==null&&time>=d.timing.robotStart&&time<d.timing.robotEnd);
 const rejected=row.decisions.filter(d=>!d.accepted&&d.timing.end<=time);
 const observed=row.decisions.filter(d=>d.timing.start<=time).at(-1);
 const remaining=observed?{...observed.remaining}:Object.fromEntries(row.scenario.types.map(t=>[t.id,t.quantity]));
 const pending=row.arrivals.filter(b=>!ids.has(b.id)&&b.id!==moving?.box.id&&!rejected.some(d=>d.box.id===b.id));
 return {time,placed,moving:moving?.placement??null,progress:moving?(time-moving.timing.robotStart!)/(moving.timing.robotEnd!-moving.timing.robotStart!):0,
  rejected:rejected.map(d=>d.box),pending,remaining,observed:observed?.box??null,done:time>=loadingDuration(row)};
}
