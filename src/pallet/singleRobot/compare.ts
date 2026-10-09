import { plan } from '../planner';
import { inspectConstraints,constraintMeter } from '../constraints';
import { candidateMeter } from '../candidates';
import { stability } from '../stability';
import { volume,top,intersects,EPS } from '../geometry';
import { loadSummary } from '../features';
import { loadCom,comOffsetRatio,transportMargin,palletUnitMargin,slidingRisk,type PalletUnitModel } from '../palletCom';
import { rankCompactSites } from '../relay/streamPlanner';
import { isStrategy,type ReservationState } from '../strategies/PackingStrategy';
import { HARNESS_VERSION,TRANSPORT_G,type SingleRobotPolicy } from './config';
import type { CaseInput,HarnessEvent } from './situations';
import type { Algorithm,Analysis,BoxType,Candidate,Observation,Placement,PlanningInput,Scenario } from '../types';

export type { SingleRobotPolicy } from './config';
/** Observation-only hook: sees every planner input with the harness inventory state. */
export type PlannerAudit=(input:PlanningInput,state:{buffered:readonly Observation[];placedTotal:number;unplaceable:number;total:number})=>void;
export interface RunOptions { audit?:PlannerAudit;palletUnit?:PalletUnitModel;transportG?:number[] }

type Status='pass'|'fail'|'unverified';
export interface HistoryEntry { seq:number;arrival:number;action:'missing'|'arrive'|'isolate-damaged'|'place'|'no-candidate'|'commit-reject'|'remeasure'|'buffer'|'unbuffer'|'unplaceable'|'close'|'event';box?:string;pallet:number;position?:{x:number;y:number;z:number};orientation?:string|number;reasons?:string[];ms?:number;note?:string }
export interface EventRecord { event:HarnessEvent;box?:string;outcome:string;before:{pallet:number;boxesOnPallet:number;buffered:number};after?:{pallet:number;boxesOnPallet:number;buffered:number};replans:number;plannerMs:number }
export interface PalletRecord {
 index:number;closedBy:'candidate-exhaustion'|'buffer-flush'|'order-complete'|'quarantined';boxes:number;mass:number;volume:number;fill:number;heightMm:number;
 comOffset:number|null;comHeightMm:number|null;minSupportRatio:number;minLocalReserveMm:number;loadUtilization:number;unknownCapacity:number;
 transport:{loose:Record<string,number>;wrapped:Record<string,number>;palletUnit:Record<string,number>|null};slidingBoxes:Record<string,number>;
 audit:{violations:Record<string,number>;checks:Record<string,Status>};
}
export interface SingleRobotRun {
 schema:'single-robot-run/2';harness:string;situation:string;phase:string;policy:string;seeds:CaseInput['seeds'];source:CaseInput['source'];
 config:{policy:SingleRobotPolicy;bufferSize:number;pallet:Scenario['pallet'];constraints:Scenario['constraints'];transportG:number[];palletUnit:PalletUnitModel|null};
 events:HarnessEvent[];
 fitness:{status:Status;violations:Record<string,number>;checks:Record<string,Status>;scope:string;quarantinedPallets:number};
 performance:{total:number;arrived:number;missing:number;isolatedDamaged:number;unplaceable:number;quarantinedBoxes:number;completed:number;placedTotal:number;demand:number;completionRate:number|null;
  pallets:number;utilization:number|null;closedFillMean:number|null;closeReasons:Record<string,number>};
 stability:{minSupportRatio:number|null;minLocalReserveMm:number|null;meanComOffset:number|null;worstComOffset:number|null;maxComHeightMm:number|null;maxLoadUtilization:number|null;
  transport:{loose:Record<string,number|null>;wrapped:Record<string,number|null>;palletUnit:Record<string,number|null>|null};slidingBoxes:Record<string,number>};
 robot:{placementSeconds:number;bufferHandlingSeconds:null;palletExchangeSeconds:null;excluded:string[];rehandles:number;commitRejected:number;feasibilityRejections:Record<string,number>};
 compute:{samplesMs:number[];sampleKinds:('first'|'retry')[];plannerCalls:number};
 effort:{plannerCalls:number;candidateSets:number;candidatesGenerated:number;candidatesChecked:number;constraintChecks:number;searchNodes:number|null;rolloutCalls:number|null};
 robustness:{events:number;outcomes:Record<string,number>;records:EventRecord[];success:boolean};
 history:HistoryEntry[];pallets:PalletRecord[];
}

