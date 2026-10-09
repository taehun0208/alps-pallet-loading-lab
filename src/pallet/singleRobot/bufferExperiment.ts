import { inspectConstraints } from '../constraints';
import { volume, top } from '../geometry';
import { rankCompactSites } from '../relay/streamPlanner';
import { loadCom, comOffsetRatio } from '../palletCom';
import { stability } from '../stability';
import { auditStack, catalogue } from './compare';
import { compactPolicy } from './config';
import type { CaseInput } from './situations';
import type { Candidate, Observation, Placement, PlanningInput } from '../types';

export type BufferMode='overflow'|'window-fifo'|'window-best';
export interface BufferExperimentOptions {
 mode:BufferMode;
 /** Optional serial service model; assumptions, never measured robot cycle time. */
 timing?:{arrivalIntervalSeconds:number;storeSeconds:number;retrieveSeconds:number;exchangeSeconds:number};
 audit?:(input:PlanningInput)=>void;
}
type Entry={observation:Observation;arrival:number;stored:boolean};
/** Normal-operation experiment. One infeed slot plus B independently accessible buffer slots.
 * Arrivals can be backpressured; only already observed boxes are eligible. At most B+1 boxes
 * are considered per decision. All modes share the same compact placement planner/constraints.
 * window-best minimizes resulting stack height, then favors larger footprints, greater mass,
 * and older arrivals. It is a heuristic, not an optimality or physical safety guarantee.
 */
