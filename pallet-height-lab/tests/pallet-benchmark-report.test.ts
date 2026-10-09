import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { strategyDemo } from '../src/pallet/strategies/demo';
import { ONLINE_SEARCH } from '../src/pallet/types';
import { runTrial } from '../src/pallet/benchmark/runner';
import { algorithmRegistry } from '../src/pallet/benchmark/registry';
import { aggregate } from '../src/pallet/benchmark/scoring';
import { report,csv } from '../src/pallet/benchmark/export';
import { DEFAULT_WEIGHTS,DEFAULT_THRESHOLDS } from '../src/pallet/benchmark/model';
import type { BenchmarkConfig,TrialRow } from '../src/pallet/benchmark/model';
// Explicit reproducible experiment, not an implicit artifact-writing unit test.
it.skipIf(process.env.PAC_BENCH_REPORT!=='1')('records 100 identical paired seeds, mixed-order comparisons, all adapters and exceptions',async()=>{
 const c:BenchmarkConfig={scenario:strategyDemo(),settings:{...ONLINE_SEARCH,maxCandidates:64},algorithms:['greedy','random','future-hybrid'],cases:['random'],repeats:10,seed:42,decisionMs:1000,trialMs:30000,probeLimit:4,includeOffline:true},rows:TrialRow[]=[];
 for(let episode=0;episode<10;episode++)for(const algorithm of [...c.algorithms,'offline-stock'])rows.push(await runTrial(c,{algorithm,caseId:'random',seed:42+episode,episode}));
 const smoke=structuredClone(c);smoke.scenario.types=smoke.scenario.types.slice(2,3);smoke.scenario.types[0].quantity=4;smoke.decisionMs=60000;smoke.trialMs=300000;smoke.probeLimit=0;
 for(let episode=0;episode<100;episode++)for(const algorithm of ['random','greedy'])rows.push(await runTrial(smoke,{algorithm,caseId:'mixed',seed:100+episode,episode}));
 for(const algorithm of algorithmRegistry().filter(a=>a.scope==='online').map(a=>a.id)){const r=await runTrial(smoke,{algorithm,caseId:'mixed',seed:700,episode:0});expect(r.outcome,algorithm+': '+r.reason).toBe('complete');}
 const events:TrialRow[]=[];for(const caseId of ['missing','damaged','resize','palletChange'] as const)events.push(await runTrial(smoke,{algorithm:'random',caseId,seed:701,episode:0}));
 const environment={runtime:process.version,os:os.platform(),cpu:os.cpus()[0]?.model,logicalThreads:os.cpus().length,memoryBytes:os.totalmem(),workers:1,note:'Node 단일 순차 실행. 브라우저 측정과 직접 동일하지 않음'};
 writeFileSync('docs/benchmark-measured.json',JSON.stringify({mixed:report(c,rows.slice(0,40),DEFAULT_WEIGHTS,DEFAULT_THRESHOLDS,environment),paired100:report({...smoke,repeats:100,seed:100,cases:['mixed'],algorithms:['random','greedy'],includeOffline:false},rows.slice(40),DEFAULT_WEIGHTS,DEFAULT_THRESHOLDS,environment),events},null,2));
 writeFileSync('docs/benchmark-measured.csv',csv(aggregate(rows.slice(0,40)).flatMap(a=>a.rows).concat(rows.slice(40),events)));
 console.log(JSON.stringify({mixed:aggregate(rows.slice(0,40)).map(a=>({algorithm:a.algorithm,score:a.score,completion:a.metrics.completion.mean,count:a.metrics.count.mean,utilization:a.metrics.utilization.mean,meanMs:a.metrics.meanMs.mean,failed:a.failed,timeouts:a.timeouts,safe:a.safe,regret:a.metrics.regret.mean})),paired:aggregate(rows.slice(40)).map(a=>({algorithm:a.algorithm,n:a.rows.length,completion:a.metrics.completion.mean,safe:a.safe})),events:events.map(r=>({case:r.caseId,outcome:r.outcome,exceptions:r.exceptions}))},null,2));
},180000);
