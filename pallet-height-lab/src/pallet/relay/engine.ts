import { advanceConveyor,beltSeconds,hasBeltTransit,nextBeltArrival,sourcePickup } from './conveyor';
import {candidateMeter} from '../candidates';
import { heightFillPlan } from './heightFill';
import { ArrivalEnvironment } from '../environment';
import { plan,candidateSet } from '../planner';
import { inspectConstraints } from '../constraints';
import { remainingSites,lostRemaining } from '../remainingSites';
import { COMPACT_SEARCH,emptyFrame } from '../types';
import { rng,shuffled } from '../rng';
import { ROBOT_COUNT,nextRobot,previousRobot,toWorld } from './layout';
import { padPickup,parkedPath,stagingPath,inspectMotion,motionsConflict,receiveConstraints,receivePath } from './motion';
import type { Candidate,Observation,PlanningInput,Scenario,SearchSettings } from '../types';
import type { RelayAlgorithm,RelayAction,RelayDecision,RelayWorld,RelayMotion } from './types';

export const RELAY_SEARCH:SearchSettings={...COMPACT_SEARCH,temporaryBuffer:false,maxCandidates:64,topK:4};
let runSequence=0;
let cacheHits=0;
const placedCount=(w:RelayWorld)=>w.cells.reduce((n,c)=>n+c.placements.length,0);
const planCache=new Map<string,{candidates:Candidate[];selectedId:string|null}>();
const ringFitCache=new Map<string,boolean>();
function hasRingFit(s:Scenario,w:RelayWorld,box:Observation,onlyCell?:number){
 for(const cell of onlyCell===undefined?Array.from({length:ROBOT_COUNT},(_,i)=>i):[onlyCell]){
  const key=`${w.runId}:${cell}:${w.cells[cell].placements.length}:${box.typeId}`;
  let fits=ringFitCache.get(key);
  if(fits!==undefined)cacheHits++;
  if(fits===undefined){
   const input=localInput(s,w,cell,'height-fill'),ctx={...input,current:box,available:undefined,remaining:{},settings:{...input.settings,inventoryMode:'none' as const,policy:'legacy' as const,maxCandidates:96}};
   fits=candidateSet(ctx,true).candidates.some(c=>c.valid);if(ringFitCache.size>2048)ringFitCache.clear();ringFitCache.set(key,fits);
  }
  if(fits)return true;
 }return false;
}
function cellPlan(input:PlanningInput,w:RelayWorld,robot:number,algorithm:RelayAlgorithm){
 const key=`${w.runId}:${robot}:${w.cells[robot].version}:${algorithm}:${JSON.stringify(input.settings)}`;
 let result=planCache.get(key);if(result)cacheHits++;if(!result){result=algorithm==='height-fill'?heightFillPlan(input):plan(input);if(planCache.size>64)planCache.clear();planCache.set(key,result);}return result;
}
export const canForward=(w:RelayWorld,id:string,robot:number)=>w.boxes.find(b=>b.observation.id===id)!.forwardedAt[robot]<placedCount(w);
const counts=(boxes:Observation[])=>{const result:Record<string,number>={};for(const b of boxes)result[b.typeId]=(result[b.typeId]||0)+1;return result;};
export function createRelay(s:Scenario,seed=s.arrival.seed,shuffle=true,runId=`relay-${seed}-${++runSequence}`):RelayWorld{
 if(s.events.length)throw Error('4대 협업은 도착한 전체 재고를 분배합니다. 단계별 입고 이벤트가 없는 입력을 사용하세요.');
 const available=new ArrivalEnvironment(s).available(emptyFrame()),pool=shuffle?shuffled(available,rng(seed)):available;
 const cells=Array.from({length:ROBOT_COUNT},()=>({queue:[] as string[],placements:[],version:0}));
 const boxes=pool.map((observation,i)=>{const owner=i%ROBOT_COUNT;cells[owner].queue.push(observation.id);return {observation,owner,visited:[owner],forwardedAt:Array(ROBOT_COUNT).fill(-1),status:'queued' as const};});
 return {runId,revision:0,cursor:0,boxes,cells,pads:Array.from({length:ROBOT_COUNT},()=>({boxId:null,version:0,departedAt:0,readyAt:0,arrived:true})),records:[],time:0};
}
export function localInput(s:Scenario,w:RelayWorld,cell:number,algorithm:RelayAlgorithm,settings=RELAY_SEARCH):PlanningInput{
 const available=w.cells[cell].queue.map(id=>{const box=w.boxes.find(b=>b.observation.id===id)!.observation;return {...box,pickupPosition:sourcePickup(w,box,cell,s.pallet)};});
 return {runId:w.runId,stepId:w.revision,pallet:s.pallet,types:s.types,constraints:receiveConstraints(s),placements:w.cells[cell].placements,current:available[0],available,remaining:counts(available),algorithm:algorithm==='height-fill'?'greedy':algorithm,settings:{...settings,temporaryBuffer:false,stockPolicy:'compact'}};
}
function sitesFor(input:PlanningInput,box:Observation,placements=input.placements){return candidateSet({...input,available:undefined,current:box,placements,remaining:{},settings:{...input.settings,policy:'legacy',inventoryMode:'none',temporaryBuffer:false,maxCandidates:64}},true).candidates.filter(c=>c.valid).sort((a,b)=>a.placement.position.z-b.placement.position.z||b.score-a.score);}
function blockedAfter(input:PlanningInput,c:Candidate){
 const box=input.available!.find(b=>b.id===c.placement.id)!,remaining=counts(input.available!.filter(b=>b.id!==box.id));
 const ctx={...input,current:box,remaining,available:undefined},before=c.reservation?.before||remainingSites(ctx,input.placements),after=c.reservation?.after||remainingSites(ctx,[...input.placements,c.placement]);
 if(lostRemaining(ctx,before,after)<=0)return [];
 return before.types.filter(t=>t.fitSites&&!after.types.find(v=>v.id===t.id)?.fitSites).slice(0,4).filter(t=>{
  const next=input.available!.find(b=>b.typeId===t.id&&b.id!==box.id);return next&&!sitesFor(input,next,[...input.placements,c.placement]).length;
 }).map(t=>t.id);
}

