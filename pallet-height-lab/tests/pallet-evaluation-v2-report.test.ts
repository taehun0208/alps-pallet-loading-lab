import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { strategyDemo } from '../src/pallet/strategies/demo';
import { ONLINE_SEARCH } from '../src/pallet/types';
import { runTrial } from '../src/pallet/benchmark/runner';
import { aggregate } from '../src/pallet/benchmark/scoring';
import { report,csv } from '../src/pallet/benchmark/export';
import { DEFAULT_WEIGHTS,DEFAULT_THRESHOLDS } from '../src/pallet/benchmark/model';
import type { BenchmarkConfig,TrialRow } from '../src/pallet/benchmark/model';
it.skipIf(process.env.PAC_BENCH_V2_REPORT!=='1')('measures paired random orders after discarded warmup',async()=>{
 const c:BenchmarkConfig={scenario:strategyDemo(),settings:{...ONLINE_SEARCH,maxCandidates:64},algorithms:['greedy','random'],cases:['random'],repeats:10,seed:42,decisionMs:1000,trialMs:30000,probeLimit:4,includeOffline:false,warmupRuns:1},rows:TrialRow[]=[];
 const warm=new Map<string,TrialRow>();for(const algorithm of c.algorithms)warm.set(algorithm,await runTrial(c,{algorithm,caseId:'random',seed:42,episode:0}));
 for(let episode=0;episode<c.repeats;episode++)for(const algorithm of c.algorithms){const r=await runTrial(c,{algorithm,caseId:'random',seed:42+episode,episode});const w=warm.get(algorithm)!;r.warmup={requested:1,completed:['partial','complete'].includes(w.outcome)?1:0,outcomes:[w.outcome],sameWorker:true};rows.push(r);}
 for(let i=0;i<rows.length;i+=2){expect(rows[i].arrivalIds).toEqual(rows[i+1].arrivalIds);expect(rows[i].fingerprint).toBe(rows[i+1].fingerprint);}
 expect(rows.every(r=>!Object.values(r.hardConstraints!).some(h=>h.status==='FAIL'))).toBe(true);
 const environment={runtime:process.version,os:os.platform(),cpu:os.cpus()[0]?.model,threads:os.cpus().length,memoryBytes:os.totalmem(),execution:'Node single process; same process warmup and measurement. Browser Worker measurements are separate.',power:'uncontrolled desktop'};
 writeFileSync('docs/benchmark-v2-measured.json',JSON.stringify(report(c,rows,DEFAULT_WEIGHTS,DEFAULT_THRESHOLDS,environment),null,2));writeFileSync('docs/benchmark-v2-measured.csv',csv(rows));
 console.log(JSON.stringify(aggregate(rows).map(a=>({algorithm:a.algorithm,rankGroup:a.rankGroup,n:a.rows.length,count:a.metrics.count.mean,completion:a.metrics.completion.mean,utilization:a.metrics.utilization.mean,meanMs:a.metrics.meanMs.mean,score:a.score,hard:Object.fromEntries(Object.entries(a.hardConstraints).map(([k,v])=>[k,v.status]))})),null,2));
},120000);
