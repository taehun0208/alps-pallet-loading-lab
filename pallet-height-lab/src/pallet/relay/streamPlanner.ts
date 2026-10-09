import {allPallets,palletSlots,palletCell,palletState,checkKey,robotToPallet,worldToPallet,palletToWorld} from './palletStations';
import {usesBranches,branchReady,branchAvailable} from './branchedConveyor';
import {usesRoller,atRollerStop} from './rollerQueue';
import {scanned} from './intake';
import {robotObservation} from './fleet';
import {assignCentrally,type DispatchSummary} from './centralDispatch';
import {candidateSet} from '../planner';
import {compactScore} from '../compactPacking';
import {inspectConstraints} from '../constraints';
import {COMPACT_SEARCH} from '../types';
import {volume} from '../geometry';
import {inPickWindow,movingPickup,stationArc,beltArc} from './streamGeometry';
import {park} from './layout';
import {beltPickup} from './conveyor';
import {receiveConstraints,inspectMotion,motionsConflict} from './motion';
import {directReturn} from './streamReturn';
import type {Candidate,PlanningInput,Scenario,PathPoint,Vec3} from '../types';
import type {RelayWorld,RelayAction,RelayBox} from './types';

export interface FlowProposal {pallet?:number;robot:number;boxId:string;cellVersion:number;candidates:Candidate[];reason:string;blocked:number;tested:number;dispatchCost?:number}
export interface FlowDecision {runId:string;proposals:FlowProposal[];milliseconds:number;checks:number;commands?:FlowProposal[];dispatch?:DispatchSummary;cellVersions?:number[]}
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const cache=new Map<string,Candidate[]>();
const diagnostics=new Map<string,string>();
const fitCache=new Map<string,boolean>();
const settings={...COMPACT_SEARCH,policy:'legacy' as const,inventoryMode:'none' as const,temporaryBuffer:false,maxCandidates:64,portfolio:false};