/** Order-free planner catalogue: canonical sort by physical properties, opaque IDs and names. */
export function catalogue(types:readonly BoxType[]){
 const seen=new Set<string>();for(const t of types){if(seen.has(t.id))throw Error(`중복 상품 ID: ${t.id}`);seen.add(t.id);}
 const key=(t:BoxType)=>JSON.stringify([t.size.w,t.size.d,t.size.h,t.weight,t.orientations,t.handling??'',t.material??'',t.maxLoadKg??null,t.maxLoadByAxis??null,t.strengthFactor??null,t.friction??null,t.packaging??null]);
 const sorted=[...types].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0),toOpaque=new Map<string,string>();
 const list=sorted.map((t,i)=>{const id=`T${String(i+1).padStart(3,'0')}`;toOpaque.set(t.id,id);return {...structuredClone(t),id,name:id,color:'#9aa5a0'};});
 return {types:list,toOpaque};
}
function observe(t:BoxType,id:string,over?:{size?:BoxType['size'];weight?:number}):Observation{
 return {id,typeId:t.id,size:{...(over?.size??t.size)},weight:over?.weight??t.weight,status:'normal',orientationAllowed:[...t.orientations],packaging:t.packaging,maxLoadKg:t.maxLoadKg,
  maxLoadSource:t.maxLoadSource,maxLoadByAxis:t.maxLoadByAxis,handling:t.handling,material:t.material,strengthFactor:t.strengthFactor,friction:t.friction};
}
function validateCase(c:CaseInput){
 if(!Number.isInteger(c.bufferSize)||c.bufferSize<0)throw Error('버퍼 용량은 0 이상의 정수여야 합니다.');
 const counts=new Map<string,number>();for(const id of c.sequence)counts.set(id,(counts.get(id)??0)+1);
 for(const t of c.scenario.types)if((counts.get(t.id)??0)!==t.quantity)throw Error(`입고 순서와 수량 불일치: ${t.id}`);
 if(c.sequence.length!==c.scenario.types.reduce((n,t)=>n+t.quantity,0))throw Error('입고 순서에 카탈로그에 없는 상품이 있습니다.');
 const at=new Set<number>();for(const e of c.events){if(!Number.isInteger(e.at)||e.at<0||e.at>=c.sequence.length||at.has(e.at))throw Error(`사건 위치 오류: ${e.kind}@${e.at}`);at.add(e.at);}
}
const category=(reason:string)=>/^SUPPORT|지지 조건/.test(reason)?'support':/무게 규칙/.test(reason)?'heavy-rule':/재질 허용|LOAD:|하중/.test(reason)?'load':/무게중심|평형|전도/.test(reason)?'local-stability':
 /기둥|slender/i.test(reason)?'slenderness':/세로 박스|높이 부족|돌출 높이/.test(reason)?'standing-height':/겹침|경계 밖|최대 적재 높이|바닥 아래/.test(reason)?'geometry':/TRANSPORT/.test(reason)?'transport':/그리퍼|작업공간|도달|가반/.test(reason)?'robot':'other';

/**
 * Independent re-verification of a final stack: geometry without the planner checks, then a
 * rebuild that re-inspects every box in commit order against the boxes before it.
 */
