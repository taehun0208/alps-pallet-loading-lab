import {rankAssignments} from './orchestrator';
import type {OrchestrationMode,OrchestrationSnapshot,AssignmentOffer} from './orchestrator';
import {candidateSet} from '../planner';
import {compactScore} from '../compactPacking';
import {inspectConstraints} from '../constraints';
import {COMPACT_SEARCH} from '../types';
import {volume} from '../geometry';
import {inPickWindow,movingPickup,stationArc,beltArc,loopLength} from './streamGeometry';
import {park,toLocal,toWorld} from './layout';
import {beltPickup} from './conveyor';
import {receiveConstraints,inspectMotion,motionsConflict} from './motion';
import {directReturn} from './streamReturn';
import type {Candidate,PlanningInput,Scenario,PathPoint,Vec3} from '../types';
import type {RelayWorld,RelayAction,RelayBox} from './types';

export interface FlowProposal {disposition?:'defer'|'no-candidate'|'offer';robot:number;boxId:string;cellVersion:number;candidates:Candidate[];candidateReasons?:Record<string,string>;reason:string;blocked:number;tested:number}
export interface FlowDecision {runId:string;proposals:FlowProposal[];milliseconds:number;checks:number;orchestration?:OrchestrationSnapshot;cellVersions?:number[];cellStates?:string[];snapshotTime?:number}
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const cache=new Map<string,Candidate[]>();
const diagnostics=new Map<string,string>();
const fitCache=new Map<string,boolean>();
const settings={...COMPACT_SEARCH,policy:'legacy' as const,inventoryMode:'none' as const,temporaryBuffer:false,maxCandidates:64,portfolio:false};