// This boundary deliberately excludes the future input manifest and unmeasured boxes.
export function observedProblem(s:Scenario,w:RelayWorld){
 const world=structuredClone(w);world.boxes=world.boxes.filter(b=>b.status==='placed'||scanned(b,w.time,s)&&b.status==='belt');
 for(const b of world.boxes)delete b.deformation;
 const ids=new Set(world.boxes.map(b=>b.observation.typeId));
 const scenario={...structuredClone(s),types:s.types.filter(t=>ids.has(t.id)),events:[]};
 if(scenario.practical)scenario.practical.profile.baseTypes=Object.fromEntries(Object.entries(scenario.practical.profile.baseTypes).filter(([id])=>ids.has(id)));
 return {scenario,world};
}
function input(s:Scenario,w:RelayWorld,robot:number,b:RelayBox,pallet=0):PlanningInput{
 return {runId:w.runId,stepId:w.revision,pallet:s.pallet,types:s.types,constraints:receiveConstraints(s),placements:palletCell(w,robot,pallet).placements,current:{...robotObservation(s.pallet,robot,b.observation),pickupPosition:robotToPallet(usesRoller(s.pallet)||usesBranches(s.pallet)&&b.flow?.transport?.kind==='branch'?movingPickup(b,w.time,w.stream!.speed,s.pallet,robot):beltPickup(b.observation,robot,s.pallet),s.pallet,pallet)},remaining:{},algorithm:'greedy',settings};
}
function sites(ctx:PlanningInput,key?:string){
 if(key&&cache.has(key))return structuredClone(cache.get(key)!);
 const inspected=candidateSet(ctx,true).candidates,candidates=inspected.filter(c=>c.valid);
 for(const c of candidates){compactScore(c,ctx);
  // Small parcels use existing broad supports first, preserving floor for unknown large arrivals.
  if(ctx.placements.length&&c.placement.position.z===0&&volume(c.placement.size)<35e6)c.score-=100;
 }
 candidates.sort((a,b)=>(a.placement.position.z-b.placement.position.z)*.04+b.score-a.score);
 if(key){if(cache.size>600){cache.clear();diagnostics.clear();}cache.set(key,structuredClone(candidates));
  const reasons=new Map<string,number>();for(const c of inspected)for(const reason of c.reasons)reasons.set(reason,(reasons.get(reason)||0)+1);
  diagnostics.set(key,[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,2).map(r=>r[0]).join(' / '));
 }return candidates;
}
export function planStream(s:Scenario,w:RelayWorld,busy:number[]=[],central=true):FlowDecision{
 const start=performance.now(),proposals:FlowProposal[]=[];let checks=0;
 const known=w.boxes.filter(b=>b.status==='belt'&&b.observation.status!=='damaged'&&scanned(b,w.time,s));
 for(let robot=0;robot<w.cells.length;robot++){
  if(busy.includes(robot))continue;
 for(const pallet of palletSlots(w)){
  const cell=palletCell(w,robot,pallet),state=palletState(w,robot,pallet),ck=checkKey(w,robot,pallet);
  if(state.phase!=='loading')continue;
  const eligible=known.filter(b=>(!usesBranches(s.pallet)||b.flow?.transport?.kind==='branch'||branchAvailable(w,robot,b))&&inPickWindow(b,w.time,w.stream!.speed,s.pallet,robot)&&(!b.flow!.checks[ck]||b.flow!.checks[ck].version!==cell.version||w.time-b.flow!.checks[ck].at>25))
   .sort((a,b)=>(usesBranches(s.pallet)?Number(b.flow?.transport?.kind==='branch')-Number(a.flow?.transport?.kind==='branch'):0)*1e6+beltArc(b,w.time,w.stream!.speed,s.pallet)-beltArc(a,w.time,w.stream!.speed,s.pallet)).slice(0,2);
  for(const box of eligible){
   const ctx=input(s,w,robot,box,pallet),key=`${w.runId}/${robot}/${pallet}/${cell.version}/${box.observation.id}`,options=sites(ctx,key).filter(c=>!w.secondaryCells||!inspectMotion(s,w,{runId:w.runId,revision:w.revision,cellVersion:cell.version,robot,pallet,kind:'place',boxId:box.observation.id,from:robot,reason:'',candidate:c,path:c.path,seconds:c.path.seconds,initialCenter:{x:0,y:0,z:0}}).length);checks++;
   let chosen:Candidate[]=[],blocked=0,tested=0,reason='현재 지지·하중·높이 조건을 만족하는 위치 없음 · 그대로 순환';
   if(!options.length&&diagnostics.get(key))reason=`${diagnostics.get(key)} · 그대로 순환`;
   const isFoundation=(b:RelayBox)=>{const dims=Object.values(b.observation.size).sort((a,b)=>b-a);return dims[0]*dims[1]>=180000&&(s.practical?.weightPolicy==='capacity'?Number.isFinite(b.observation.maxLoadKg)&&b.observation.maxLoadKg!>0:b.observation.weight>=6&&b.observation.maxLoadKg!==0)&&b.observation.handling!=='no-top-load';};
   const foundation=isFoundation(box);
   const cellAge=w.time-state.since;
   const incomingFoundation=known.some(b=>b!==box&&isFoundation(b)&&stationArc(robot,s.pallet)-beltArc(b,w.time,w.stream!.speed,s.pallet)>0&&stationArc(robot,s.pallet)-beltArc(b,w.time,w.stream!.speed,s.pallet)<w.stream!.speed*20);
   if(!usesRoller(s.pallet)&&!usesBranches(s.pallet)&&!ctx.placements.length&&!foundation&&!w.stream!.inputClosed&&box.flow!.passes<1&&(cellAge<10||incomingFoundation&&cellAge<30)){proposals.push({robot,pallet,boxId:box.observation.id,cellVersion:cell.version,candidates:[],reason:'관측된 받침 도착을 잠시 기다림 · 바닥 후보 재검토',blocked:0,tested:0});continue;}
   if(options.length){
    const others=known.filter(b=>b!==box).sort((a,b)=>volume(b.observation.size)-volume(a.observation.size)).slice(0,3);
    const feasible=others.filter(b=>{checks++;return sites({...ctx,current:{...robotObservation(s.pallet,robot,b.observation),pickupPosition:robotToPallet(usesRoller(s.pallet)||usesBranches(s.pallet)&&b.flow?.transport?.kind==='branch'?movingPickup(b,w.time,w.stream!.speed,s.pallet,robot):beltPickup(b.observation,robot,s.pallet),s.pallet,pallet)}},`${w.runId}/${robot}/${pallet}/${cell.version}/${b.observation.id}`).length>0;});tested=feasible.length;
    let lowestLoss=Infinity;
    for(const c of options.slice(0,6)){
     let loss=0;
     for(const b of feasible){checks++;const fitKey=`${key}/${c.id}/${b.observation.id}`;let fits=fitCache.get(fitKey);
      if(fits===undefined){fits=sites({...ctx,current:{...robotObservation(s.pallet,robot,b.observation),pickupPosition:robotToPallet(usesRoller(s.pallet)||usesBranches(s.pallet)&&b.flow?.transport?.kind==='branch'?movingPickup(b,w.time,w.stream!.speed,s.pallet,robot):beltPickup(b.observation,robot,s.pallet),s.pallet,pallet)},placements:[...ctx.placements,c.placement],settings:{...settings,maxCandidates:48}}).length>0;if(fitCache.size>2048)fitCache.clear();fitCache.set(fitKey,fits);}
      if(!fits){
      const elsewhere=allPallets(w).some(other=>(other.robot!==robot||other.pallet!==pallet)&&other.state!.phase==='loading'&&sites(input(s,w,other.robot,b,other.pallet),`${w.runId}/${other.robot}/${other.pallet}/${other.cell.version}/${b.observation.id}`).length>0);
      if(!elsewhere)loss++;
     }}
     if(loss<lowestLoss){lowestLoss=loss;chosen=[c];}else if(loss===lowestLoss)chosen.push(c);
     if(loss===0&&chosen.length>=2)break;
    }
    blocked=Number.isFinite(lowestLoss)?lowestLoss:0;
    // A fragile cap is deferred while known load-bearing stock can still use this cell.
    const cap=box.observation.handling==='no-top-load'||box.observation.maxLoadKg===0;
    if(!usesRoller(s.pallet)&&!(usesBranches(s.pallet)&&box.flow?.transport?.kind==='branch')&&(blocked>0||cap&&feasible.some(b=>b.observation.maxLoadKg!==0&&b.observation.handling!=='no-top-load'))){
     chosen=[];reason=`후속 막힘 표본 ${blocked}/${tested}${cap?' · 상부용 박스 보류':''} · 벨트에서 재검토`;
    }else reason=`지지·하중·높이 통과 · 후속 막힘 표본 ${blocked}/${tested} · 이동 중 추적 집기`;
   }
   proposals.push({robot,pallet,boxId:box.observation.id,cellVersion:cell.version,candidates:chosen,reason,blocked,tested});
   if(chosen.length&&!central&&!w.secondaryCells)break;
  }
 }
 }
 // Compare valid placements on both pallets before robot/box assignment.
 const best=new Map<string,FlowProposal>();
 const quality=(p:FlowProposal)=>p.candidates.length? p.candidates[0].score-p.candidates[0].placement.position.z*.04-p.blocked*1000:-Infinity;
 for(const p of proposals){const key=`${p.robot}:${p.boxId}`,old=best.get(key);if(!old||quality(p)>quality(old))best.set(key,p);}
 const selected=[...best.values()];
 if(w.secondaryCells)for(const p of selected)p.reason=`팔레트 P${(p.pallet??0)+1} 선택 · 두 팔레트 지지·하중·경로 및 후속 공간 비교 · ${p.reason}`;
 if(usesBranches(s.pallet))for(const proposal of selected){const box=w.boxes.find(b=>b.observation.id===proposal.boxId)!;if(box.flow?.transport?.kind==='main')proposal.dispatchCost=w.boxes.filter(b=>b.status==='belt'&&b.flow?.transport?.robot===proposal.robot).length*3+palletCell(w,proposal.robot,proposal.pallet).placements.length*.15;}
 const assignment=central?assignCentrally(selected,busy):{};
 return {runId:w.runId,proposals:selected,...assignment,...(central?{cellVersions:allPallets(w).map(v=>v.cell.version)}:{}),milliseconds:performance.now()-start,checks};
}

