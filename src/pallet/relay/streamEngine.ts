import {ArrivalEnvironment} from '../environment';
import {top} from '../geometry';
import {inspectConstraints} from '../constraints';
import {receiveConstraints} from './motion';
import {entryClear,STREAM_SPEED,loopLength} from './streamGeometry';
import {interceptAction} from './streamPlanner';
import type {FlowDecision,InterceptFailure} from './streamPlanner';
import type {Scenario} from '../types';
import type {RelayWorld,RelayMotion} from './types';
let sequence=0;
export function createStream(s:Scenario):RelayWorld{
 const environment=new ArrivalEnvironment({...s,supplyMode:'arrival'}),boxes=Array.from({length:environment.total},(_,i)=>({observation:environment.current(i)!,owner:-1,visited:[],forwardedAt:Array(4).fill(-1),status:'pending' as const}));
 return {runId:`flow-${s.arrival.seed}-${++sequence}`,revision:0,cursor:0,boxes,cells:Array.from({length:4},()=>({queue:[],placements:[],version:0})),pads:Array.from({length:4},()=>({boxId:null,version:0,departedAt:0,readyAt:0,arrived:true})),records:[],time:0,stream:{orchestrationMode:'central',orchestrationObjective:'throughput',speed:STREAM_SPEED,nextInfeed:0,entered:0,measured:0,passes:0,complete:false,inputClosed:false,cells:Array.from({length:4},()=>({phase:'loading',since:0,cycle:1,lastPlaced:0,rejected:[]})),dispatched:[]}};
}
export function applyDecision(s:Scenario,world:RelayWorld,motions:RelayMotion[],decision:FlowDecision){
 if(decision.runId!==world.runId||decision.snapshotTime!==undefined&&decision.snapshotTime>world.time||decision.cellVersions?.some((v,i)=>world.cells[i]?.version!==v)||decision.cellStates?.some((state,i)=>state!==`${world.stream!.cells[i].phase}/${world.stream!.cells[i].cycle}`)||decision.orchestration?.objective!==undefined&&decision.orchestration.objective!==(world.stream?.orchestrationObjective??'throughput')||decision.orchestration&&decision.orchestration.mode!==(world.stream?.orchestrationMode??'central'))return {world,motions};
 const w=structuredClone(world),next=[...motions];
 if(decision.orchestration)w.stream!.orchestration=decision.orchestration;
 for(const proposal of [...decision.proposals].sort((a,b)=>Number(b.disposition==='no-candidate')-Number(a.disposition==='no-candidate'))){
  const b=w.boxes.find(b=>b.observation.id===proposal.boxId);
  if(!b||b.status!=='belt'||proposal.cellVersion!==w.cells[proposal.robot].version||w.stream!.cells[proposal.robot].phase!=='loading')continue;
  if(proposal.disposition==='defer'){b.flow!.checks[proposal.robot]={version:proposal.cellVersion,at:w.time,reason:proposal.reason,blocked:proposal.blocked,tested:proposal.tested};b.flow!.lastReason=proposal.reason;continue;}
  const failures:InterceptFailure[]=[],action=interceptAction(s,w,proposal,next.map(m=>m.action),failures);
  const reason=action?action.reason:proposal.candidates.length?`${[...new Set(failures.map(f=>f.reason))].slice(0,2).join(' / ')||'현재 예약 불가'} · 다음 구역으로 통과`:proposal.reason;
  b.flow!.checks[proposal.robot]={version:proposal.cellVersion,at:w.time,retryAfter:proposal.candidates.length&&!action?0.65:25,reason,blocked:proposal.blocked,tested:proposal.tested};b.flow!.lastReason=reason;
  if(action){b.status='reserved';b.owner=proposal.robot;next.push({action,started:w.time,elapsed:0,progress:0});w.revision++;}
  else if(!proposal.candidates.length){const cell=w.stream!.cells[proposal.robot];if(!cell.rejected.includes(b.observation.id))cell.rejected.push(b.observation.id);}
 }
 return {world:w,motions:next};
}
export function advanceStream(s:Scenario,world:RelayWorld,motions:RelayMotion[],time:number){
 if(time<world.time)throw Error('시뮬레이션 시계는 역행할 수 없습니다.');
 const w=structuredClone(world),flow=w.stream!;w.time=time;
 const next:RelayMotion[]=[];
 for(const m of motions){
  const elapsed=time-m.started;
  if(elapsed+1e-8<m.action.seconds){next.push({...m,elapsed,progress:elapsed/m.action.seconds});continue;}
  const a=m.action,b=w.boxes.find(b=>b.observation.id===a.boxId)!;
  if(b.status!=='reserved'||b.owner!==a.robot||a.cellVersion!==w.cells[a.robot].version)throw Error('추적 집기 예약이 일치하지 않습니다.');
  const checked=inspectConstraints(a.candidate!.placement,{...b.observation,pickupPosition:a.pickup},w.cells[a.robot].placements,s.pallet,receiveConstraints(s));
  if(checked.reasons.length)throw Error(checked.reasons.join(' / '));
  b.status='placed';w.cells[a.robot].placements=checked.stack;w.cells[a.robot].version++;w.revision++;
  flow.cells[a.robot].lastPlaced=time;flow.cells[a.robot].rejected=[];
  w.records.push({step:w.records.length+1,kind:'place',robot:a.robot,boxId:a.boxId,from:a.robot,reason:a.reason,position:a.candidate!.placement.position,started:m.started,finished:m.started+a.seconds});
 }
 const pending=w.boxes.find(b=>b.status==='pending');
 const belt=w.boxes.filter(b=>b.status==='belt'||b.status==='reserved'&&next.some(m=>m.action.boxId===b.observation.id&&time<m.action.tracking!.graspAt));
 if(pending&&time>=flow.nextInfeed&&entryClear(pending,belt,time,flow.speed,s.pallet)){
  pending.status='belt';pending.flow={enteredAt:time,measuredAt:time+650/flow.speed+.25,passes:0,lastReason:'이동 중 계측',checks:{}};flow.entered++;w.revision++;
  // Seeded irregular release intervals plus physical belt clearance; no overlapping spawn.
  const jitter=((s.arrival.seed*31+flow.entered*7919)%997)/997;flow.nextInfeed=time+2.6+jitter*2.6;
 }
 flow.inputClosed=!w.boxes.some(b=>b.status==='pending');
 for(const b of w.boxes){if(!b.flow)continue;
  if(world.time<b.flow.measuredAt&&time>=b.flow.measuredAt){flow.measured++;b.flow.lastReason='계측 완료 · 접근하는 작업셀에서 선별';w.revision++;}
  if(b.status==='belt'){const laps=Math.floor((time-b.flow.enteredAt)*flow.speed/loopLength(s.pallet));if(laps>b.flow.passes){flow.passes+=laps-b.flow.passes;b.flow.passes=laps;}}
 }
 const allPlaced=w.boxes.every(b=>b.status==='placed');
 flow.cells.forEach((state,robot)=>{
  const cell=w.cells[robot],busy=next.some(m=>m.action.robot===robot),height=Math.max(0,...cell.placements.map(top));
  const remaining=w.boxes.filter(b=>b.status!=='placed'),exhausted=!remaining.some(b=>b.status==='pending'||b.status==='reserved'||!state.rejected.includes(b.observation.id));
  const reconsiderSeconds=loopLength(s.pallet)/flow.speed*1.1;
  if(state.phase==='loading'&&!busy&&cell.placements.length&&(allPlaced||height>=s.pallet.maxHeight*.96||(state.rejected.length>=6||exhausted)&&time-state.lastPlaced>reconsiderSeconds)){
   // Record why the existing policy closed this pallet, not a claim that its volume is full.
   // Search exhaustion is bounded heuristic evidence; it is not a proof of infeasibility.
   state.dispatchReason=allPlaced?'order-complete':height>=s.pallet.maxHeight*.96?'height-limit':'candidate-exhaustion';
   state.phase='checking';state.since=time;w.revision++;
  }else if(state.phase==='checking'&&time-state.since>=3){state.phase='outbound';state.since=time;w.revision++;}
  else if(state.phase==='outbound'&&time-state.since>=9){
   flow.dispatched.push({robot,cycle:state.cycle,placements:structuredClone(cell.placements),at:time,dispatchReason:state.dispatchReason});cell.placements=[];cell.version++;state.phase='returning';state.since=time;w.revision++;
  }else if(state.phase==='returning'&&time-state.since>=9){state.phase='loading';state.since=time;state.cycle++;state.rejected=[];state.lastPlaced=time;delete state.dispatchReason;w.revision++;}
 });
 flow.complete=allPlaced&&!next.length&&flow.cells.every((c,i)=>c.phase==='loading'&&!w.cells[i].placements.length);
 assertStreamInventory(w,next);return {world:w,motions:next};
}
export function assertStreamInventory(w:RelayWorld,motions:RelayMotion[]){
 const ids=w.boxes.map(b=>b.observation.id),stored=[...w.cells.flatMap(c=>c.placements),...w.stream!.dispatched.flatMap(p=>p.placements)].map(p=>p.id),reserved=motions.map(m=>m.action.boxId);
 if(new Set(ids).size!==ids.length||new Set(stored).size!==stored.length||new Set(reserved).size!==reserved.length||new Set(motions.map(m=>m.action.robot)).size!==motions.length)throw Error('박스 / 작업셀 중복 예약');
 for(const b of w.boxes)if((b.status==='placed')!==stored.includes(b.observation.id)||(b.status==='reserved')!==reserved.includes(b.observation.id))throw Error('박스 수량 보존 오류');
 if(stored.some(id=>!ids.includes(id))||reserved.some(id=>!ids.includes(id)))throw Error('알 수 없는 박스');return true;
}