export function runBufferExperiment(c:CaseInput,options:BufferExperimentOptions){
 if(c.events.length)throw Error('Buffer experiment accepts normal cases only');
 if(!['overflow','window-fifo','window-best'].includes(options.mode))throw Error('Unknown buffer mode');
 if(!Number.isInteger(c.bufferSize)||c.bufferSize<0)throw Error('Invalid buffer size');
 const timing=options.timing;
 if(timing&&Object.values(timing).some(x=>!Number.isFinite(x)||x<0))throw Error('Invalid timing assumptions');
 const s=structuredClone(c.scenario),cat=catalogue(s.types),policy=compactPolicy();
 const byId=new Map(cat.types.map(t=>[t.id,t])),remaining=Object.fromEntries(cat.types.map(t=>[t.id,t.quantity]));
 const sequence=c.sequence.map(id=>{const opaque=cat.toOpaque.get(id);if(!opaque)throw Error('Unknown arrival type');return opaque;});
 for(const t of cat.types)if(sequence.filter(id=>id===t.id).length!==t.quantity)throw Error('Arrival count mismatch');
 let stack:Placement[]=[],queue:Entry[]=[],arrival=-1,clock=0,placementSeconds=0,stores=0,retrieves=0,exchanges=0,peak=0;
 let plannerCalls=0,candidatesChecked=0;
 const observations=new Map<string,Observation>(),decisionMs:number[]=[],plannerMs:number[]=[],waitArrivalSteps:number[]=[];
 const history:{action:string;box?:string;arrival:number;pallet:number;buffered:number;position?:Placement['position']}[]=[];
 const pallets:{placements:Placement[];audit:ReturnType<typeof auditStack>;minReserveMm:number;comOffset:number|null}[]=[];
 const rejected:string[]=[],rejectionDiagnostics:{box:string;reasons:string[]}[]=[];
 const lastReasons=new Map<string,string[]>();
 const log=(action:string,e?:Entry,position?:Placement['position'])=>history.push({action,box:e?.observation.id,arrival,pallet:pallets.length,buffered:queue.filter(x=>x.stored).length,position});
 const stage=()=>{for(const e of queue)if(!e.stored){e.stored=true;stores++;clock+=timing?.storeSeconds??0;log('store',e);}
  peak=Math.max(peak,queue.length);if(queue.length>c.bufferSize)throw Error('Buffer overflow');};
 const close=()=>{if(!stack.length)return;
  const {center}=loadCom(stack);pallets.push({placements:structuredClone(stack),audit:auditStack(stack,s,observations),minReserveMm:stability(stack,s.constraints.stability).minReserve,comOffset:center?comOffsetRatio(center,s.pallet):null});
  log('close');stack=[];
 };
 const inspect=(e:Entry)=>{
  const buffered:Record<string,number>={};for(const other of queue)if(other!==e)buffered[other.observation.typeId]=(buffered[other.observation.typeId]??0)+1;
  const demand=Object.fromEntries(cat.types.map(t=>[t.id,remaining[t.id]+(buffered[t.id]??0)]));
  const input:PlanningInput={runId:'buffer-experiment/1',stepId:plannerCalls,pallet:s.pallet,types:structuredClone(cat.types),constraints:structuredClone(s.constraints),placements:structuredClone(stack),
   current:structuredClone(e.observation),remaining:demand,pending:{unarrived:{...remaining},buffered},algorithm:'greedy',settings:structuredClone(policy.settings)};
  options.audit?.(structuredClone(input));const start=performance.now();
  const result=rankCompactSites(input,{smallFloorPenalty:policy.smallFloorPenalty});
  lastReasons.set(e.observation.id,[...new Set(result.inspected.flatMap(x=>x.reasons))]);
  plannerMs.push(performance.now()-start);plannerCalls++;candidatesChecked+=result.inspected.length;
  return result.candidates[0];
 };
 const commit=(e:Entry,candidate:Candidate)=>{
  const check=inspectConstraints(candidate.placement,e.observation,stack,s.pallet,s.constraints);
  if(check.reasons.length)throw Error(`Commit rejected: ${check.reasons.join(', ')}`);
  stack=check.stack;observations.set(e.observation.id,e.observation);placementSeconds+=check.path.seconds;
  if(e.stored){retrieves++;clock+=timing?.retrieveSeconds??0;}
  clock+=check.path.seconds;waitArrivalSteps.push(arrival-e.arrival);queue=queue.filter(x=>x!==e);
  log('place',e,{...check.placement.position});
 };
 const select=()=>{
  const valid:{entry:Entry;candidate:Candidate}[]=[];
  for(const entry of queue){const candidate=inspect(entry);if(candidate){valid.push({entry,candidate});if(options.mode!=='window-best')break;}}
  if(options.mode==='window-best')valid.sort((a,b)=>{
   const height=(x:typeof a)=>Math.max(top(x.candidate.placement),...stack.map(top));
   const footprint=(x:typeof a)=>x.candidate.placement.size.w*x.candidate.placement.size.d;
   return height(a)-height(b)||footprint(b)-footprint(a)||b.entry.observation.weight-a.entry.observation.weight||a.entry.arrival-b.entry.arrival;
  });
  return valid[0];
 };
 const serve=()=>{
  let chosen=select();
  if(!chosen&&stack.length){close();exchanges++;clock+=timing?.exchangeSeconds??0;chosen=select();}
  if(chosen)commit(chosen.entry,chosen.candidate);
  else { // All waiting boxes were explicitly tested on an empty pallet.
   for(const e of queue){rejected.push(e.observation.id);rejectionDiagnostics.push({box:e.observation.id,reasons:lastReasons.get(e.observation.id)??[]});
    if(e.stored){retrieves++;clock+=timing?.retrieveSeconds??0;}log('reject',e);}queue=[];
  }
 };
 for(arrival=0;arrival<sequence.length;arrival++){
  const decisionStart=performance.now(),callsBefore=plannerCalls;
  if(timing)clock=Math.max(clock,arrival*timing.arrivalIntervalSeconds);
  const t=byId.get(sequence[arrival])!;remaining[t.id]--;
  const observation:Observation={...structuredClone(t),id:`box-${arrival}`,typeId:t.id,status:'normal',orientationAllowed:[...t.orientations]};
  const entry:Entry={observation,arrival,stored:false};queue.push(entry);log('arrive',entry);
  if(options.mode==='overflow'){
   const candidate=inspect(entry);
   if(candidate)commit(entry,candidate);
   else if(queue.length>c.bufferSize)serve();
  }else if(queue.length>c.bufferSize)serve();
  stage();
  if(plannerCalls>callsBefore)decisionMs.push(performance.now()-decisionStart);
 }
 arrival=Math.max(0,sequence.length-1);
 while(queue.length){const start=performance.now();serve();decisionMs.push(performance.now()-start);}close();
 const placed=pallets.flatMap(p=>p.placements),ids=placed.map(p=>p.id);
 if(new Set([...ids,...rejected]).size!==sequence.length||ids.length+rejected.length!==sequence.length)throw Error('Box conservation failed');
 const failed=pallets.some(p=>Object.values(p.audit.violations).some(n=>n>0));
 return {schema:'buffer-experiment/1',situation:c.situation,phase:c.phase,seeds:c.seeds,source:c.source,
  config:{mode:options.mode,bufferSize:c.bufferSize,policy,pallet:s.pallet,constraints:s.constraints,timing:timing??null,
   assumptions:['one infeed slot plus independently accessible buffer slots','backpressure allowed','known catalogue counts, unknown future order','normal inputs only']},
  performance:{total:sequence.length,completed:placed.length,rejected:rejected.length,pallets:pallets.length,
   utilization:pallets.length?placed.reduce((n,b)=>n+volume(b.size),0)/(pallets.length*s.pallet.width*s.pallet.depth*s.pallet.maxHeight):null},
  fitness:{status:failed?'fail':pallets.length?'pass':'unverified',scope:'model constraints only; physical robot/dynamic stability unverified'},
  stability:{minReserveMm:pallets.length?Math.min(...pallets.map(p=>p.minReserveMm)):null},
  buffer:{stores,retrieves,peak,waitArrivalSteps,maxWaitArrivalSteps:Math.max(0,...waitArrivalSteps)},
  robot:{placementSeconds,exchanges,serialModelSeconds:timing?clock:null,bufferHandlingSeconds:timing?stores*timing.storeSeconds+retrieves*timing.retrieveSeconds:null,
   note:'serial model uses pickup-path proxy plus assumed buffer costs; not measured makespan'},
  compute:{decisionMs,plannerMs,plannerCalls,candidatesChecked},history,pallets,rejected,rejectionDiagnostics,
  rejectionScope:'no valid candidate found by bounded planner on empty pallet; not proof of geometric infeasibility'};
}
