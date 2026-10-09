import {allPallets,palletSlots,palletCell,palletState,checkKey} from './palletStations';
import {usesBranches,advanceBranches,branchAvailable,branchReady,BRANCH} from './branchedConveyor';
import {usesRoller,advanceQueue,transportLength,footprint,atRollerStop,ROLLER} from './rollerQueue';
import {seededDent,scanBox,scanned,handled,SCANNER_OFFSET,REJECT_SECONDS} from './intake';
import {resolvePlacement} from './practical';
import {robotCount} from './fleet';
import {ArrivalEnvironment} from '../environment';
import {top} from '../geometry';
import {inspectConstraints} from '../constraints';
import {receiveConstraints} from './motion';
import {entryClear,STREAM_SPEED,loopLength} from './streamGeometry';
import {interceptAction} from './streamPlanner';
import type {FlowDecision} from './streamPlanner';
import type {Scenario} from '../types';
import type {RelayWorld,RelayMotion} from './types';
let sequence=0;
export function createStream(s:Scenario):RelayWorld{
 const count=robotCount(s.pallet),environment=new ArrivalEnvironment({...s,supplyMode:'arrival'}),boxes=Array.from({length:environment.total},(_,i)=>({observation:environment.current(i)!,owner:-1,visited:[],forwardedAt:Array(count).fill(-1),status:'pending' as const}));
 if(s.intake)for(const box of boxes){const b=box as RelayWorld['boxes'][number];b.deformation=seededDent(s.arrival.seed,b.observation.id,b.observation.size,s.intake.damageRate);}
 const initialCell=()=>({queue:[] as string[],placements:[] as import('../types').Placement[],version:0}),initialState=()=>({phase:'loading' as const,since:0,cycle:1,lastPlaced:0,rejected:[] as string[]}),dual=s.pallet.palletsPerRobot===2;
 return {...(dual?{secondaryCells:Array.from({length:count},initialCell)}:{}),runId:`flow-${s.arrival.seed}-${++sequence}`,revision:0,cursor:0,boxes,cells:Array.from({length:count},()=>({queue:[],placements:[],version:0})),pads:Array.from({length:count},()=>({boxId:null,version:0,departedAt:0,readyAt:0,arrived:true})),records:[],time:0,stream:{...(dual?{secondaryCells:Array.from({length:count},initialState)}:{}),speed:usesRoller(s.pallet)?ROLLER.speed:STREAM_SPEED,nextInfeed:0,entered:0,measured:0,passes:0,complete:false,inputClosed:false,cells:Array.from({length:count},()=>({phase:'loading',since:0,cycle:1,lastPlaced:0,rejected:[]})),dispatched:[]}};
}
export function applyDecision(s:Scenario,world:RelayWorld,motions:RelayMotion[],decision:FlowDecision){
 if(decision.runId!==world.runId||decision.cellVersions?.some((v,i)=>v!==allPallets(world)[i]?.cell.version))return {world,motions};
 const w=structuredClone(world),next=[...motions];
 // Keep hold reasons visible, but only centrally assigned offers may start a robot.
 const assigned=decision.commands?new Set(decision.commands.map(p=>p.robot+':'+p.boxId)):null;
 const proposals=decision.commands?[...decision.commands,...decision.proposals.filter(p=>!assigned!.has(p.robot+':'+p.boxId)).map(p=>({...p,candidates:[],reason:p.candidates.length?'중앙 배정 보류 · 다른 조합 우선 · 벨트 순환':p.reason}))]:decision.proposals;
 for(const proposal of proposals){
  const b=w.boxes.find(b=>b.observation.id===proposal.boxId),slot=proposal.pallet??0,cell=palletCell(w,proposal.robot,slot),state=palletState(w,proposal.robot,slot),ck=checkKey(w,proposal.robot,slot);
  if(!b||b.status!=='belt'||b.observation.status==='damaged'||!scanned(b,w.time,s)||proposal.cellVersion!==cell.version||state.phase!=='loading')continue;
  if(usesBranches(s.pallet)&&b.flow?.transport?.kind==='main'){
   if(proposal.candidates.length&&(!assigned||assigned.has(proposal.robot+':'+proposal.boxId))&&b.flow.transport.robot===undefined&&branchAvailable(w,proposal.robot,b)){b.flow.transport.robot=proposal.robot;b.owner=proposal.robot;b.flow.lastReason=`중앙 배차 R${proposal.robot+1} · 분기 대기`;w.revision++;}
   else b.flow.lastReason=proposal.reason;
   b.flow.checks[ck]={version:proposal.cellVersion,at:w.time,reason:proposal.reason,blocked:proposal.blocked,tested:proposal.tested};continue;
  }
  const scheduledHold=assigned&&!assigned.has(proposal.robot+':'+proposal.boxId)&&decision.proposals.some(p=>p.robot===proposal.robot&&p.boxId===proposal.boxId&&p.candidates.length);
  if(scheduledHold){b.flow!.lastReason=proposal.reason;continue;}
  const failures:string[]=[],action=interceptAction(s,w,proposal,next.map(m=>m.action),failures);
  const reason=action?proposal.reason:proposal.candidates.length?`${[...new Set(failures)].slice(0,2).join(' / ')||'현재 예약 불가'} · 다음 구역으로 통과`:proposal.reason;
  b.flow!.checks[ck]={version:proposal.cellVersion,at:w.time,reason,blocked:proposal.blocked,tested:proposal.tested};b.flow!.lastReason=reason;
  if(action){b.status='reserved';b.owner=proposal.robot;next.push({action,started:w.time,elapsed:0,progress:0});w.revision++;}
  else if(usesRoller(s.pallet)&&b.flow!.roller){b.flow!.roller.attempts++;}
  else if(usesBranches(s.pallet)&&b.flow!.transport){b.flow!.transport.attempts++;}
  if(!action&&(!proposal.candidates.length||failures.some(r=>!r.includes('예약')&&!r.includes('구간')))){if(!state.rejected.includes(b.observation.id))state.rejected.push(b.observation.id);}
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
  const a=m.action,b=w.boxes.find(b=>b.observation.id===a.boxId)!,cell=palletCell(w,a.robot,a.pallet),state=palletState(w,a.robot,a.pallet);
  if(b.status!=='reserved'||b.owner!==a.robot||a.cellVersion!==cell.version)throw Error('추적 집기 예약이 일치하지 않습니다.');
  const execution=s.practical?resolvePlacement(s,b.observation.id,a.candidate!.placement.position,s.practical):undefined;
  if(execution)b.execution=execution;
  const actual=execution?{...a.candidate!.placement,position:execution.actual}:a.candidate!.placement;
  const checked=inspectConstraints(actual,{...b.observation,pickupPosition:a.pickup},cell.placements,s.pallet,receiveConstraints(s));
  if(s.practical&&((execution?.reasons.length??0)||checked.reasons.length)){b.status='outfeed';b.flow!.lastReason=`실전 배치 검사 실패 · ${[...(execution?.reasons??[]),...checked.reasons].join(' / ')} · 재관측·출구 대기`;b.execution!.reasons=[...b.execution!.reasons,...checked.reasons];cell.version++;w.revision++;continue;}
  if(checked.reasons.length)throw Error(checked.reasons.join(' / '));
  b.status='placed';cell.placements=checked.stack;cell.version++;w.revision++;
  state.lastPlaced=time;state.rejected=[];
  w.records.push({step:w.records.length+1,kind:'place',robot:a.robot,pallet:a.pallet,boxId:a.boxId,from:a.robot,reason:a.reason,position:checked.placement.position,started:m.started,finished:m.started+a.seconds});
 }
 if(usesRoller(s.pallet)){
  const lane=w.boxes.filter(b=>b.status==='belt'||b.status==='reserved'&&next.some(m=>m.action.boxId===b.observation.id&&time<m.action.tracking!.graspAt+(b.observation.size.h+100)/s.constraints.gripper.speed));
  const updated=advanceQueue(lane.map(b=>({id:b.observation.id,arc:b.flow!.roller?.arc??0,length:footprint(b),held:b.status==='reserved'})),transportLength(s.pallet),Math.max(0,time-world.time)*ROLLER.speed);
  for(const item of updated){const b=lane.find(b=>b.observation.id===item.id)!,old=b.flow!.roller; b.flow!.roller={arc:item.arc,limit:item.limit,at:time,attempts:old?.attempts??0,waitingSince:old?.waitingSince};
   if(atRollerStop(b,s.pallet)&&b.flow!.roller.waitingSince===undefined)b.flow!.roller.waitingSince=time;
   if(b.status==='belt'&&atRollerStop(b,s.pallet)&&b.flow!.roller.attempts>=2&&time-b.flow!.roller.waitingSince!>=30){
    if(replaceBlockedPallet(w,0,time)){b.flow!.roller.attempts=0;}else if(palletSlots(w).every(slot=>palletState(w,0,slot).phase==='loading')){b.status='outfeed';b.flow!.lastReason=w.secondaryCells?'두 팔레트에도 배치 불가 · 수동 처리 대기':'빈 팔레트에도 배치 불가 · 수동 처리 대기 · 롤러 대기열에서 제외';w.revision++;}
   }
  }
 }
 if(usesBranches(s.pallet)){
  advanceBranches(w,next,s.pallet,world.time,s.constraints.gripper.speed);
  for(const b of w.boxes){const t=b.flow?.transport;if(b.status!=='belt'||!t||t.kind!=='branch'||!branchReady(b,t.robot!)||t.attempts<2||time-(t.waitingSince??time)<BRANCH.waitSeconds)continue;
   if(replaceBlockedPallet(w,t.robot!,time)){t.attempts=0;}else if(palletSlots(w).every(slot=>palletState(w,t.robot!,slot).phase==='loading')){b.status='outfeed';b.flow!.lastReason='서브 선두 · 두 팔레트 배치 불가 · 수동 처리 대기';w.revision++;}
  }
 }
 const pending=w.boxes.find(b=>b.status==='pending');
 const belt=w.boxes.filter(b=>b.status==='belt'||b.status==='rejecting'||b.status==='reserved'&&next.some(m=>m.action.boxId===b.observation.id&&time<m.action.tracking!.graspAt));
 if(pending&&time>=flow.nextInfeed&&entryClear(pending,belt,time,flow.speed,s.pallet)){
  pending.status='belt';pending.flow={enteredAt:time,measuredAt:usesRoller(s.pallet)||usesBranches(s.pallet)?Infinity:time+(SCANNER_OFFSET+(s.intake?pending.observation.size.w/2:0))/flow.speed+.25,passes:0,lastReason:'이동 중 계측',checks:{}};if(usesRoller(s.pallet))pending.flow.roller={arc:0,limit:transportLength(s.pallet)-footprint(pending)/2,at:time,attempts:0};if(usesBranches(s.pallet))pending.flow.transport={kind:'main',arc:0,limit:0,at:time,attempts:0};flow.entered++;w.revision++;
  // Seeded irregular release intervals plus physical belt clearance; no overlapping spawn.
  const jitter=((s.arrival.seed*31+flow.entered*7919)%997)/997;flow.nextInfeed=time+2.6+jitter*2.6;
 }
 flow.inputClosed=!w.boxes.some(b=>b.status==='pending');
 for(const b of w.boxes){if(!b.flow)continue;
  if((usesRoller(s.pallet)||usesBranches(s.pallet))&&b.status==='belt'&&b.flow.measuredAt===Infinity&&(usesBranches(s.pallet)?b.flow.transport!.arc:b.flow.roller!.arc)>=SCANNER_OFFSET+b.observation.size.w/2)b.flow.measuredAt=time;
  if(world.time<b.flow.measuredAt&&time>=b.flow.measuredAt){
   flow.measured++;b.flow.lastReason='계측 완료 · 접근하는 작업셀에서 선별';
   if(s.intake||usesBranches(s.pallet)){b.scan=scanBox(b,b.flow.measuredAt,s);if(b.scan.verdict==='damaged'){b.observation.status='damaged';if(!usesBranches(s.pallet))b.status='rejecting';b.flow.lastReason=`찌그러짐 ${b.scan.deviationMm.toFixed(1)} mm 검출 · 격리 이송`;}}
   w.revision++;
  }
  if(b.status==='rejecting'&&time>=(usesBranches(s.pallet)?b.flow.reject!.startedAt+BRANCH.rejectSeconds:b.flow.measuredAt+REJECT_SECONDS)){b.status='quarantined';b.flow.lastReason='찌그러짐 검출 · 격리 완료 · 적재 대상 제외';w.revision++;}
  if(b.status==='belt'&&s.pallet.conveyorMode==='straight'&&!usesRoller(s.pallet)&&(time-b.flow.enteredAt)*flow.speed>=loopLength(s.pallet)){b.status='outfeed';b.flow.lastReason='집기 구간 통과 · 출구 대기 · 미적재';w.revision++;}
  if(b.status==='belt'&&s.pallet.conveyorMode!=='straight'&&!usesBranches(s.pallet)){const laps=Math.floor((time-b.flow.enteredAt)*flow.speed/loopLength(s.pallet));if(laps>b.flow.passes){flow.passes+=laps-b.flow.passes;b.flow.passes=laps;}}
 }
 const allPlaced=w.boxes.every(handled);
 allPallets(w).forEach(({state:current,robot,pallet,cell})=>{
  const state=current!,busy=next.some(m=>m.action.robot===robot),height=Math.max(0,...cell.placements.map(top));
  const remaining=w.boxes.filter(b=>!handled(b)),exhausted=!remaining.some(b=>b.status==='pending'||b.status==='reserved'||!state.rejected.includes(b.observation.id));
  const reconsiderSeconds=loopLength(s.pallet)/flow.speed*1.1;
  if(state.phase==='loading'&&!busy&&cell.placements.length&&(allPlaced||height>=s.pallet.maxHeight*.96||(state.rejected.length>=6||exhausted)&&time-state.lastPlaced>reconsiderSeconds)){
   state.phase='checking';state.since=time;w.revision++;
  }else if(state.phase==='checking'&&time-state.since>=3){state.phase='outbound';state.since=time;w.revision++;}
  else if(state.phase==='outbound'&&time-state.since>=9){
   flow.dispatched.push({robot,pallet,cycle:state.cycle,placements:structuredClone(cell.placements),at:time});cell.placements=[];cell.version++;state.phase='returning';state.since=time;w.revision++;
  }else if(state.phase==='returning'&&time-state.since>=9){state.phase='loading';state.since=time;state.cycle++;state.rejected=[];state.lastPlaced=time;w.revision++;}
 });
 flow.complete=allPlaced&&!next.length&&allPallets(w).every(({cell,state})=>state!.phase==='loading'&&!cell.placements.length);
 assertStreamInventory(w,next);return {world:w,motions:next};
}
export function assertStreamInventory(w:RelayWorld,motions:RelayMotion[]){
 const ids=w.boxes.map(b=>b.observation.id),stored=[...allPallets(w).flatMap(v=>v.cell.placements),...w.stream!.dispatched.flatMap(p=>p.placements)].map(p=>p.id),reserved=motions.map(m=>m.action.boxId);
 if(new Set(ids).size!==ids.length||new Set(stored).size!==stored.length||new Set(reserved).size!==reserved.length||new Set(motions.map(m=>m.action.robot)).size!==motions.length)throw Error('박스 / 작업셀 중복 예약');
 for(const b of w.boxes)if((b.status==='placed')!==stored.includes(b.observation.id)||(b.status==='reserved')!==reserved.includes(b.observation.id))throw Error('박스 수량 보존 오류');
 if(stored.some(id=>!ids.includes(id))||reserved.some(id=>!ids.includes(id)))throw Error('알 수 없는 박스');return true;
}

function replaceBlockedPallet(w:RelayWorld,robot:number,time:number){
 const target=allPallets(w).find(p=>p.robot===robot&&p.state!.phase==='loading'&&p.cell.placements.length);
 if(!target)return false;target.state!.phase='checking';target.state!.since=time;w.revision++;return true;
}
