import { hardResults } from './hardConstraints';
import { EVALUATOR_VERSION } from './version';
import { verticalAxis } from '../orientations';
import { estimatedPathSeconds } from './motionMetrics';
import { ArrivalEnvironment,advance,metrics } from '../environment';
import { inspectConstraints } from '../constraints';
import { evaluatePattern } from '../patternEvaluation';
import { stability } from '../stability';
import { materialInfo } from '../materials';
import { volume } from '../geometry';
import { remainingSites } from '../remainingSites';
import { emptyFrame } from '../types';
import { buildCase } from './scenarios';
import { getAlgorithm } from './registry';
import { fingerprint,percentile } from './statistics';
import type { Analysis,Observation,PlanningInput } from '../types';
import type { AlgorithmEntry,BenchmarkConfig,Hooks,TrialRow,TrialSpec,Violation } from './model';

export function violationType(reason:string):Violation{
 if(/가반|payload/i.test(reason))return 'payload';if(/그리퍼|접근|도달|workspace|경로|TCP|REACH|GRASP/i.test(reason))return 'robot-path';
 if(/최대 적재 높이/.test(reason))return 'height';if(/경계|바닥 아래/.test(reason))return 'bounds';if(/겹침|관통|충돌/.test(reason))return 'collision';
 if(/회전|Orientation|방향 유지|치수 불일치/i.test(reason))return 'orientation';if(/하중|적재 금지|무게 규칙|LOAD/i.test(reason))return 'load';if(/지지|무게중심|기둥|SUPPORT|전도/i.test(reason))return 'support';return 'protocol';
}
export function auditProposal(input:PlanningInput,a:Analysis){
 if(a.runId!==input.runId||a.stepId!==input.stepId)return ['계획 응답 ID 불일치'];
 const c=a.candidates.find(c=>c.id===a.selectedId);if(a.selectedId===null)return [];
 if(a.runId!==input.runId||a.stepId!==input.stepId||!c)return ['계획 응답 ID 또는 선택 후보 불일치'];
 const o=input.available?.find(b=>b.id===a.selectedBoxId)||input.current;
 if(c.placement.id!==o.id||c.placement.typeId!==o.typeId||(!input.available&&a.selectedBoxId&&a.selectedBoxId!==o.id))return ['미도착 또는 다른 박스 선택'];
 if(![...Object.values(c.placement.position),...Object.values(c.placement.size),c.placement.weight].every(Number.isFinite))return ['유한하지 않은 좌표·치수·무게'];
 if(c.placement.weight!==o.weight||Object.values(c.placement.size).some(n=>n<=0))return ['관측 무게·치수 변조'];
 // Adapter output may choose pose, never material strength, support contacts or a claimed path.
 const proposed={...c.placement,material:o.material,packaging:o.packaging,maxLoadKg:o.maxLoadKg,maxLoadSource:o.maxLoadSource,maxLoadByAxis:o.maxLoadByAxis,strengthFactor:o.strengthFactor,friction:o.friction,handling:o.handling};
 const checked=inspectConstraints(proposed,o,input.placements,input.pallet,input.constraints);
 c.placement=checked.placement;c.path=checked.path;
 return [...(!c.valid?['유효하지 않은 후보 선택']:[]),...checked.reasons];
}
export function trialIdentity(c:BenchmarkConfig,spec:TrialSpec){const s=buildCase(c.scenario,spec.caseId,spec.seed);return {s,hash:fingerprint({scenario:s,settings:c.settings,decisionMs:c.decisionMs,trialMs:c.trialMs,probeLimit:c.probeLimit,caseId:spec.caseId,warmupRuns:c.warmupRuns??1,robotAccelerationMmS2:c.robotAccelerationMmS2??null})};}
export function failedTrial(c:BenchmarkConfig,spec:TrialSpec,reason:string,outcome:TrialRow['outcome']='timeout'):TrialRow{
 const {s,hash}=trialIdentity(c,spec),env=new ArrivalEnvironment(s);
 return {evaluatorVersion:EVALUATOR_VERSION,algorithmVersion:getAlgorithm(spec.algorithm).version??'미지정',id:`${spec.caseId}:${spec.seed}:${spec.algorithm}`,algorithm:spec.algorithm,scope:getAlgorithm(spec.algorithm).scope,caseId:spec.caseId,seed:spec.seed,episode:spec.episode,fingerprint:hash,arrivalIds:Array.from({length:env.total},(_,i)=>env.current(i)!.id),outcome,reason,values:{},proposalViolations:{},candidateRejections:{},exceptions:[],strength:'missing',robot:s.constraints.robotMode==='ideal'?'unverified':'proxy',pallet:s.pallet,constraints:s.constraints};
}
export async function runTrial(c:BenchmarkConfig,spec:TrialSpec,hooks:Hooks={},definition:AlgorithmEntry=getAlgorithm(spec.algorithm)):Promise<TrialRow>{
 const now=hooks.now??(()=>performance.now()),started=now(),{s,hash}=trialIdentity(c,spec),auditEnv=new ArrivalEnvironment(s);
 // Full arrival trace is an evaluator-only audit artifact. It NEVER crosses the input boundary.
 const arrivals=Array.from({length:auditEnv.total},(_,i)=>auditEnv.current(i)!);
 const row:TrialRow={evaluatorVersion:EVALUATOR_VERSION,algorithmVersion:definition.version??'미지정',proposalReasons:[],finalReasons:undefined,id:`${spec.caseId}:${spec.seed}:${spec.algorithm}`,algorithm:spec.algorithm,scope:definition.scope,caseId:spec.caseId,seed:spec.seed,episode:spec.episode,fingerprint:hash,arrivalIds:arrivals.map(o=>o.id),outcome:'partial',reason:'',values:{},proposalViolations:{},candidateRejections:{},exceptions:[],strength:'explicit',robot:s.constraints.robotMode==='ideal'?'unverified':'proxy',trace:[],pallet:s.pallet,constraints:s.constraints};
 if(definition.scope==='offline'){
  if(s.events.length||spec.caseId==='palletChange'){row.outcome='error';row.reason='이 오프라인 어댑터는 예외 이벤트 비교를 지원하지 않습니다.';return row;}
  s.supplyMode='stock-select';
 }
 const env=new ArrivalEnvironment(s),times:number[]=[],margins:number[]=[],tipping:number[]=[];let frame=emptyFrame(),validInTime=0,candidates=0,proposed=0,robotFailures=0,lastInput:PlanningInput|null=null,changed=false;
 const addViolation=(reasons:string[])=>{row.proposalReasons!.push(...reasons);for(const type of new Set(reasons.map(violationType)))row.proposalViolations[type]=(row.proposalViolations[type]??0)+1;};
 try{
 while(!frame.blocked&&frame.processed<env.total){
  if(hooks.aborted?.()){row.outcome='error';row.reason='실행 취소';break;}
  if(now()-started>c.trialMs){row.outcome='timeout';row.reason='trial 총 시간 예산 초과';break;}
  let palletEvent:TrialRow['exceptions'][number]|undefined;
  if(spec.caseId==='palletChange'&&!changed&&frame.processed>=Math.max(1,Math.floor(env.total/3))){
   changed=true;s.pallet={...s.pallet,width:Math.round(s.pallet.width*.85)};row.pallet=s.pallet;
   palletEvent={kind:'palletChange',encountered:true,passed:false,ms:null};row.exceptions.push(palletEvent);
   const invalid=evaluatePattern(frame,s).reasons;
   if(invalid.length){row.outcome='environment-blocked';row.reason='팔레트 변경으로 확정 배치가 무효. 기존 박스 이동 없이 안전 중단: '+invalid[0];break;}
   frame={...frame,replanCount:(frame.replanCount??0)+1};
  }
  const input=env.input(frame,'greedy',structuredClone(c.settings),row.id)!;input.strategyState=structuredClone([...frame.records].reverse().find(r=>r.analysis?.strategyState)?.analysis?.strategyState);lastInput=input;
  // Definition sees only public input (or declared stock for the separately ranked offline reference).
  if(definition.scope==='online')delete input.available;
  const o=input.current,event=s.events.find(e=>e.step===frame.processed+1);let analysis:Analysis|null=null,elapsed=0,rejected:string[]=[];
  if(o.status!=='damaged'&&o.status!=='missing'){
   await hooks.beforeDecision?.(frame.processed+1);const begin=now();
   try{analysis=definition.plan(structuredClone(input));}finally{elapsed=now()-begin;hooks.afterDecision?.(frame.processed+1);}
   times.push(elapsed);
   if(elapsed>c.decisionMs){row.outcome='timeout';row.reason=`판단 시간 ${elapsed.toFixed(1)} ms > ${c.decisionMs} ms`;row.timedOutStep=frame.processed+1;break;}
   analysis.milliseconds=elapsed;candidates+=analysis.checkedCandidates??analysis.candidates.length;
   for(const can of analysis.candidates)for(const key of new Set(can.reasons.map(violationType))){row.candidateRejections[key]=(row.candidateRejections[key]??0)+1;}
   rejected=auditProposal(input,analysis);if(analysis.selectedId!==null)proposed++;
   if(rejected.length){addViolation(rejected);if(rejected.some(r=>['payload','robot-path','collision'].includes(violationType(r))))robotFailures++;row.outcome='constraint-rejected';row.reason=rejected.join(' / ');}
  }
  const before=frame,committed=advance(frame,input,rejected.length?{...analysis!,runId:input.runId,stepId:input.stepId,selectedId:null}:analysis);
  frame=committed;const rec=frame.records.at(-1)!;
  if(!rejected.length&&analysis?.selectedId&&rec.disposition!=='placed'){addViolation([rec.reason||'확정 검사 거절']);row.outcome='constraint-rejected';row.reason=rec.reason;}
  if(rec.disposition==='placed')validInTime++;
  if(event){const expected=event.kind==='damaged'?'excluded':event.kind==='missing'?'missing':'placed';row.exceptions.push({kind:event.kind,encountered:true,passed:rec.disposition===expected,ms:event.kind==='resize'?elapsed:null});}
  if(palletEvent){palletEvent.passed=rec.disposition==='placed';palletEvent.ms=elapsed;}
  const m=metrics(frame,s),st=stability(frame.placements,s.constraints.stability),margin=st.supports.length?Math.min(...st.supports.map(v=>v.reserve)):null;
  if(margin!==null)margins.push(margin);for(const b of st.supports)if(b.center.z>b.planeZ)tipping.push(b.margin/(b.center.z-b.planeZ));
  row.trace!.push({step:before.processed+1,box:rec.observation,placement:rec.placement,path:rec.path,decisionMs:elapsed,disposition:rec.disposition,reason:row.reason||rec.reason,center:m.center,minSupport:frame.placements.length?Math.min(...frame.placements.map(b=>b.supportRatio)):null,minMargin:margin,pallet:structuredClone(s.pallet)});
  // Keep only selected diagnostic candidate; strategy reservation state is preserved for next decision.
  if(rec.analysis)rec.analysis={...rec.analysis,candidates:rec.analysis.candidates.filter(can=>can.id===rec.analysis!.selectedId)};
  if(frame.blocked){if(!row.reason)row.reason=frame.reason;break;}
 }
 }catch(error){row.outcome='error';row.reason=error instanceof Error?error.message:String(error);}
 const auditStart=now(),m=metrics(frame,s),audit=evaluatePattern(frame,s),normal=arrivals.filter(o=>o.status!=='damaged'&&o.status!=='missing'),target=normal.length;
 if(audit.reasons.length&&row.outcome!=='environment-blocked'){addViolation(audit.reasons);row.outcome='constraint-rejected';row.reason=audit.reasons.join(' / ');}
 if(!['constraint-rejected','timeout','error','environment-blocked'].includes(row.outcome))row.outcome=m.count===target&&frame.processed===env.total?'complete':m.count?'partial':'no-placement';
 const finiteLoad=(n:number|undefined)=>n!==undefined&&Number.isFinite(n)&&n>=0;
 const explicit=(o:Observation)=>{const axis=verticalAxis(frame.placements.find(p=>p.id===o.id)?.orientation??0);return o.packaging?finiteLoad(o.packaging.maxTopLoad):finiteLoad(o.maxLoadByAxis?.[axis])||(finiteLoad(o.maxLoadKg)&&o.maxLoadSource!=='synthetic');};
 const missing=normal.filter(o=>!explicit(o));row.strength=missing.length?(missing.some(o=>materialInfo(o,s.constraints.stability).capacity===null)?'missing':'assumed'):'explicit';
 const support=frame.placements.map(p=>p.supportRatio),robot=row.robot==='proxy',future=lastInput&&c.probeLimit>0&&now()-started<c.trialMs?remainingSites({...lastInput,current:lastInput.current,remaining:env.remaining(frame),settings:{...lastInput.settings,reserveProbes:c.probeLimit}},frame.placements):null;
 const workTimes=row.trace!.flatMap(t=>t.placement&&t.path?[estimatedPathSeconds(t.path,s.constraints.gripper.speed,c.robotAccelerationMmS2)]:[]),workSeconds=robot&&m.count&&workTimes.length===m.count&&workTimes.every(v=>v!==null&&Number.isFinite(v))?workTimes.reduce<number>((a,b)=>a+b!,0):null;
 const exceptionSeen=row.exceptions.filter(e=>e.encountered),replans=exceptionSeen.flatMap(e=>e.ms===null?[]:[e.ms]);
 row.finalReasons=[...audit.reasons];row.hardConstraints=hardResults(row);
 const exceptionRate=(kind:string)=>{const events=exceptionSeen.filter(e=>e.kind===kind);return events.length?100*events.filter(e=>e.passed).length/events.length:null;};
 row.values={residualVolume:Math.max(0,s.pallet.width*s.pallet.depth*s.pallet.maxHeight-m.volume),count:m.count,completion:target?100*m.count/target:null,utilization:100*m.utilization,unplaced:Math.max(0,target-m.count),unplacedVolume:Math.max(0,normal.reduce((n,o)=>n+volume(o.size),0)-m.volume)/1e9,height:m.count?m.height:null,pallets:null,remainingFit:future?100*future.fitFraction:null,spaceOpportunity:future?100*future.opportunity:null,
  comZ:m.count?m.center.z:null,comOffset:m.count?Math.hypot(m.center.x-s.pallet.width/2,m.center.y-s.pallet.depth/2):null,supportMean:support.length?100*support.reduce((a,b)=>a+b,0)/support.length:null,supportMin:support.length?100*Math.min(...support):null,imbalance:m.count?100*m.imbalance:null,minMargin:margins.length?Math.min(...margins):null,tippingG:tipping.length?Math.min(...tipping):null,loadViolations:row.strength==='explicit'?(row.proposalViolations.load??0):null,unknownStrength:missing.length,physicsSuccess:null,
  meanMs:times.length?times.reduce((a,b)=>a+b,0)/times.length:null,maxMs:times.length?Math.max(...times):null,p95Ms:percentile(times,.95),p99Ms:percentile(times,.99),totalMs:times.reduce((a,b)=>a+b,0),deadlineRate:times.length?100*validInTime/times.length:null,workSeconds,distanceM:robot&&m.count?m.distanceM:null,throughput:workSeconds!==null&&workSeconds>0?3600*m.count/workSeconds:null,candidates,evaluationMs:now()-auditStart,
  orderUtilization:['random','mixed'].includes(spec.caseId)?100*m.utilization:null,orderCompletion:['random','mixed'].includes(spec.caseId)&&target?100*m.count/target:null,orderSuccess:['random','mixed'].includes(spec.caseId)?(row.outcome==='complete'?100:0):null,regret:null,futureFit:future?100*future.fitFraction:null,
  reachProxy:robot&&proposed?100*(proposed-robotFailures)/proposed:null,robotCollisions:robot?row.hardConstraints.robotCollision.violations:null,payloadViolations:robot?row.proposalViolations.payload??0:null,graspSuccess:null,ikSuccess:null,executionSuccess:robot?(row.outcome==='complete'?100:0):null,
  damagedRecovery:exceptionRate('damaged'),missingRecovery:exceptionRate('missing'),resizeRecovery:exceptionRate('resize'),exceptionSuccess:exceptionSeen.length?100*exceptionSeen.filter(e=>e.passed).length/exceptionSeen.length:null,replanMs:replans.length?replans.reduce((a,b)=>a+b,0)/replans.length:null,exceptionRetention:null,palletRecovery:row.exceptions.find(e=>e.kind==='palletChange')?.passed===undefined?null:row.exceptions.find(e=>e.kind==='palletChange')!.passed?100:0};
 hooks.progress?.(row);return row;
}
