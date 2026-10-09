import { ArrivalEnvironment,runScenario } from '../environment';
import { STRATEGY_IDS } from './PackingStrategy';
import { strategyMetrics } from './metrics';
import type { StrategyId } from './PackingStrategy';
import type { Scenario,SearchSettings } from '../types';
export interface BenchmarkConfig { scenario:Scenario;settings:SearchSettings;algorithms?:StrategyId[];episodes?:number;seeds?:number[] }
export function runBenchmark(config:BenchmarkConfig){
  const {scenario,settings}=config,algorithms=config.algorithms??[...STRATEGY_IDS],episodes=config.episodes??config.seeds?.length??1;
  if(!Number.isInteger(episodes)||episodes<1||episodes>1000)throw Error('benchmark episodes: 1~1000');
  if(scenario.supplyMode==='stock-select')throw Error('동일 입고 비교에는 arrival 시나리오가 필요합니다.');
  if(config.seeds&&config.seeds.length!==episodes)throw Error('episodes와 seeds 길이가 일치해야 합니다.');
  if(!algorithms.length||algorithms.some(a=>!STRATEGY_IDS.includes(a)))throw Error('benchmark 알고리즘 설정 오류');
  const rows=[];
  for(let e=0;e<episodes;e++){
    const seed=config.seeds?.[e]??scenario.arrival.seed+e,s={...structuredClone(scenario),arrival:{...scenario.arrival,seed}},env=new ArrivalEnvironment(s);
    // Full intended arrival trace is retained for comparison auditing, even if one policy stops early.
    // This stays OUTSIDE PlanningInput and is never passed to any strategy.
    const arrivalSequence=Array.from({length:env.total},(_,i)=>env.current(i)!.id);
    for(const algorithm of algorithms){const r=runScenario(s,algorithm,structuredClone(settings));rows.push({episode:e,algorithm,seed,arrivalSequence,observedSequence:r.frame.records.map(r=>r.observation.id),metrics:r.metrics,diagnostics:strategyMetrics(r.frame,s,algorithm)});}
  }
  return rows;
}
export function benchmarkCsv(rows:ReturnType<typeof runBenchmark>){
  const columns=['episode','algorithm','seed','total','placed','failed','unprocessed','utilization','occupied_mm3','height_mm','com_x','com_y','com_z','avg_support','stability_violations','total_ms','avg_ms','max_ms','replans','avg_future','min_future','future_dead_ends','FPL','reserved_slots','reservation_changes'];
  const records=rows.map(r=>{const m=r.metrics,d=r.diagnostics;return [r.episode,r.algorithm,r.seed,d.totalBoxes,d.placedBoxes,d.failedBoxes,d.unprocessedBoxes,m.utilization,m.volume,m.height,m.center.x,m.center.y,m.center.z,d.averageSupport,d.stabilityViolations,m.totalMs,d.averageDecisionMs,d.maxDecisionMs,d.replans,d.averageFutureFeasible,d.minFutureFeasible,d.futureDeadEnds,d.futurePlacementLoss,d.reservedSlotCount,d.reservationChanges].map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',');});
  return '\uFEFF'+[columns.join(','),...records].join('\r\n');
}