// This boundary deliberately excludes the future input manifest and unmeasured boxes.
export function observedProblem(s:Scenario,w:RelayWorld){
 const world=structuredClone(w);world.boxes=world.boxes.filter(b=>b.status==='placed'||b.flow&&b.flow.measuredAt<=w.time);
 const ids=new Set(world.boxes.map(b=>b.observation.typeId));
 return {scenario:{...structuredClone(s),types:s.types.filter(t=>ids.has(t.id)),events:[]},world};
}
function input(s:Scenario,w:RelayWorld,robot:number,b:RelayBox):PlanningInput{
 return {runId:w.runId,stepId:w.revision,pallet:s.pallet,types:s.types,constraints:receiveConstraints(s),placements:w.cells[robot].placements,current:{...b.observation,pickupPosition:beltPickup(b.observation,robot,s.pallet)},remaining:{},algorithm:'greedy',settings};
}
/** Compact cell ranking shared by the stream planner and the single-robot comparison. */
export function rankCompactSites(ctx:PlanningInput,options:{smallFloorPenalty?:boolean}={}){
 const inspected=candidateSet(ctx,true).candidates,candidates=inspected.filter(c=>c.valid);
 for(const c of candidates){compactScore(c,ctx);
  // Small parcels use existing broad supports first, preserving floor for unknown large arrivals.
  if((options.smallFloorPenalty??true)&&ctx.placements.length&&c.placement.position.z===0&&volume(c.placement.size)<35e6)c.score-=100;
 }
 candidates.sort((a,b)=>(a.placement.position.z-b.placement.position.z)*.04+b.score-a.score);
 return {inspected,candidates};
}
function sites(ctx:PlanningInput,key?:string){
 if(key&&cache.has(key))return structuredClone(cache.get(key)!);
 const {inspected,candidates}=rankCompactSites(ctx);
 if(key){if(cache.size>600){cache.clear();diagnostics.clear();}cache.set(key,structuredClone(candidates));
  const reasons=new Map<string,number>();for(const c of inspected)for(const reason of c.reasons)reasons.set(reason,(reasons.get(reason)||0)+1);
  diagnostics.set(key,[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,2).map(r=>r[0]).join(' / '));
 }return candidates;
}
export function planIndependentStream(s:Scenario,w:RelayWorld,busy:number[]=[]):FlowDecision{
 const start=performance.now(),proposals:FlowProposal[]=[];let checks=0;
 const known=w.boxes.filter(b=>b.status==='belt'&&b.flow!.measuredAt<=w.time);
 for(let robot=0;robot<4;robot++){
  if(busy.includes(robot)||w.stream!.cells[robot].phase!=='loading')continue;
  const eligible=known.filter(b=>inPickWindow(b,w.time,w.stream!.speed,s.pallet,robot)&&(!b.flow!.checks[robot]||b.flow!.checks[robot].version!==w.cells[robot].version||w.time-b.flow!.checks[robot].at>(b.flow!.checks[robot].retryAfter??25)))
   .sort((a,b)=>beltArc(b,w.time,w.stream!.speed,s.pallet)-beltArc(a,w.time,w.stream!.speed,s.pallet)).slice(0,2);
  for(const box of eligible){
   const ctx=input(s,w,robot,box),key=`${w.runId}/${robot}/${w.cells[robot].version}/${box.observation.id}`,options=sites(ctx,key);checks++;
   let chosen:Candidate[]=[],blocked=0,tested=0,reason='현재 지지·하중·높이 조건을 만족하는 위치 없음 · 그대로 순환';
   if(!options.length&&diagnostics.get(key))reason=`${diagnostics.get(key)} · 그대로 순환`;
   const dims=Object.values(box.observation.size).sort((a,b)=>b-a),foundation=dims[0]*dims[1]>=180000&&box.observation.weight>=6&&box.observation.maxLoadKg!==0&&box.observation.handling!=='no-top-load';
   const cellAge=w.time-w.stream!.cells[robot].since;
   const incomingFoundation=known.some(b=>b!==box&&b.observation.weight>=6&&b.observation.maxLoadKg!==0&&b.observation.handling!=='no-top-load'&&b.observation.size.w*b.observation.size.d>=180000&&stationArc(robot,s.pallet)-beltArc(b,w.time,w.stream!.speed,s.pallet)>0&&stationArc(robot,s.pallet)-beltArc(b,w.time,w.stream!.speed,s.pallet)<w.stream!.speed*20);
   if(!ctx.placements.length&&!foundation&&!w.stream!.inputClosed&&box.flow!.passes<1&&(cellAge<10||incomingFoundation&&cellAge<30)){proposals.push({robot,boxId:box.observation.id,cellVersion:w.cells[robot].version,candidates:[],disposition:'defer',reason:'관측된 받침 도착을 잠시 기다림 · 바닥 후보 재검토',blocked:0,tested:0});continue;}
   if(options.length){
    const others=known.filter(b=>b!==box).sort((a,b)=>volume(b.observation.size)-volume(a.observation.size)).slice(0,3);
    const feasible=others.filter(b=>{checks++;return sites({...ctx,current:{...b.observation,pickupPosition:beltPickup(b.observation,robot,s.pallet)}},`${w.runId}/${robot}/${w.cells[robot].version}/${b.observation.id}`).length>0;});tested=feasible.length;
    let lowestLoss=Infinity;
    for(const c of options.slice(0,6)){
     let loss=0;
     for(const b of feasible){checks++;const fitKey=`${key}/${c.id}/${b.observation.id}`;let fits=fitCache.get(fitKey);
      if(fits===undefined){fits=sites({...ctx,current:{...b.observation,pickupPosition:beltPickup(b.observation,robot,s.pallet)},placements:[...ctx.placements,c.placement],settings:{...settings,maxCandidates:48}}).length>0;if(fitCache.size>2048)fitCache.clear();fitCache.set(fitKey,fits);}
      if(!fits){
      const elsewhere=w.cells.some((cell,other)=>other!==robot&&w.stream!.cells[other].phase==='loading'&&sites(input(s,w,other,b),`${w.runId}/${other}/${cell.version}/${b.observation.id}`).length>0);
      if(!elsewhere)loss++;
     }}
     if(loss<lowestLoss){lowestLoss=loss;chosen=[c];}else if(loss===lowestLoss)chosen.push(c);
     if(loss===0&&chosen.length>=2)break;
    }
    blocked=Number.isFinite(lowestLoss)?lowestLoss:0;
    // A fragile cap is deferred while known load-bearing stock can still use this cell.
    const cap=box.observation.handling==='no-top-load'||box.observation.maxLoadKg===0;
    if(blocked>0||cap&&feasible.some(b=>b.observation.maxLoadKg!==0&&b.observation.handling!=='no-top-load')){
     chosen=[];reason=`후속 막힘 표본 ${blocked}/${tested}${cap?' · 상부용 박스 보류':''} · 벨트에서 재검토`;
    }else reason=`지지·하중·높이 통과 · 후속 막힘 표본 ${blocked}/${tested} · 이동 중 추적 집기`;
   }
   proposals.push({robot,boxId:box.observation.id,cellVersion:w.cells[robot].version,candidates:chosen,reason,blocked,tested,disposition:chosen.length?'offer':options.length?'defer':'no-candidate'});
   if(chosen.length)break;
  }
 }
 return {runId:w.runId,proposals,milliseconds:performance.now()-start,checks};
}