const center=(p:{x:number;y:number;z:number},b:Observation)=>({x:p.x+b.size.w/2,y:p.y+b.size.d/2,z:p.z+b.size.h/2});
const baseAction=(w:RelayWorld,robot:number,box:Observation)=>({runId:w.runId,revision:w.revision,cellVersion:w.cells[robot].version,robot,boxId:box.id,from:robot});
export function planRelay(s:Scenario,w:RelayWorld,algorithm:RelayAlgorithm='greedy',settings=RELAY_SEARCH,allowTransfers=true,running:RelayAction[]=[]):RelayDecision{
 const meterBefore={...candidateMeter},hitsBefore=cacheHits;
 const started=performance.now(),actions:RelayAction[]=[],reasons:string[]=[];
 const risk=(ctx:PlanningInput,c:Candidate)=>{
  if(algorithm!=='height-fill')return blockedAfter(ctx,c);
  if(c.placement.handling!=='no-top-load'&&c.placement.maxLoadKg!==0)return [];
  const cell=w.cells.findIndex(v=>v.placements===ctx.placements);
  const stock=w.boxes.filter(b=>b.status!=='placed'&&b.observation.handling!=='no-top-load'&&b.observation.maxLoadKg!==0);
  // A cap must not close a support merely because its next matching box is at
  // another robot. Reserve that support using the entire arrived ring inventory.
  return stock.filter((b,i)=>stock.findIndex(v=>v.observation.typeId===b.observation.typeId)===i).filter(b=>hasRingFit(s,w,b.observation,cell)).map(b=>b.observation.typeId);
 };
 const available=(a:RelayAction)=>{const bad=inspectMotion(s,w,a);if(bad.length){reasons.push(`R${a.robot+1} ${a.boxId}: ${bad.join(' / ')}`);return false;}
  if([...running,...actions].some(b=>motionsConflict(s,w,a,b))){reasons.push(`R${a.robot+1}: 겹치는 운반 경로 / 컨베이어 사용 완료 대기`);return false;}return true;};
 for(let n=0;n<ROBOT_COUNT;n++){
  const robot=(w.cursor+n)%ROBOT_COUNT;if(running.some(a=>a.robot===robot))continue;
  const input=localInput(s,w,robot,algorithm,settings),pad=previousRobot(robot),staged=w.pads[pad].boxId;
  // A box is accepted by the receiver only after the sender has left the pad.
  if(staged&&w.pads[pad].arrived&&!running.some(a=>a.pad===pad)){
   const box=w.boxes.find(b=>b.observation.id===staged)!.observation,pickup=padPickup(s,box,pad),ctx={...input,current:box,available:[box,...input.available!]};
   let accepted:RelayAction|undefined;
   const topOnly=algorithm==='height-fill'&&(box.handling==='no-top-load'||box.maxLoadKg===0);
   const buildFirst=topOnly&&input.available!.length>0&&cellPlan(input,w,robot,algorithm).candidates.some(c=>c.valid&&c.placement.handling!=='no-top-load'&&c.placement.maxLoadKg!==0);
   const receivedSites=buildFirst?[]:sitesFor(ctx,{...box,pickupPosition:pickup});
   if(topOnly)receivedSites.sort((a,b)=>b.placement.position.z+b.placement.size.h-a.placement.position.z-a.placement.size.h);
   for(const c of receivedSites.slice(0,8)){
    if(risk(ctx,c).length)continue;
    const checked=inspectConstraints(c.placement,{...box,pickupPosition:pickup},input.placements,s.pallet,receiveConstraints(s));if(checked.reasons.length)continue;
    const route=receivePath(s,w,box,pad,checked.placement),a:RelayAction={...baseAction(w,robot,box),kind:'receive-place',from:pad,to:robot,pad,padVersion:w.pads[pad].version,reason:'받는 팔 판단: 현재 지지·하중·잔량 조건을 만족하므로 컨베이어에서 팔레트로 바로 적재',candidate:{...c,placement:checked.placement,path:route.path},...route,seconds:route.path.seconds,initialCenter:toWorld(center(pickup,box),robot,s.pallet)};
    if(available(a)){accepted=a;break;}
   }
   if(!accepted){const route=stagingPath(s,w,box,pad,true),a:RelayAction={...baseAction(w,robot,box),kind:'receive-queue',from:pad,to:robot,pad,padVersion:w.pads[pad].version,reason:'받는 팔 판단: 지금 적재하면 후속 배치를 막거나 적재/경로 후보가 없어 자기 대기 재고에 보관',...route};if(available(a))accepted=a;}
   if(accepted){actions.push(accepted);continue;}
  }
  if(staged){reasons.push(`R${robot+1}: 공용 벨트 도착 / 픽업 예약 대기`);continue;}
  if(!input.available!.length)continue;
  const analysis=cellPlan(input,w,robot,algorithm),selected=analysis.candidates.find(c=>c.id===analysis.selectedId);
  const makePlace=(c:Candidate,reason:string):RelayAction=>{const box=input.available!.find(b=>b.id===c.placement.id)!,path=parkedPath(s,c.path,robot);return {...baseAction(w,robot,box),kind:'place',reason,candidate:{...c,path},path,pickup:box.pickupPosition,seconds:path.seconds,initialCenter:toWorld(center(box.pickupPosition!,box),robot,s.pallet)};};
  const send=(box:Observation,reason:string)=>{
   if(!allowTransfers||w.pads[robot].boxId||[...running,...actions].some(a=>a.pad===robot)||!canForward(w,box.id,robot))return undefined;
   const a:RelayAction={...baseAction(w,robot,box),kind:'send',to:nextRobot(robot),pad:robot,padVersion:w.pads[robot].version,reason,...stagingPath(s,w,box,robot)};return available(a)?a:undefined;
  };
  if(selected){const lost=risk(input,selected);
   if(lost.length){const box=input.available!.find(b=>b.id===selected.placement.id)!;
    const alternatives=analysis.candidates.filter(c=>c.valid&&c.id!==selected.id).sort((a,b)=>a.placement.position.z-b.placement.position.z||b.score-a.score).filter((c,i,all)=>all.slice(0,i).filter(v=>v.placement.typeId===c.placement.typeId).length<3).slice(0,32);
    // A receiver that chose storage should build its available foundation first,
    // rather than immediately sending the same obstructing box around the ring.
    if(w.boxes.find(b=>b.observation.id===box.id)!.visited.length>1){const foundation=alternatives.filter(c=>!risk(input,c).length).map(c=>makePlace(c,`${box.id} 회수 보관 유지 · 받침 먼저 적재`)).find(available);if(foundation){actions.push(foundation);continue;}}
    const a=send(box,`${box.id}를 지금 놓으면 ${lost.join(', ')}의 검토 위치가 막힘 · 옆 컨베이어에 보류`);if(a){actions.push(a);continue;}
    const safe=alternatives.filter(c=>!risk(input,c).length).map(c=>makePlace(c,`${box.id}는 보류 · 다른 박스부터 적재`)).find(available);if(safe)actions.push(safe);else reasons.push(`R${robot+1}: 방해 박스 보류 · 컨베이어 또는 받침 공간 대기`);continue;
   }
   const options=[selected,...analysis.candidates.filter(c=>c.valid&&c.id!==selected.id).sort((a,b)=>a.placement.position.z-b.placement.position.z||b.score-a.score).slice(0,24)];
   const a=options.filter(c=>!risk(input,c).length).map(c=>makePlace(c,algorithm==='height-fill'?'낮은 빈자리와 넓은 지지면 · 남은 재고의 높이 조합으로 상한까지 채우기':'자기 팔레트의 지지·하중·회전·잔량 조건으로 선택')).find(available);if(a){actions.push(a);continue;}
  }
  for(const box of input.available!){
   if(algorithm==='height-fill'&&!hasRingFit(s,w,box))continue;
   const a=send(box,'자기 팔레트에 후보 없음 · 다른 구역의 적재 가능성을 확인하고 옆 컨베이어로 순환');if(a){actions.push(a);break;}
  }
  if(!actions.some(a=>a.robot===robot))reasons.push(`R${robot+1}: ${input.available!.length}개 대기 · 현재 실행 가능한 작업 없음`);
 }
 return {actions,reasons,milliseconds:performance.now()-started,compute:{calls:candidateMeter.calls-meterBefore.calls,generated:candidateMeter.generated-meterBefore.generated,checked:candidateMeter.checked-meterBefore.checked,cacheHits:cacheHits-hitsBefore}};
}
export function assertRelayInventory(w:RelayWorld){
 const ids=w.boxes.map(b=>b.observation.id),accounted=[...w.cells.flatMap(c=>[...c.queue,...c.placements.map(p=>p.id)]),...w.pads.flatMap(p=>p.boxId?[p.boxId]:[])];
 if(w.cells.length!==ROBOT_COUNT||w.pads.length!==ROBOT_COUNT||new Set(ids).size!==ids.length||accounted.length!==ids.length||new Set(accounted).size!==ids.length||accounted.some(id=>!ids.includes(id)))throw Error('협업 재고 수량 또는 ID 중복 오류');
 for(const b of w.boxes){const c=w.cells[b.owner];if(!c||(b.status==='queued'?!c.queue.includes(b.observation.id):b.status==='staged'?w.pads[b.owner].boxId!==b.observation.id:!c.placements.some(p=>p.id===b.observation.id)))throw Error('박스 담당과 실제 재고 위치 불일치');if(b.forwardedAt.length!==ROBOT_COUNT||b.visited.at(-1)!==b.owner||b.visited.some((v,i)=>i>0&&v!==nextRobot(b.visited[i-1])))throw Error('순환 전달 기록 오류');}return true;
}
export function commitRelay(s:Scenario,w:RelayWorld,a:RelayAction,started=w.time,finished=started+a.seconds):RelayWorld{
 if(a.runId!==w.runId||a.cellVersion!==w.cells[a.robot]?.version||a.revision>w.revision)throw Error('지난 실행 또는 지난 작업셀의 동작입니다.');
 const b=w.boxes.find(b=>b.observation.id===a.boxId),receiving=a.kind.startsWith('receive');
 if(!b||b.owner!==a.from||b.status!==(receiving?'staged':'queued')||(!receiving&&!w.cells[a.from].queue.includes(a.boxId)))throw Error('현재 담당 재고에 없는 박스입니다.');
 if(receiving&&a.robot!==nextRobot(a.from)||!receiving&&a.robot!==a.from)throw Error('잘못된 작업 로봇');
 if(a.kind!=='place'&&(a.pad!==a.from||a.to!==nextRobot(a.from)))throw Error('인접 컨베이어가 지정되지 않았습니다.');
 if(a.pad!==undefined){if(a.pad!==a.from||a.to!==nextRobot(a.from)||!receiving&&!canForward(w,b.observation.id,a.robot))throw Error('인접하지 않거나 적재 변화 없이 재순환하는 로봇입니다.');if(w.pads[a.pad].version!==a.padVersion||w.pads[a.pad].boxId!==(receiving?a.boxId:null))throw Error('지난 컨베이어 예약입니다.');}
 if(receiving&&(!w.pads[a.from].arrived||started+1e-8<w.pads[a.from].readyAt))throw Error('컨베이어 도착 전에는 집을 수 없습니다.');
 const bad=inspectMotion(s,w,a);if(bad.length)throw Error(bad.join(' / '));
 const next=structuredClone(w),box=next.boxes.find(v=>v.observation.id===a.boxId)!;
 if(a.kind==='place'||a.kind==='receive-place'){
  if(!a.candidate||a.candidate.placement.id!==a.boxId)throw Error('적재 대상 불일치');
  const check=inspectConstraints(a.candidate.placement,{...b.observation,pickupPosition:a.pickup},w.cells[a.robot].placements,s.pallet,receiveConstraints(s));if(check.reasons.length)throw Error(check.reasons.join(' / '));
  next.cells[a.robot].placements=check.stack;box.status='placed';
 }else if(a.kind==='send'){Object.assign(next.pads[a.from],{boxId:a.boxId,departedAt:finished,readyAt:finished+beltSeconds(a.from,s.pallet),arrived:false});box.status='staged';box.forwardedAt[a.from]=placedCount(w);}else{next.cells[a.robot].queue.push(a.boxId);box.status='queued';}
 if(receiving){next.pads[a.from].boxId=null;box.owner=a.robot;box.visited.push(a.robot);}else next.cells[a.from].queue=next.cells[a.from].queue.filter(id=>id!==a.boxId);
 if(a.pad!==undefined)next.pads[a.pad].version++;
 next.cells[a.robot].version++;next.revision++;next.cursor=nextRobot(a.robot);next.time=Math.max(w.time,finished);
 next.records.push({step:next.revision,kind:a.kind,robot:a.robot,boxId:a.boxId,from:a.from,to:a.to,reason:a.reason,position:a.candidate?.placement.position,started,finished});assertRelayInventory(next);return next;
}
export function runRelay(s:Scenario,algorithm:RelayAlgorithm='greedy',options:{seed?:number;shuffle?:boolean;transfers?:boolean;progress?:(world:RelayWorld)=>void}={}){
 let world=createRelay(s,options.seed??s.arrival.seed,options.shuffle??true),time=0,running:RelayMotion[]=[],peak=0;
 const limit=world.boxes.length*(2*ROBOT_COUNT*(world.boxes.length+1)+1)+1;
 for(let i=0;i<limit;i++){
  const decision=planRelay(s,world,algorithm,RELAY_SEARCH,options.transfers??true,running.map(m=>m.action));
  running.push(...decision.actions.map(action=>({action,started:time,elapsed:0,progress:0})));peak=Math.max(peak,running.length);
  if(!running.length&&!hasBeltTransit(world))return {world,decision,peakConcurrent:peak,elapsed:time};
  time=Math.min(...running.map(m=>m.started+m.action.seconds),nextBeltArrival(world));
  const done=running.filter(m=>m.started+m.action.seconds<=time+1e-8);
  for(const m of done)world=commitRelay(s,world,m.action,m.started,m.started+m.action.seconds);
  world=advanceConveyor(world,time,running.filter(m=>!done.includes(m)));
  running=running.filter(m=>!done.includes(m));options.progress?.(world);
 }
 throw Error('협업 실행의 유한 동작 상한을 초과했습니다.');
}