export function auditStack(stack:readonly Placement[],s:Scenario,observed:Map<string,Observation>){
 const p=s.pallet,violations:Record<string,number>={},add=(k:string)=>violations[k]=(violations[k]??0)+1;
 for(const b of stack){if(b.position.x< -EPS||b.position.y< -EPS||b.position.z< -EPS||b.position.x+b.size.w>p.width+EPS||b.position.y+b.size.d>p.depth+EPS||top(b)>p.maxHeight+EPS)add('geometry');}
 for(let i=0;i<stack.length;i++)for(let j=i+1;j<stack.length;j++)if(intersects(stack[i],stack[j],s.constraints.horizontalGap))add('geometry');
 let rebuilt:Placement[]=[];const c={...s.constraints,robotMode:'ideal' as const};
 for(const b of stack){const o=observed.get(b.id);if(!o){add('other');continue;}
  const r=inspectConstraints({...b,supports:[],supportRatio:0,loadAbove:0},o,rebuilt,p,c);for(const reason of new Set(r.reasons.map(category)))add(reason);rebuilt=r.stack;}
 const loads=loadSummary([...stack],s.constraints.stability),cats=['geometry','support','heavy-rule','load','local-stability','slenderness','standing-height'];
 const checks:Record<string,Status>=Object.fromEntries(cats.map(k=>[k,violations[k]?'fail':'pass']));
 if(!violations.load&&loads.unknownCapacity>0)checks.load='unverified';
 Object.assign(checks,{'robot-path-approximate':'pass','robot-joint-ik':'unverified','measured-compression-strength':'unverified','dynamic-transport':'unverified'});
 return {violations,checks,rebuilt,loads};
}

function choose(policy:SingleRobotPolicy,input:PlanningInput){
 const start=performance.now();
 if(policy.algorithm==='compact'){const {candidates,inspected}=rankCompactSites(input,{smallFloorPenalty:policy.smallFloorPenalty});
  const rejections:Record<string,number>={};if(!candidates.length)for(const c of inspected)for(const r of c.reasons)rejections[category(r)]=(rejections[category(r)]??0)+1;
  return {candidate:candidates[0] as Candidate|undefined,analysis:null as Analysis|null,rejections,ms:performance.now()-start};}
 const analysis=plan(input),candidate=analysis.candidates.find(c=>c.id===analysis.selectedId&&c.valid),rejections:Record<string,number>={};
 if(!candidate)for(const [r,n] of Object.entries(analysis.rejections))rejections[category(r)]=(rejections[category(r)]??0)+n;
 return {candidate,analysis,rejections,ms:performance.now()-start};
}

/**
 * Runs one case on a single robot cell. The environment owns the arrival sequence and events and
 * reveals each only at its arrival index. Planners see an order-free catalogue, the current box,
 * the placed stack and remaining demand split into not-yet-arrived and buffered boxes.
 * A box with no valid candidate waits in the buffer (capacity per case; 0 during buffer-down).
 * When the buffer is full the pallet is closed and the box retried on an empty pallet; a box that
 * fits no empty pallet is isolated as unplaceable. Every commit is rechecked; every closed pallet
 * is independently re-audited; box conservation is asserted at the end.
 */