/** Central coordinator only considers measured belt stock, never the future manifest.
 * At most eight observed offers x four cells x three observed fit probes are ranked.
 * Downstream allocations are soft intentions: physical reservation occurs only at launch.
 */
export function planStream(s:Scenario,w:RelayWorld,busy:number[]=[],mode:OrchestrationMode=w.stream?.orchestrationMode??'central'):FlowDecision{
 const start=performance.now(),objective=w.stream?.orchestrationObjective??'throughput';
 const known=w.boxes.filter(b=>b.status==='belt'&&b.flow&&b.flow.measuredAt<=w.time);
 if(mode==='independent')return {...planIndependentStream(s,w,busy),orchestration:{mode,objective,at:w.time,observedBoxes:known.length,evaluatedBids:0,assignments:[]}};
 const local:FlowDecision={runId:w.runId,proposals:[],milliseconds:0,checks:0};
 // Central planning bypasses independent-cell policy deferrals and its lookahead.
 for(let robot=0;robot<w.cells.length;robot++){
  if(busy.includes(robot)||w.stream!.cells[robot].phase!=='loading')continue;
  const eligible=known.filter(b=>inPickWindow(b,w.time,w.stream!.speed,s.pallet,robot)&&(!b.flow!.checks[robot]||b.flow!.checks[robot].version!==w.cells[robot].version||w.time-b.flow!.checks[robot].at>(b.flow!.checks[robot].retryAfter??25)))
   .sort((a,b)=>beltArc(b,w.time,w.stream!.speed,s.pallet)-beltArc(a,w.time,w.stream!.speed,s.pallet)).slice(0,2);
  for(const b of eligible){
   const candidates=sites(input(s,w,robot,b),`${w.runId}/${robot}/${w.cells[robot].version}/${b.observation.id}`);local.checks++;
   local.proposals.push({robot,boxId:b.observation.id,cellVersion:w.cells[robot].version,candidates,blocked:0,tested:0,disposition:candidates.length?'offer':'no-candidate',reason:candidates.length?'기하·지지·하중 모델 검사 통과':'제한된 후보 탐색에서 배치 후보 없음 · 다음 구역에서 재검토'});
  }
 }
 const offers:AssignmentOffer[]=[],byPair=new Map<string,FlowProposal>();let probes=0;
 const capacity=s.pallet.width*s.pallet.depth*s.pallet.maxHeight;
 const completedWork=w.cells.map((_,robot)=>w.records.filter(r=>r.robot===robot).reduce((seconds,r)=>seconds+Math.max(0,r.finished-r.started),0));
 const maxWork=Math.max(10,...completedWork);
 for(const boxId of [...new Set(local.proposals.map(p=>p.boxId))]){
  const box=known.find(b=>b.observation.id===boxId)!;
  const offer:AssignmentOffer={boxId,passes:box.flow!.passes,bids:[]};
  for(let robot=0;robot<w.cells.length;robot++){
   if(busy.includes(robot)||w.stream!.cells[robot].phase!=='loading')continue;
   const eligible=inPickWindow(box,w.time,w.stream!.speed,s.pallet,robot);
   const delta=(stationArc(robot,s.pallet)-1050-beltArc(box,w.time,w.stream!.speed,s.pallet)+loopLength(s.pallet))%loopLength(s.pallet);
   const arrivalSeconds=eligible?0:delta/w.stream!.speed;
   if(arrivalSeconds>20||!eligible&&box.flow!.passes>=1)continue;
   const ctx=input(s,w,robot,box),key=`${w.runId}/${robot}/${w.cells[robot].version}/${boxId}`;
   const current=local.proposals.find(p=>p.robot===robot&&p.boxId===boxId);
   const options=current?current.candidates:sites(ctx,key);probes++;
   if(!options.length)continue;
   // Evaluate a bounded shortlist; support/path constraints already filtered these sites.
   const sample=known.filter(b=>b.observation.id!==boxId).sort((a,b)=>volume(b.observation.size)-volume(a.observation.size)).slice(0,3);
   const before=sample.filter(b=>{probes++;return sites(input(s,w,robot,b),`${w.runId}/${robot}/${w.cells[robot].version}/${b.observation.id}`).length>0;});
   const ranked:{candidate:Candidate;score:number;fit:number}[]=[];
   for(const candidate of options.slice(0,2)){
    let retained=0;
    for(const b of before){probes++;const fitKey=`${key}/${candidate.id}/${b.observation.id}`;let fit=fitCache.get(fitKey);
     if(fit===undefined){fit=sites({...ctx,current:{...b.observation,pickupPosition:beltPickup(b.observation,robot,s.pallet)},placements:[...ctx.placements,candidate.placement],settings:{...settings,maxCandidates:48}}).length>0;if(fitCache.size>2048)fitCache.clear();fitCache.set(fitKey,fit);}
     if(fit)retained++;
    }
    const fit=before.length?retained/before.length:1;
    const height=(candidate.placement.position.z+candidate.placement.size.h)/s.pallet.maxHeight;
    const workloadBalance=1-completedWork[robot]/maxWork;
    const consolidation=ctx.placements.reduce((v,p)=>v+volume(p.size),0)/capacity;
    const operationalPreference=objective==='balanced'?workloadBalance:consolidation;
    // Bounded preference for underused cells counteracts upstream arrival advantage.
    // It cannot create a bid for an invalid placement, busy robot or unreachable window.
    const score=45*fit+25*(1-height)+20/(1+(arrivalSeconds+candidate.path.seconds)/10)+10*operationalPreference;
    ranked.push({candidate,score,fit});
   }
   ranked.sort((a,b)=>b.score-a.score);const best=ranked[0];if(!best)continue;
   const remainingVolumeRatio=Math.max(0,1-(ctx.placements.reduce((v,p)=>v+volume(p.size),0)+volume(box.observation.size))/capacity);
   const reason=`관측 후속 수용 ${Math.round(best.fit*100)}% (${before.length}개 표본) · 배치 후 빈 부피 ${Math.round(remainingVolumeRatio*100)}% · 도착 ${arrivalSeconds.toFixed(1)}초 · 누적 작업 ${completedWork[robot].toFixed(1)}초`;
   offer.bids.push({robot,score:best.score,arrivalSeconds,workSeconds:best.candidate.path.seconds,remainingVolumeRatio,futureFitRatio:best.fit,eligible,reason});
   byPair.set(`${boxId}/${robot}`,{disposition:'offer',robot,boxId,cellVersion:w.cells[robot].version,candidates:ranked.map(r=>r.candidate),candidateReasons:Object.fromEntries(ranked.map(r=>[r.candidate.id,`중앙 배정 R${robot+1} · 후보 점수 ${r.score.toFixed(1)} · 관측 후속 수용 ${Math.round(r.fit*100)}% (${before.length}개 표본)`])),reason,blocked:Math.round(before.length*(1-best.fit)),tested:before.length});
  }
  offers.push(offer);
 }
 const assignments=rankAssignments(offers);
 // Preserve pair-specific negative search results even if another cell gets the box.
 // These diagnostics execute before reservations, so a successful assignment cannot hide them.
 const proposals:FlowProposal[]=[...local.proposals.filter(p=>p.disposition==='no-candidate'),
  ...assignments.filter(a=>a.launchNow).map(a=>({...byPair.get(`${a.boxId}/${a.robot}`)!,reason:a.reason}))];
 return {runId:w.runId,proposals,milliseconds:performance.now()-start,checks:local.checks+probes,
  snapshotTime:w.time,cellVersions:w.cells.map(c=>c.version),cellStates:w.stream!.cells.map(c=>`${c.phase}/${c.cycle}`),orchestration:{mode,objective,at:w.time,observedBoxes:known.length,evaluatedBids:offers.reduce((n,o)=>n+o.bids.length,0),assignments}};
}