// Recompute interception at launch time, not at the worker's earlier snapshot time.
export function interceptAction(s:Scenario,w:RelayWorld,p:FlowProposal,running:RelayAction[],failures:string[]=[]):RelayAction|undefined{
 const b=w.boxes.find(b=>b.observation.id===p.boxId),pallet=p.pallet??0,cell=palletCell(w,p.robot,pallet);
 if(!b||b.status!=='belt'||!b.flow||b.flow.measuredAt>w.time||p.cellVersion!==cell.version||palletState(w,p.robot,pallet).phase!=='loading'||running.some(a=>a.robot===p.robot))return;
 if(usesRoller(s.pallet)&&!atRollerStop(b,s.pallet)||usesBranches(s.pallet)&&!branchReady(b,p.robot))return;
 const g=s.constraints.gripper,idle=worldToPallet(park(p.robot,s.pallet),p.robot,s.pallet,pallet),speed=w.stream!.speed;
 for(const c of p.candidates){
  let approach=2;
  for(let iteration=0;iteration<16;iteration++){
   const startPickup=robotToPallet(movingPickup(b,w.time+approach,speed,s.pallet,p.robot),s.pallet,pallet),safe=c.path.points[0].tcp.z;
   const start={x:startPickup.x+b.observation.size.w/2,y:startPickup.y+b.observation.size.d/2,z:startPickup.z+b.observation.size.h};
   approach=(distance(idle,{...start,z:safe})+Math.abs(safe-start.z))/g.speed;
  }
  const graspAt=w.time+approach+g.pickSeconds,arc=beltArc(b,graspAt,speed,s.pallet)-stationArc(p.robot,s.pallet);
  if(!usesRoller(s.pallet)&&!usesBranches(s.pallet)&&Math.abs(arc)>1050){failures.push('추적 집기 구간을 지남');continue;}
  // The whole contact interval remains on the straight picking run.
  const startPickup=robotToPallet(movingPickup(b,w.time+approach,speed,s.pallet,p.robot),s.pallet,pallet),endPickup=robotToPallet(movingPickup(b,graspAt,speed,s.pallet,p.robot),s.pallet,pallet);
  if(Math.abs(startPickup.y-endPickup.y)>1e-5)continue;
  const checked=inspectConstraints(c.placement,{...b.observation,pickupPosition:endPickup},cell.placements,s.pallet,receiveConstraints(s));
  if(checked.reasons.length){failures.push(...checked.reasons);continue;}
  const original=directReturn(checked.path,idle,b.observation,checked.stack,receiveConstraints(s)),contact={x:endPickup.x+b.observation.size.w/2,y:endPickup.y+b.observation.size.d/2,z:endPickup.z+b.observation.size.h},contactStart={...contact,x:startPickup.x+b.observation.size.w/2,y:startPickup.y+b.observation.size.d/2};
  const first={...contactStart,z:original.points[0].tcp.z};
  const points:PathPoint[]=[{label:usesRoller(s.pallet)||usesBranches(s.pallet)?'롤러 선두 접근':'이동 박스 추적 접근',tcp:idle,carrying:false,hold:0,pose:0},{label:usesRoller(s.pallet)||usesBranches(s.pallet)?'정지대 상부':'벨트 속도에 동기화',tcp:first,carrying:false,hold:0,pose:0},{label:usesRoller(s.pallet)||usesBranches(s.pallet)?'정지 박스 접촉':'이동 중 접촉',tcp:contactStart,carrying:false,hold:0,pose:0},{label:usesRoller(s.pallet)||usesBranches(s.pallet)?'롤러 정지 · 파지':'벨트 추적 · 파지',tcp:contact,carrying:false,hold:0,pose:0},...original.points.slice(2),{label:'다음 박스 관찰',tcp:idle,carrying:false,hold:0,pose:0}];
  const segmentSeconds=[distance(idle,first)/g.speed,distance(first,contactStart)/g.speed,g.pickSeconds,...original.segmentSeconds.slice(1),distance(original.points.at(-1)!.tcp,idle)/g.speed];
  const seconds=segmentSeconds.reduce((a,b)=>a+b,0),path={...original,points,segmentSeconds,seconds};
  const releaseIndex=points.findIndex(pt=>pt.label==='내려놓기'),releaseAt=w.time+segmentSeconds.slice(0,releaseIndex).reduce((a,b)=>a+b,0);
  const a:RelayAction={runId:w.runId,revision:w.revision,cellVersion:p.cellVersion,robot:p.robot,pallet,kind:'place',boxId:p.boxId,from:p.robot,reason:usesRoller(s.pallet)||usesBranches(s.pallet)?p.reason.replace('이동 중 추적 집기',usesBranches(s.pallet)?'서브 벨트 선두 · 정지 집기':'롤러 정지대 · 순차 집기'):p.reason,candidate:{...c,placement:checked.placement,path},path,pickup:endPickup,seconds,initialCenter:palletToWorld({x:contact.x,y:contact.y,z:contact.z-b.observation.size.h/2},p.robot,s.pallet,pallet),tracking:{enteredAt:b.flow!.enteredAt,graspAt,releaseAt}};
  const bad=inspectMotion(s,w,a);if(!bad.length&&!running.some(other=>motionsConflict(s,w,a,other)))return a;
  failures.push(...(bad.length?bad:['운반 경로 예약 대기']));
 }return;
}