export function runSingleRobot(c:CaseInput,policy:SingleRobotPolicy,options:RunOptions={}):SingleRobotRun{
 validateCase(c);
 const s=c.scenario,cat=catalogue(s.types),byOpaque=new Map(cat.types.map(t=>[t.id,t])),gs=options.transportG??TRANSPORT_G;
 const sequence=c.sequence.map(id=>cat.toOpaque.get(id)!),events=new Map(c.events.map(e=>[e.at,e])),total=sequence.length;
 const unarrived:Record<string,number>=Object.fromEntries(cat.types.map(t=>[t.id,t.quantity])),arrivedOfType:Record<string,number>={},corrected:Record<string,number>={};
 const effort={candidateSets:0,candidatesGenerated:0,candidatesChecked:0,constraintChecks:0},history:HistoryEntry[]=[],records:EventRecord[]=[],pallets:PalletRecord[]=[],samples:number[]=[],sampleKinds:('first'|'retry')[]=[];
 const observed=new Map<string,Observation>(),eventOf=new Map<string,EventRecord>(),feasibility:Record<string,number>={};
 type Entry={obs:Observation;truth?:Observation;tries:number;remeasured?:boolean};
 let placed:Placement[]=[],buffer:Entry[]=[],held:Entry|undefined,state:ReservationState|undefined,step=0,seq=0,arrival=-1,downUntil=-1;
 let placedTotal=0,unplaceable=0,missing=0,damaged=0,quarantinedBoxes=0,rehandles=0,commitRejected=0,placementSeconds=0,nodes=0,rollouts=0;
 const log=(e:Omit<HistoryEntry,'seq'|'arrival'|'pallet'>)=>history.push({seq:seq++,arrival,pallet:pallets.length,...e});
 const snapshot=()=>({pallet:pallets.length,boxesOnPallet:placed.length,buffered:buffer.length});
 const waiting=()=>held&&!buffer.includes(held)?[...buffer,held]:buffer;
 const demand=(except?:Entry)=>{const buffered:Record<string,number>={};for(const b of waiting())if(b!==except)buffered[b.obs.typeId]=(buffered[b.obs.typeId]??0)+1;
  const remaining:Record<string,number>={};for(const t of cat.types){const n=(unarrived[t.id]??0)+(buffered[t.id]??0);if(n)remaining[t.id]=n;}return {remaining,pending:{unarrived:{...unarrived},buffered}};};
 const input=(e:Entry):PlanningInput=>{const d=demand(e);return {runId:`${policy.id}`,stepId:step++,pallet:structuredClone(s.pallet),types:cat.types.map(x=>({...structuredClone(x),quantity:x.quantity-(corrected[x.id]??0)})),constraints:structuredClone(s.constraints),
  placements:structuredClone(placed),current:structuredClone(e.obs),remaining:d.remaining,pending:d.pending,algorithm:(policy.algorithm==='compact'?'greedy':policy.algorithm) as Algorithm,settings:{...structuredClone(policy.settings),plannerSeed:c.seeds.planner},
  ...(isStrategy(policy.algorithm)&&state?{strategyState:structuredClone(state)}:{})};};
 const attempt=(e:Entry):'placed'|'no-candidate'|'remeasure'|'rejected'=>{
  const planned=input(e);options.audit?.(planned,{buffered:waiting().filter(b=>b!==e).map(b=>b.obs),placedTotal,unplaceable,total});
  const m0={...candidateMeter},c0=constraintMeter.calls,r=choose(policy,planned);samples.push(r.ms);sampleKinds.push(e.tries++?'retry':'first');
  effort.candidateSets+=candidateMeter.calls-m0.calls;effort.candidatesGenerated+=candidateMeter.generated-m0.generated;effort.candidatesChecked+=candidateMeter.checked-m0.checked;effort.constraintChecks+=constraintMeter.calls-c0;nodes+=r.analysis?.nodes??0;rollouts+=r.analysis?.rolloutCalls??0;
  const er=eventOf.get(e.obs.id);if(er){er.replans++;er.plannerMs+=r.ms;}
  if(!r.candidate&&e.truth){log({action:'remeasure',box:e.obs.id,reasons:['후보 없음 · 버퍼 이동 전 실측']});e.obs=e.truth;delete e.truth;e.remeasured=true;return 'remeasure';}
  if(!r.candidate){for(const [k,n] of Object.entries(r.rejections))feasibility[k]=(feasibility[k]??0)+n;log({action:'no-candidate',box:e.obs.id,ms:r.ms,reasons:Object.keys(r.rejections)});return 'no-candidate';}
  const truth=e.truth??e.obs,checked=inspectConstraints(r.candidate.placement,truth,placed,s.pallet,s.constraints);
  if(checked.reasons.length){
   if(e.truth){log({action:'remeasure',box:e.obs.id,reasons:checked.reasons.slice(0,2)});e.obs=e.truth;delete e.truth;e.remeasured=true;return 'remeasure';}
   commitRejected++;log({action:'commit-reject',box:e.obs.id,reasons:checked.reasons.slice(0,3)});return 'rejected';
  }
  placed=checked.stack;placedTotal++;placementSeconds+=checked.path.seconds;observed.set(truth.id,truth);if(r.analysis?.strategyState)state=r.analysis.strategyState;
  const at=checked.placement;log({action:'place',box:e.obs.id,ms:r.ms,position:{...at.position},orientation:at.orientation});
  if(er){er.outcome=e.remeasured?'remeasured-placed':'placed';er.after=snapshot();}
  return 'placed';
 };
 const place=(e:Entry)=>{let r=attempt(e);if(r==='remeasure')r=attempt(e);return r==='placed';};
 const drain=()=>{let progress=true;while(progress){progress=false;for(const b of [...buffer])if(place(b)){buffer=buffer.filter(x=>x!==b);rehandles++;log({action:'unbuffer',box:b.obs.id});progress=true;}}};
 const close=(by:PalletRecord['closedBy'])=>{
  if(!placed.length)return;const rec=palletRecord(s,placed,pallets.length,by,observed,gs,options.palletUnit);pallets.push(rec);
  if(by==='quarantined'){quarantinedBoxes+=placed.length;for(const b of placed){const er=eventOf.get(b.id);if(er)er.outcome='placed-then-quarantined';}}log({action:'close',note:by});placed=[];state=undefined;
 };
 const capacity=()=>arrival<downUntil?0:c.bufferSize;
 const isolate=(e:Entry,why:string)=>{unplaceable++;log({action:'unplaceable',box:e.obs.id,note:why});const er=eventOf.get(e.obs.id);if(er){er.outcome='isolated-unplaceable';er.after=snapshot();}};
 for(arrival=0;arrival<total;arrival++){
  const typeId=sequence[arrival],t=byOpaque.get(typeId)!,ev=events.get(arrival);
  if(ev?.kind==='disturb'){const rec:EventRecord={event:ev,outcome:'not-applicable',before:snapshot(),replans:0,plannerMs:0};records.push(rec);
   if(placed.length){const i=placed.reduce((k,b,j)=>top(b)>top(placed[k])?j:k,0),moved=placed.map((b,j)=>j===i?{...b,position:{...b.position,x:b.position.x+ev.shiftMm!}}:b);
    const a=auditStack(moved,s,observed);log({action:'event',note:`disturb ${placed[i].id} +${ev.shiftMm}mm`});
    if(Object.keys(a.violations).length){placed=moved;close('quarantined');rec.outcome='pallet-quarantined';}else{placed=a.rebuilt;rec.outcome='verified-continue';}}
   rec.after=snapshot();}
  if(ev?.kind==='buffer-down'){downUntil=arrival+(ev.duration??1);records.push({event:ev,outcome:'buffer-unavailable',before:snapshot(),after:snapshot(),replans:0,plannerMs:0});log({action:'event',note:`buffer-down ${ev.duration}`});}
  unarrived[typeId]--;
  if(ev?.kind==='missing'){missing++;corrected[typeId]=(corrected[typeId]??0)+1;records.push({event:ev,outcome:'count-corrected',before:snapshot(),after:snapshot(),replans:0,plannerMs:0});log({action:'missing',note:typeId});continue;}
  const n=(arrivedOfType[typeId]=(arrivedOfType[typeId]??0)+1),id=`${typeId}#${n}`;
  if(ev?.kind==='damaged'){damaged++;corrected[typeId]=(corrected[typeId]??0)+1;records.push({event:ev,box:id,outcome:'isolated-damaged',before:snapshot(),after:snapshot(),replans:0,plannerMs:0});log({action:'isolate-damaged',box:id});continue;}
  const truth=ev?.kind==='resize'?observe(t,id,{size:ev.size,weight:ev.weight}):observe(t,id),e:Entry=ev?.kind==='mismeasure'?{obs:observe(t,id,{size:ev.size}),truth,tries:0}:{obs:truth,tries:0};
  if(ev?.kind==='resize'||ev?.kind==='mismeasure'){const rec:EventRecord={event:ev,box:id,outcome:'pending',before:snapshot(),replans:0,plannerMs:0};records.push(rec);eventOf.set(id,rec);}
  log({action:'arrive',box:id});held=e;
  if(place(e)){held=undefined;drain();continue;}
  if(buffer.length<capacity()){buffer.push(e);held=undefined;rehandles++;log({action:'buffer',box:id});continue;}
  close('candidate-exhaustion');
  if(place(e)){held=undefined;drain();continue;}
  // e failed on an empty pallet. Serve waiting boxes, then keep e waiting if a spot is free.
  drain();
  if(buffer.length<capacity()){buffer.push(e);held=undefined;rehandles++;log({action:'buffer',box:id});continue;}
  held=undefined;isolate(e,'빈 팔레트에도 유효 후보 없음');
 }
 arrival=total;drain();
 while(buffer.length){close('buffer-flush');const before=buffer.length;drain();if(buffer.length===before){for(const b of buffer)isolate(b,'주문 종료 · 빈 팔레트에도 유효 후보 없음');buffer=[];}}
 close('order-complete');
 for(const r of records)if(r.outcome==='pending'){r.outcome='unresolved';r.after=snapshot();}

 // Box conservation: every declared box ends in exactly one terminal state.
 const shipped=pallets.filter(p=>p.closedBy!=='quarantined'),completed=shipped.reduce((n,p)=>n+p.boxes,0);
 const placedIds=history.filter(h=>h.action==='place').map(h=>h.box!);
 if(new Set(placedIds).size!==placedIds.length)throw Error('중복 적재 검출');
 if(completed+quarantinedBoxes!==placedTotal||completed+quarantinedBoxes+unplaceable+damaged+missing!==total)throw Error(`박스 수량 보존 위반: ${completed}+${quarantinedBoxes}+${unplaceable}+${damaged}+${missing}≠${total}`);

 const violations:Record<string,number>={},checks:Record<string,Status>={};
 for(const p of shipped){for(const [k,n] of Object.entries(p.audit.violations))violations[k]=(violations[k]??0)+n;
  for(const [k,v] of Object.entries(p.audit.checks))checks[k]=checks[k]==='fail'||v==='fail'?'fail':checks[k]==='unverified'||v==='unverified'?'unverified':'pass';}
for(const k of Object.keys(violations))checks[k]='fail';
 const failed=Object.values(violations).some(n=>n>0)||Object.values(checks).includes('fail'),capacityMm3=s.pallet.width*s.pallet.depth*s.pallet.maxHeight,closed=shipped.filter(p=>p.closedBy!=='order-complete');
 const minOf=(f:(p:PalletRecord)=>number)=>shipped.length?Math.min(...shipped.map(f)):null,maxOf=(f:(p:PalletRecord)=>number)=>shipped.length?Math.max(...shipped.map(f)):null;
 const perG=(f:(p:PalletRecord)=>Record<string,number>|null)=>Object.fromEntries(gs.map(g=>[String(g),shipped.length&&shipped.every(p=>f(p))?Math.min(...shipped.map(p=>f(p)![String(g)])):null]));
 const offsets=shipped.filter(p=>p.comOffset!==null).map(p=>p.comOffset!),closeReasons:Record<string,number>={};for(const p of pallets)closeReasons[p.closedBy]=(closeReasons[p.closedBy]??0)+1;
 const demandTotal=total-missing-damaged,outcomes:Record<string,number>={};for(const r of records)outcomes[r.outcome]=(outcomes[r.outcome]??0)+1;
 const completionRate=demandTotal?completed/demandTotal:null;
 return {schema:'single-robot-run/2',harness:HARNESS_VERSION,situation:c.situation,phase:c.phase,policy:policy.id,seeds:c.seeds,source:c.source,
  config:{policy:structuredClone(policy),bufferSize:c.bufferSize,pallet:structuredClone(s.pallet),constraints:structuredClone(s.constraints),transportG:gs,palletUnit:options.palletUnit??null},
  events:structuredClone(c.events),
  fitness:{status:failed?'fail':shipped.length?'pass':'unverified',violations,checks,scope:'출고 팔레트 최종 상태의 독립 재검사(기하·지지·하중 규칙·재질 하중·국부 안정·높이 규칙) + 매 확정 시 공통 제약 재검사',quarantinedPallets:pallets.length-shipped.length},
  performance:{total,arrived:total-missing,missing,isolatedDamaged:damaged,unplaceable,quarantinedBoxes,completed,placedTotal,demand:demandTotal,completionRate,
   pallets:shipped.length,utilization:shipped.length?shipped.reduce((n,p)=>n+p.volume,0)/(shipped.length*capacityMm3):null,closedFillMean:closed.length?closed.reduce((n,p)=>n+p.fill,0)/closed.length:null,closeReasons},
  stability:{minSupportRatio:minOf(p=>p.minSupportRatio),minLocalReserveMm:minOf(p=>p.minLocalReserveMm),meanComOffset:offsets.length?offsets.reduce((a,b)=>a+b,0)/offsets.length:null,worstComOffset:offsets.length?Math.max(...offsets):null,
   maxComHeightMm:shipped.some(p=>p.comHeightMm!==null)?Math.max(...shipped.filter(p=>p.comHeightMm!==null).map(p=>p.comHeightMm!)):null,maxLoadUtilization:maxOf(p=>p.loadUtilization),
   transport:{loose:perG(p=>p.transport.loose),wrapped:perG(p=>p.transport.wrapped),palletUnit:options.palletUnit?perG(p=>p.transport.palletUnit):null},
   slidingBoxes:Object.fromEntries(gs.map(g=>[String(g),shipped.reduce((n,p)=>n+p.slidingBoxes[String(g)],0)]))},
  robot:{placementSeconds,bufferHandlingSeconds:null,palletExchangeSeconds:null,excluded:['buffer-handling','pallet-exchange'],rehandles,commitRejected,feasibilityRejections:feasibility},
  compute:{samplesMs:samples,sampleKinds,plannerCalls:samples.length},
  effort:{plannerCalls:samples.length,...effort,searchNodes:policy.algorithm==='compact'?null:nodes,rolloutCalls:policy.algorithm==='compact'?null:rollouts},
  robustness:{events:records.length,outcomes,records,success:completionRate===1&&!failed},
  history,pallets};
}