export interface InterceptFailure {kind:'transient'|'candidate-invalid';reason:string}
// Recompute interception at launch time, not at the worker's earlier snapshot time.
export function interceptAction(s:Scenario,w:RelayWorld,p:FlowProposal,running:RelayAction[],failures:InterceptFailure[]=[]):RelayAction|undefined{
 const b=w.boxes.find(b=>b.observation.id===p.boxId);
 if(!b||b.status!=='belt'||p.cellVersion!==w.cells[p.robot].version||w.stream!.cells[p.robot].phase!=='loading'||running.some(a=>a.robot===p.robot))return;
 const g=s.constraints.gripper,idle=toLocal(park(p.robot,s.pallet),p.robot,s.pallet),speed=w.stream!.speed;
 for(const c of p.candidates){
  let approach=2,interceptResidual=Infinity;
  for(let iteration=0;iteration<16;iteration++){
   const startPickup=movingPickup(b,w.time+approach,speed,s.pallet,p.robot),safe=c.path.points[0].tcp.z;
   const start={x:startPickup.x+b.observation.size.w/2,y:startPickup.y+b.observation.size.d/2,z:startPickup.z+b.observation.size.h};
   const updated=(distance(idle,{...start,z:safe})+Math.abs(safe-start.z))/g.speed;interceptResidual=Math.abs(updated-approach);approach=updated;
  }
  if(!Number.isFinite(approach)||interceptResidual>1e-4){failures.push({kind:'transient',reason:'추적 집기 시간 수렴 실패'});continue;}
  const graspAt=w.time+approach+g.pickSeconds,arc=beltArc(b,graspAt,speed,s.pallet)-stationArc(p.robot,s.pallet);
  if(Math.abs(arc)>1050){failures.push({kind:'transient',reason:'추적 집기 구간을 지남'});continue;}
  // The whole contact interval remains on the straight picking run.
  const startPickup=movingPickup(b,w.time+approach,speed,s.pallet,p.robot),endPickup=movingPickup(b,graspAt,speed,s.pallet,p.robot);
  if(Math.abs(startPickup.y-endPickup.y)>1e-5){failures.push({kind:'transient',reason:'직선 추적 집기 구간 밖'});continue;}
  const checked=inspectConstraints(c.placement,{...b.observation,pickupPosition:endPickup},w.cells[p.robot].placements,s.pallet,receiveConstraints(s));
  if(checked.reasons.length){failures.push(...checked.reasons.map(reason=>({kind:'candidate-invalid' as const,reason})));continue;}
  const original=directReturn(checked.path,idle,b.observation,checked.stack,receiveConstraints(s)),contact={x:endPickup.x+b.observation.size.w/2,y:endPickup.y+b.observation.size.d/2,z:endPickup.z+b.observation.size.h},contactStart={...contact,x:startPickup.x+b.observation.size.w/2,y:startPickup.y+b.observation.size.d/2};
  const first={...contactStart,z:original.points[0].tcp.z};
  const verifiedApproach=(distance(idle,first)+distance(first,contactStart))/g.speed;
  if(Math.abs(verifiedApproach-approach)>1e-4){failures.push({kind:'transient',reason:'검증 경로의 접근 높이 변경 · 재계획 필요'});continue;}
  const points:PathPoint[]=[{label:'이동 박스 추적 접근',tcp:idle,carrying:false,hold:0,pose:0},{label:'벨트 속도에 동기화',tcp:first,carrying:false,hold:0,pose:0},{label:'이동 중 접촉',tcp:contactStart,carrying:false,hold:0,pose:0},{label:'벨트 추적 · 파지',tcp:contact,carrying:false,hold:0,pose:0},...original.points.slice(2),{label:'다음 박스 관찰',tcp:idle,carrying:false,hold:0,pose:0}];
  const segmentSeconds=[distance(idle,first)/g.speed,distance(first,contactStart)/g.speed,g.pickSeconds,...original.segmentSeconds.slice(1),distance(original.points.at(-1)!.tcp,idle)/g.speed];
  const seconds=segmentSeconds.reduce((a,b)=>a+b,0),path={...original,points,segmentSeconds,seconds,lengthMm:points.slice(1).reduce((sum,p,i)=>sum+distance(points[i].tcp,p.tcp),0)};
  const releaseIndex=points.findIndex(pt=>pt.label==='내려놓기'),releaseAt=w.time+segmentSeconds.slice(0,releaseIndex).reduce((a,b)=>a+b,0);
  const a:RelayAction={runId:w.runId,revision:w.revision,cellVersion:p.cellVersion,robot:p.robot,kind:'place',boxId:p.boxId,from:p.robot,reason:p.candidateReasons?.[c.id]??p.reason,candidate:{...c,placement:checked.placement,path},path,pickup:endPickup,seconds,initialCenter:toWorld({x:contact.x,y:contact.y,z:contact.z-b.observation.size.h/2},p.robot,s.pallet),tracking:{enteredAt:b.flow!.enteredAt,graspAt,releaseAt}};
  const bad=inspectMotion(s,w,a);if(!bad.length&&!running.some(other=>motionsConflict(s,w,a,other)))return a;
  failures.push(...(bad.length?bad.map(reason=>({kind:'candidate-invalid' as const,reason})):[{kind:'transient' as const,reason:'운반 경로 예약 대기'}]));
 }return;
}
