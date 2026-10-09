/** Post-hoc fixed-state diagnostic. It never changes engine code or benchmark rows. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { platform, arch, cpus } from 'node:os';
import { ALGORITHMS } from '../src/engine/config';
import type { AlgorithmId, Observation, Placement, PlanningInput, TrialResult } from '../src/engine/types';
import { candidateOrigins } from '../src/engine/vendor/pallet/candidates';
import { frontierOrigins, balancedOrigins, geometricFeasible, type RawCandidate } from '../src/engine/vendor/pallet/frontier';
import { inspectConstraints } from '../src/engine/vendor/pallet/constraints';
import { defaultCapacityConfig } from '../src/engine/vendor/pallet/capacity/experiment';
import { allowedOrientations } from '../src/engine/vendor/pallet/orientations';
import { oriented, landingHeight, top, volume } from '../src/engine/vendor/pallet/geometry';

const ROOT=process.cwd(),OUT=resolve(ROOT,'public/diagnostics'),SEED=11042,CYCLE=10;
const LIMITS={expandedConfiguredCandidates:128,extraFullChecks:2048,extraMillisecondsPerFailure:250,diagnosticMillisecondsPerAlgorithm:30000};
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const key=(r:RawCandidate)=>[r.position.x,r.position.y,r.position.z,r.size.w,r.size.d,r.size.h,r.orientation].join(':');
const unique=(raw:RawCandidate[])=>[...new Map(raw.map(r=>[key(r),r])).values()];
const groups=(reasons:string[])=>[...new Set(reasons.map(reason=>{
 if(/높이 초과|최대 적재 높이/.test(reason))return 'height';
 if(/경계 밖|바닥 아래/.test(reason))return 'pallet_boundary';
 if(/겹침|작업 여유/.test(reason))return 'box_overlap_or_spacing';
 if(/SUPPORT|지지 조건|지지 면|지지 다각/.test(reason))return 'support';
 if(/가반|payload/i.test(reason))return 'payload';
 if(/하중|LOAD|강도/.test(reason))return 'load_capacity';
 if(/무게 규칙/.test(reason))return 'heavy_order_rule';
 if(/도달|반경/.test(reason))return 'robot_reach';
 if(/그리퍼|ROBOT|로봇|스윕|작업공간|경로|접근/.test(reason))return 'robot_path_or_workspace';
 if(/방향|회전|Orientation|취급/.test(reason))return 'orientation_or_handling';
 if(/평형|모멘트|안정|전도|반력|무게중심|기둥|STABILITY/.test(reason))return 'static_equilibrium';
 return 'other';
}))];
interface Probe {
 candidateCount:number;checked:number;validCount:number;witnesses:Placement[];complete:boolean;stopReason:string;milliseconds:number;
 rejectedCandidates:number;reasonCategoryCounts:Record<string,number>;reasonTextCounts:Record<string,number>;
 examples:{origin:RawCandidate;reasons:string[]}[];
}
function placement(raw:RawCandidate,o:Observation):Placement{
 return {id:o.id,typeId:o.typeId,position:{...raw.position},size:{...raw.size},orientation:raw.orientation,weight:o.weight,
 supports:[],supportRatio:0,loadAbove:0,packaging:o.packaging,maxLoadKg:o.maxLoadKg,maxLoadSource:o.maxLoadSource,
 maxLoadByAxis:o.maxLoadByAxis,material:o.material,handling:o.handling,strengthFactor:o.strengthFactor,friction:o.friction};
}
function check(input:PlanningInput,raw:RawCandidate[],opts:{deadline?:number;limit?:number;stopOnWitness?:boolean}={}):Probe{
 const started=performance.now(),result:Probe={candidateCount:raw.length,checked:0,validCount:0,witnesses:[],complete:true,stopReason:'all_enumerated_candidates_checked',milliseconds:0,rejectedCandidates:0,reasonCategoryCounts:{},reasonTextCounts:{},examples:[]};
 for(const r of raw){
  if(performance.now()>=(opts.deadline??Infinity)||result.checked>=(opts.limit??Infinity)){result.complete=false;result.stopReason=performance.now()>=(opts.deadline??Infinity)?'diagnostic_wallclock_cap':'diagnostic_candidate_cap';break;}
  const checked=inspectConstraints(placement(r,input.current),input.current,input.placements,input.pallet,input.constraints);result.checked++;
  if(!checked.reasons.length){result.validCount++;if(result.witnesses.length<3)result.witnesses.push(checked.placement);if(opts.stopOnWitness){result.complete=result.checked===raw.length;result.stopReason='valid_witness_found';break;}}
  else{result.rejectedCandidates++;for(const c of groups(checked.reasons))result.reasonCategoryCounts[c]=(result.reasonCategoryCounts[c]??0)+1;for(const reason of new Set(checked.reasons))result.reasonTextCounts[reason]=(result.reasonTextCounts[reason]??0)+1;
   if(result.examples.length<16)result.examples.push({origin:r,reasons:checked.reasons});}
 }
 result.milliseconds=performance.now()-started;return result;
}
function configuredOrigins(input:PlanningInput,algorithm:AlgorithmId,count:number){
 const local={...input,settings:{...input.settings,maxCandidates:count}};
 // The production adapter first tries BLB and may then use balanced strategy roots.
 const baseline=candidateOrigins(local,false),strategy=['strategy-greedy','lookahead','future-hybrid'].includes(algorithm)?candidateOrigins(local,true):null;
 return {origins:unique([...baseline.budget,...(strategy?.budget??[])]),rawGenerated:Math.max(baseline.generated,strategy?.generated??0),modeBudgets:[{mode:'common BLB fallback',count:baseline.budget.length,capped:baseline.capped},...(strategy?[{mode:'strategy balanced roots',count:strategy.budget.length,capped:strategy.capped}]:[])]};
}
function allTopDownOrigins(input:PlanningInput){
 const {current,pallet,placements,constraints}=input,raw:RawCandidate[]=[];
 for(const orientation of allowedOrientations(current.size,current.orientationAllowed,current.handling,current.maxLoadByAxis)){
  const size=oriented(current.size,orientation);
  raw.push(...frontierOrigins(pallet,size,placements,constraints.horizontalGap).map(position=>({position,size,orientation})));
  // Also inspect the same finite balance-hint positions supported by canonical candidate generation.
  const balance=balancedOrigins(size,placements,current.weight),x=(pallet.width-size.w)/2,y=(pallet.depth-size.d)/2;
  balance.push({x,y,z:landingHeight(x,y,size,placements)});
  raw.push(...balance.map(position=>({position,size,orientation,balanceTarget:true})));
 }
 return unique(raw).sort((a,b)=>a.position.z-b.position.z||a.position.y-b.position.y||a.position.x-b.position.x||String(a.orientation).localeCompare(String(b.orientation)));
}
function auditRow(row:TrialResult){
 if(row.seed!==SEED||row.config.cycleSeconds!==CYCLE||row.status!=='finished'||row.violations.length)throw Error(`Invalid completed input row ${row.id}`);
 const started=performance.now(),algorithmDeadline=started+LIMITS.diagnosticMillisecondsPerAlgorithm,settings=defaultCapacityConfig().settings;
 settings.maxCandidates=row.config.maxCandidates;settings.temporaryBuffer=false;settings.plannerSeed=91473;settings.inventoryMode='none';
 let stack:Placement[]=[];const failures:unknown[]=[];const tally={normalUnplaced:0,recoveredWithinOriginalBudget:0,recoveredAt128:0,recoveredExtraOrigins:0,notFound:0,extraTruncated:0,deadlineOrPlannerFailure:0};
 for(const d of row.decisions){
  const input:PlanningInput={runId:'posthoc-fixed-state',stepId:d.index,pallet:structuredClone(row.scenario.pallet),types:structuredClone(row.scenario.types),constraints:structuredClone(row.scenario.constraints),placements:structuredClone(stack),current:structuredClone(d.box),remaining:{...d.remaining},algorithm:'greedy',settings:structuredClone(settings)};
  if(d.accepted){if(!d.placement)throw Error(`Missing accepted placement ${d.index}`);const checked=inspectConstraints(d.placement,d.box,stack,input.pallet,input.constraints);if(checked.reasons.length)throw Error(`Replay failed ${row.id}:${d.index}: ${checked.reasons.join(';')}`);stack=checked.stack;continue;}
  if(d.box.status!=='normal')continue;
  tally.normalUnplaced++;
  if(!d.validDeadline||d.watchdog||d.fallbackReason==='planner_error')tally.deadlineOrPlannerFailure++;
  const original=configuredOrigins(input,row.algorithm,row.config.maxCandidates),expanded=configuredOrigins(input,row.algorithm,LIMITS.expandedConfiguredCandidates);
  const first=check(input,original.origins),second=check(input,expanded.origins);
  let additional:null|{enumeratedOrigins:number;withinBounds:number;withinBoundsAndHeight:number;geometricFeasible:number;noHeightFitAmongEnumerated:boolean;noGeometricFitAmongEnumerated:boolean;probe:Probe}=null;
  let conclusion='not_found_in_finite_probe';
  if(first.validCount){tally.recoveredWithinOriginalBudget++;conclusion='valid_witness_within_original_candidate_budget';}
  else if(second.validCount){tally.recoveredAt128++;conclusion='valid_witness_after_configured_candidate_expansion';}
  else{
   const raw=allTopDownOrigins(input),bounds=(r:RawCandidate)=>r.position.x>=0&&r.position.y>=0&&r.position.x+r.size.w<=input.pallet.width+1e-6&&r.position.y+r.size.d<=input.pallet.depth+1e-6;
   const withinBounds=raw.filter(bounds).length,withinBoundsAndHeight=raw.filter(r=>bounds(r)&&r.position.z>=0&&r.position.z+r.size.h<=input.pallet.maxHeight+1e-6).length;
   const geometricallyFeasible=raw.filter(r=>geometricFeasible(r,input.placements,input.pallet,input.constraints));
   // Skip previously inspected coordinates, preserve all diagnostic bounds explicitly.
   const tested=new Set(expanded.origins.map(key)),fresh=geometricallyFeasible.filter(r=>!tested.has(key(r)));
   const probe=check(input,fresh,{deadline:Math.min(algorithmDeadline,performance.now()+LIMITS.extraMillisecondsPerFailure),limit:LIMITS.extraFullChecks,stopOnWitness:true});
   additional={enumeratedOrigins:raw.length,withinBounds,withinBoundsAndHeight,geometricFeasible:geometricallyFeasible.length,noHeightFitAmongEnumerated:withinBoundsAndHeight===0,noGeometricFitAmongEnumerated:geometricallyFeasible.length===0,probe};
   if(probe.validCount){tally.recoveredExtraOrigins++;conclusion='valid_witness_at_additional_canonical_origin';}
   else{tally.notFound++;if(!probe.complete)tally.extraTruncated++;}
  }
  const occupied=stack.reduce((s,p)=>s+volume(p.size),0),empty=input.pallet.width*input.pallet.depth*input.pallet.maxHeight-occupied;
  failures.push({index:d.index,box:d.box,original:{reason:d.reason,validDeadline:d.validDeadline,watchdog:d.watchdog,fallbackReason:d.fallbackReason,decisionMs:d.decisionMs,simulations:d.simulations},
   placedPrefixCount:stack.length,placedPrefixIds:stack.map(p=>p.id),stateSha256:hash(JSON.stringify(stack)),remainingCounts:{...d.remaining},boxVolumeMm3:volume(d.box.size),unoccupiedPalletMm3:empty,
   boxVolumeDoesNotExceedTotalUnoccupied:volume(d.box.size)<=empty,usedHeightMm:Math.max(0,...stack.map(top)),
   configured48:{...first,source:original.modeBudgets,rawGenerated:original.rawGenerated},configured128:{...second,source:expanded.modeBudgets,rawGenerated:expanded.rawGenerated},additional,conclusion});
 }
 const storedIds=row.placements.map(p=>p.id),rebuiltIds=stack.map(p=>p.id);if(JSON.stringify(storedIds)!==JSON.stringify(rebuiltIds))throw Error(`Final replay identity mismatch ${row.id}`);
 const m=row.metrics,empty=m.allowedEmptyMm3;
 return {trialId:row.id,algorithm:row.algorithm,seed:row.seed,config:row.config,status:row.status,metrics:m,
  geometryBreakdown:{allowedEmptyLiters:empty/1e6,columnVoidLiters:m.columnVoidMm3/1e6,airAboveLocalTopsLiters:(empty-m.columnVoidMm3)/1e6,airAboveLocalTopsFractionOfAllEmpty:empty?(empty-m.columnVoidMm3)/empty:null},
  simulationCap:{searchBudgetMs:row.config.searchBudgetMs??(row.config.cycleSeconds-row.config.recognitionDelaySeconds-row.config.reserveSeconds)*1000,maximumObservedDecisionMs:m.maxDecisionMs,
   decisionsAtMctsIterationCap:row.algorithm==='mcts'?row.decisions.filter(d=>d.simulations===row.config.mcts.maxIterations).length:null,zeroSimulationDecisions:row.decisions.filter(d=>d.simulations===0).length,watchdogs:row.decisions.filter(d=>d.watchdog).length},
  tally,failures,elapsedMs:performance.now()-started,replayValidated:true};
}
function main(){
 if(!process.argv.includes('--run')){process.stdout.write(JSON.stringify({status:'not_executed',instruction:'After benchmark completion approval, compile and run with --run.',seed:SEED,cycle:CYCLE,limits:LIMITS})+'\n');return;}
 const indexPath=resolve(ROOT,'public/results/index.json'),index=JSON.parse(readFileSync(indexPath,'utf8'));
 if(!index.complete||index.trials.length!==84)throw Error('Diagnostic execution is blocked until all 84 benchmark rows finish.');
 for(const f of index.provenance.sourceFiles)if(hash(readFileSync(resolve(ROOT,f.path)))!==f.sha256)throw Error(`Frozen benchmark source mismatch: ${f.path}`);
 const reportPath=resolve(OUT,'density-11042-10s.json');if(existsSync(reportPath))throw Error('Diagnostic report already exists; preserving original run.');
 const inputs=ALGORITHMS.map(a=>{const path=`public/results/trials/${CYCLE}s-${SEED}-${a.id}.json`,bytes=readFileSync(resolve(ROOT,path));return {path,sha256:hash(bytes),row:JSON.parse(bytes.toString()) as TrialResult};});
 const began=new Date().toISOString();const rows=inputs.map(({row})=>{const r=auditRow(row);process.stderr.write(`${r.algorithm}: normal unplaced ${r.tally.normalUnplaced}, recoverable ${r.tally.recoveredWithinOriginalBudget+r.tally.recoveredAt128+r.tally.recoveredExtraOrigins}, ${r.elapsedMs.toFixed(0)}ms\n`);return r;});
 mkdirSync(OUT,{recursive:true});
 const report={schema:'alps-density-diagnostic/1',createdAt:began,completedAt:new Date().toISOString(),separateFromBenchmark:true,benchmarkSourceSha256:index.provenance.sourceSha256,
  inputHashes:inputs.map(({path,sha256})=>({path,sha256})),scriptSha256:hash(readFileSync(resolve(ROOT,'scripts/diagnose-density.ts'))),environment:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version},limits:LIMITS,
  interpretation:[
   'Post-hoc same-state witness search, not a rerun of an online algorithm and not included in benchmark rankings.',
   'No actual future arrival order is used; probes see only the failed current box, previously committed placements and residual SKU counts.',
   'A valid witness proves this particular skipped box had a feasible enumerated placement under the same model at that decision. It does not prove the modified complete run has a higher final fill.',
   'Not found does not mean impossible: all origins are a finite top-down edge/balance enumeration; additional full checks have explicit candidate/time caps. No exhaustive continuous-coordinate or rearrangement proof.',
   'Configured comparison uses the app-supported 48 and 128 per-mode candidate budgets. Additional probes are diagnostic origin checks, not a supported production search setting or timed benchmark.',
   'Candidate rejection categories overlap and must not be summed as mutually exclusive box counts. Geometry counts and full constraint checks are reported separately.',
   'Total empty volume is a necessary volume condition only. It says nothing about shape, support, allowable load or gripper accessibility.',
   'A 384-iteration MCTS finish before 9 seconds is a finite-search stop, not evidence that a full 9-second search cannot improve packing.',
  ],rows};
 writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify({status:'completed',file:'public/diagnostics/density-11042-10s.json',rows:rows.map(r=>({algorithm:r.algorithm,...r.tally,elapsedMs:r.elapsedMs}))})+'\n');
}
try{main();}catch(error){process.stderr.write((error instanceof Error?error.stack:String(error))+'\n');process.exitCode=1;}