function palletRecord(s:Scenario,placed:Placement[],index:number,closedBy:PalletRecord['closedBy'],observed:Map<string,Observation>,gs:number[],unit?:PalletUnitModel):PalletRecord{
 const p=s.pallet,{mass,center}=loadCom(placed),v=placed.reduce((n,b)=>n+volume(b.size),0),audit=auditStack(placed,s,observed);
 const loose:Record<string,number>={},wrapped:Record<string,number>={},pu:Record<string,number>={},sliding:Record<string,number>={};
 for(const g of gs){const t=transportMargin(placed,p,g,s.constraints.stability);loose[g]=t.looseMarginMm;wrapped[g]=t.wrappedMarginMm;const u=palletUnitMargin(placed,p,g,unit);if(u!==null)pu[g]=u;sliding[g]=slidingRisk(placed,g).length;}
 const raised=placed.filter(b=>b.position.z>EPS);
 return {index,closedBy,boxes:placed.length,mass,volume:v,fill:v/(p.width*p.depth*p.maxHeight),heightMm:Math.max(0,...placed.map(top)),
  comOffset:center?comOffsetRatio(center,p):null,comHeightMm:center?center.z:null,minSupportRatio:raised.length?Math.min(...raised.map(b=>b.supportRatio)):1,
  minLocalReserveMm:stability(placed,s.constraints.stability).minReserve,loadUtilization:audit.loads.loadUtilization,unknownCapacity:audit.loads.unknownCapacity,
  transport:{loose,wrapped,palletUnit:unit?pu:null},slidingBoxes:sliding,audit:{violations:audit.violations,checks:audit.checks}};
}
