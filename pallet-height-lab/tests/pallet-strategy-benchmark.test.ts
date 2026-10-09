import { it,expect } from 'vitest';
import { mkdirSync,writeFileSync } from 'node:fs';
import { runBenchmark,benchmarkCsv } from '../src/pallet/strategies/benchmark';
import { strategyDemo } from '../src/pallet/strategies/demo';
import { DEFAULT_STRATEGY } from '../src/pallet/strategies/PackingStrategy';
import { ONLINE_SEARCH } from '../src/pallet/types';

it('benchmarks identical mixed inventory and hidden arrivals for every strategy',()=>{
  const episodes=Number(process.env.PALLET_BENCH_EPISODES||3),seed=Number(process.env.PALLET_BENCH_SEED||42),s=strategyDemo();s.arrival.seed=seed;
  const settings={...ONLINE_SEARCH,maxCandidates:48,strategy:{...DEFAULT_STRATEGY,futureCandidates:8,lookaheadDepth:2,lookaheadSamples:3,lookaheadCandidates:4}};
  const rows=runBenchmark({scenario:s,settings,episodes});
  for(let e=0;e<episodes;e++){
    const group=rows.filter(r=>r.episode===e);expect(group).toHaveLength(6);
    for(const r of group){expect(r.arrivalSequence).toEqual(group[0].arrivalSequence);expect(r.observedSequence).toEqual(r.arrivalSequence.slice(0,r.observedSequence.length));expect(r.diagnostics.stabilityViolations).toBe(0);expect(r.metrics.height).toBeLessThanOrEqual(s.pallet.maxHeight);}
  }
  mkdirSync('docs',{recursive:true});writeFileSync('docs/strategy-benchmark.json',JSON.stringify({scenario:s,settings,rows},null,2));writeFileSync('docs/strategy-benchmark.csv',benchmarkCsv(rows));
  console.table(rows.map(r=>({seed:r.seed,algorithm:r.algorithm,placed:r.metrics.count,total:r.diagnostics.totalBoxes,height:r.metrics.height,utilization:r.metrics.utilization.toFixed(3),milliseconds:r.metrics.totalMs.toFixed(0),FPL:r.diagnostics.futurePlacementLoss.toFixed(3)})));
},600000);
