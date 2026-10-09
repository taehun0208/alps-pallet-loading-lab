import { defaultCapacityConfig, retailScenario, crossZoneBlockers } from './vendor/pallet/capacity/experiment';
import { ArrivalEnvironment } from './vendor/pallet/environment';
import { fingerprint, percentile } from './vendor/pallet/benchmark/statistics';
import { volume, top, intersects } from './vendor/pallet/geometry';
import { materialInfo } from './vendor/pallet/materials';
import { validateCandidate } from './validation';
import { ALGORITHMS, availablePlanningMs, validateConfig } from './config';
import type { AlgorithmId, DecisionOutcome, DecisionTrace, ExperimentRequest, ExperimentResult, Placement, PlanningInput, RunOptions, Scenario, SimulationConfig, TrialMetrics, TrialResult } from './types';
export const SOURCE_VERSION='common-engine-cycle/2-floor-dense';
let decisionRunCounter = 0;
export const ASSUMPTIONS=[
 'One robot, one pallet, no waiting buffer. Only the current observed box and residual SKU counts enter planning; actual future order is hidden.',
 '10/12 seconds are assumed robot cycles, not measured robot/IK/sensor/end-to-end guarantees. Recognition delay is configured; reserve is a budget allowance, not a measured duration.',
 'Planning and independent commit validation overlap the preceding robot motion. The first decision is startup time. Rejected-box removal time and conveyor delays are not modeled.',
 'Hard constraints use the canonical swept gripper/cargo path proxy, support and synthetic material limits. Heavy-on-light order rule is disabled by mentor agreement; allowable load checks remain.',
 'Box mass is uniformly distributed within each box. Cargo center of mass excludes pallet mass; static proxies do not validate transport stability.',
 'MCTS uses sampled remaining counts, UCT, expansion, stochastic rollout and backpropagation, with finite candidate/horizon/iteration limits. No global optimality claim.',
 'Worker startup/loading is excluded from per-decision timing. Browser/OS scheduling and synthetic material inputs require separate real-cell validation.',
];
function trialMetrics(scenario:Scenario,stack:Placement[],decisions:DecisionTrace[],total:number):TrialMetrics{
 const pallet=scenario.pallet,v=stack.reduce((s,p)=>s+volume(p.size),0),height=Math.max(0,...stack.map(top)),mass=stack.reduce((s,p)=>s+p.weight,0);
 const center={x:mass?stack.reduce((s,p)=>s+p.weight*(p.position.x+p.size.w/2),0)/mass:pallet.width/2,y:mass?stack.reduce((s,p)=>s+p.weight*(p.position.y+p.size.d/2),0)/mass:pallet.depth/2,z:mass?stack.reduce((s,p)=>s+p.weight*(p.position.z+p.size.h/2),0)/mass:0};
 const xs=[...new Set([0,pallet.width,...stack.flatMap(p=>[p.position.x,p.position.x+p.size.w])])].sort((a,b)=>a-b),ys=[...new Set([0,pallet.depth,...stack.flatMap(p=>[p.position.y,p.position.y+p.size.d])])].sort((a,b)=>a-b);
 let column=0,projectedArea=0;for(let x=1;x<xs.length;x++)for(let y=1;y<ys.length;y++){const mx=(xs[x]+xs[x-1])/2,my=(ys[y]+ys[y-1])/2;const area=(xs[x]-xs[x-1])*(ys[y]-ys[y-1]),localTop=Math.max(0,...stack.filter(p=>mx>=p.position.x&&mx<p.position.x+p.size.w&&my>=p.position.y&&my<p.position.y+p.size.d).map(top));column+=area*localTop;if(localTop>0)projectedArea+=area;}
 const loads=stack.map(p=>{const capacity=materialInfo(p,scenario.constraints.stability).capacity;return capacity===null?null:capacity>0?p.loadAbove/capacity:p.loadAbove?Infinity:0;});
 const times=decisions.map(d=>d.decisionMs),compute=decisions.reduce((s,d)=>s+d.decisionMs,0),robot=decisions.filter(d=>d.accepted).reduce((s,d)=>s+(d.timing.robotEnd!-d.timing.robotStart!),0),wait=decisions.reduce((s,d)=>s+d.timing.exposedWaitSeconds,0);
 const groups={S1:0,S2:0,S3:1,S4:1,S5:2,S6:2};
 const floorArea=stack.filter(p=>Math.abs(p.position.z)<1e-6).reduce((s,p)=>s+p.size.w*p.size.d,0);
 return {floorContactAreaMm2:floorArea,floorCoverage:floorArea/(pallet.width*pallet.depth),projectedFootprintAreaMm2:projectedArea,projectedFootprintCoverage:projectedArea/(pallet.width*pallet.depth),count:stack.length,total,fill:v/(pallet.width*pallet.depth*pallet.maxHeight),volumeMm3:v,usedHeightMm:height,envelopeFill:height?v/(pallet.width*pallet.depth*height):0,
 allowedEmptyMm3:pallet.width*pallet.depth*pallet.maxHeight-v,envelopeEmptyMm3:pallet.width*pallet.depth*height-v,columnVoidMm3:Math.max(0,column-v),massKg:mass,center,cogHorizontalOffsetMm:Math.hypot(center.x-pallet.width/2,center.y-pallet.depth/2),cogHeightMm:center.z,
 minSupportRatio:stack.length?Math.min(...stack.map(p=>p.supportRatio)):null,maxLoadRatio:loads.length&&loads.every((v):v is number=>v!==null&&Number.isFinite(v))?Math.max(...loads):null,
 computeMs:compute,meanDecisionMs:times.length?times.reduce((s,n)=>s+n,0)/times.length:null,p95DecisionMs:percentile(times,.95),maxDecisionMs:times.length?Math.max(...times):null,
 deadlineMisses:decisions.filter(d=>!d.validDeadline).length,fallbackCount:decisions.filter(d=>d.fallback).length,robotSeconds:robot,planningWaitSeconds:wait,totalSeconds:robot+wait,
 storeProxy:{crossZoneBlockers:crossZoneBlockers(stack,groups),label:'Different-department boxes vertically obstructing another department; geometric explanatory proxy, not measured store time or ranking objective.',measuredSeconds:null}};
}
export async function runTrial(config:SimulationConfig,algorithm:AlgorithmId,seed:number,options:RunOptions):Promise<TrialResult>{
 validateConfig(config);if(!ALGORITHMS.some(a=>a.id===algorithm))throw Error('Unknown algorithm');if(!Number.isInteger(seed))throw Error('Seed must be an integer');
 const scenario=retailScenario(config.quantityPerSku);scenario.pallet.maxHeight=config.maxHeightMm;scenario.supplyMode='arrival';scenario.arrival={seed,pattern:'random-draw'};
 const env=new ArrivalEnvironment(scenario),arrivals=Array.from({length:env.total},(_,i)=>env.current(i)!),pending=Object.fromEntries(scenario.types.map(t=>[t.id,t.quantity]));
 const settings=defaultCapacityConfig().settings;settings.maxCandidates=config.maxCandidates;settings.temporaryBuffer=false;
 // Planner RNG is fixed independently of the hidden arrival RNG, identical across algorithms.
 settings.plannerSeed=91473;
 const id=`cycle-${config.cycleSeconds}:${seed}:${algorithm}`,decisionRunId=++decisionRunCounter,decisions:DecisionTrace[]=[],violations:string[]=[];
 let stack:Placement[]=[],state:PlanningInput['strategyState'],status:TrialResult['status']='finished',reason='',processed=0;
 let nextPlanningStart=0,robotStart=0,robotEnd=0;
 for(const box of arrivals){
  if(options.signal?.aborted){status='cancelled';reason='Cancelled by user';break;}
  pending[box.typeId]--;
  const input:PlanningInput={runId:'common-online-trial',stepId:processed,pallet:structuredClone(scenario.pallet),types:structuredClone(scenario.types),constraints:structuredClone(scenario.constraints),placements:structuredClone(stack),current:structuredClone(box),remaining:{...pending},algorithm:'greedy',settings:structuredClone(settings),strategyState:structuredClone(state)};
  const availableMs=availablePlanningMs(config),searchBudgetMs=config.searchBudgetMs??availableMs;
  let result:DecisionOutcome;
  try{result=await options.planDecision({id:`decision-${decisionRunId}-${processed}`,algorithm,input,availableMs,searchBudgetMs,mcts:config.mcts},options.signal);}
  catch(error){if(options.signal?.aborted||(error instanceof Error&&error.name==='AbortError')){status='cancelled';reason='Cancelled by user';break;}status='error';reason=error instanceof Error?error.message:String(error);break;}
  if(options.signal?.aborted){status='cancelled';reason='Cancelled by user';break;}
  const checkStarted=performance.now(),checked=result.candidate?validateCandidate(input,result.candidate):null;
  const errors=checked?.reasons??[],validationMs=performance.now()-checkStarted;
  if(errors.length)violations.push(...errors.map(e=>`${box.id}: ${e}`));
  const finite=[result.elapsedMs,result.planningMs].every(v=>Number.isFinite(v)&&v>=0);
  // The independent commit check uses the explicitly reserved allowance. The
  // supervisor already requires the candidate to arrive inside the search window.
  const validDeadline=finite&&result.validDeadline&&config.recognitionDelaySeconds*1000+result.elapsedMs+validationMs<=config.cycleSeconds*1000;
  const accepted=Boolean(result.candidate&&checked&&!errors.length&&validDeadline);
  const decisionMs=finite?result.elapsedMs:0,prep=(config.recognitionDelaySeconds*1000+decisionMs+validationMs)/1000,start=nextPlanningStart,end=start+prep;
  const overlap=Math.max(0,Math.min(end,robotEnd)-Math.max(start,robotStart)),exposed=Math.max(0,prep-overlap);
  let moveStart:number|null=null,moveEnd:number|null=null;
  if(accepted){stack=checked!.stack;state=structuredClone(result.strategyState);moveStart=Math.max(end,robotEnd);moveEnd=moveStart+config.cycleSeconds;robotStart=moveStart;robotEnd=moveEnd;nextPlanningStart=moveStart;}else nextPlanningStart=end;
  const trace:DecisionTrace={index:processed,box:structuredClone(box),accepted,reason:accepted?'Validated current-box placement':errors.join(' / ')||(!validDeadline?'Decision missed available deadline':result.message||'No valid candidate'),placement:accepted?structuredClone(checked!.placement):undefined,
    recognitionMs:config.recognitionDelaySeconds*1000,planningMs:finite?result.planningMs:0,decisionMs,validationMs,availableMs,searchBudgetMs,fallback:result.fallback,fallbackReason:result.fallbackReason,validDeadline,watchdog:result.watchdog,simulations:result.simulations,completeScenarios:result.completeScenarios,searchDiagnostics:result.searchDiagnostics,remaining:{...pending},timing:{start,end,robotStart:moveStart,robotEnd:moveEnd,exposedWaitSeconds:exposed,overlappedPlanningSeconds:overlap}};
  decisions.push(trace);processed++;
  options.onProgress?.({algorithm,seed,completedTrials:0,totalTrials:1,processed,totalBoxes:arrivals.length,placements:structuredClone(stack),decision:structuredClone(trace)});
 }
 const placedIds=new Set(stack.map(p=>p.id)),unplaced=arrivals.slice(0,processed).filter(o=>!placedIds.has(o.id)),unprocessed=arrivals.slice(processed);
 if(placedIds.size!==stack.length||new Set([...stack,...unplaced,...unprocessed].map(p=>p.id)).size!==arrivals.length||stack.length+unplaced.length+unprocessed.length!==arrivals.length)violations.push('Box identity / quantity conservation failed');
 for(let i=0;i<stack.length;i++){const p=stack[i];if(stack.slice(0,i).some(q=>intersects(p,q)))violations.push(`${p.id}: independent overlap audit`);if(p.position.x<0||p.position.y<0||p.position.z<0||p.position.x+p.size.w>scenario.pallet.width+1e-6||p.position.y+p.size.d>scenario.pallet.depth+1e-6||top(p)>scenario.pallet.maxHeight+1e-6)violations.push(`${p.id}: independent boundary audit`);}
 if(violations.length&&status==='finished'){status='error';reason='Independent audit failed';}
 return {id,algorithm,seed,config:structuredClone(config),scenario,status,reason,arrivals,placements:stack,unplaced,unprocessed,decisions,violations,metrics:trialMetrics(scenario,stack,decisions,arrivals.length),sourceVersion:SOURCE_VERSION,inputFingerprint:fingerprint({scenario,config,arrivals})};
}
export async function createExperiment(request:ExperimentRequest,options:RunOptions,onTrial?:(row:TrialResult)=>void):Promise<ExperimentResult>{
 validateConfig(request.config);if(!request.algorithms.length||new Set(request.algorithms).size!==request.algorithms.length||request.algorithms.some(a=>!ALGORITHMS.some(v=>v.id===a)))throw Error('Select distinct known algorithms');
 if(!request.seeds.length||new Set(request.seeds).size!==request.seeds.length||request.seeds.some(s=>!Number.isInteger(s)))throw Error('Select distinct integer seeds');
 const rows:TrialResult[]=[],totalTrials=request.algorithms.length*request.seeds.length;
 outer:for(const seed of request.seeds)for(const algorithm of request.algorithms){
  if(options.signal?.aborted)break outer;
  const row=await runTrial(request.config,algorithm,seed,{...options,onProgress:p=>options.onProgress?.({...p,completedTrials:rows.length,totalTrials})});rows.push(row);onTrial?.(row);if(row.status==='cancelled')break outer;
 }
 return {...structuredClone(request),rows,cancelled:Boolean(options.signal?.aborted||rows.some(r=>r.status==='cancelled')),assumptions:ASSUMPTIONS};
}
