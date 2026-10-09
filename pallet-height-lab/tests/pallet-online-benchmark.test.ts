import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scenario } from '../src/pallet/scenarios';
import { randomScenario,DEFAULT_RANDOM } from '../src/pallet/random';
import { runScenario,ArrivalEnvironment,replay } from '../src/pallet/environment';
import { DEFAULT_SEARCH,ONLINE_SEARCH } from '../src/pallet/types';
import { inspectConstraints } from '../src/pallet/constraints';
import { stability } from '../src/pallet/stability';
import { evaluatePattern } from '../src/pallet/patternEvaluation';
it('compares the rewritten causal planner on unchanged mixed inputs with task constraints and hidden arrivals',()=>{
 const results=[];
 for(const [seed,arrivalSeed] of [[20261004,42],[7919,834],[15401,902]]){
  const s=randomScenario({...DEFAULT_RANDOM,seed,arrivalSeed,totalCount:seed===20261004?30:24});s.supplyMode='arrival';s.constraints=structuredClone(scenario('online-task').constraints);const old=runScenario(s,'greedy',DEFAULT_SEARCH);
  for(const algorithm of ['bl','greedy','rollout'] as const){const r=runScenario(s,algorithm,ONLINE_SEARCH),env=new ArrivalEnvironment(s);
   expect(stability(r.frame.placements,s.constraints.stability).violations).toEqual([]);expect(r.metrics.loadUtilization).toBeLessThanOrEqual(1);
   for(let n=0;n<=r.frame.records.length;n++){const f=replay(r.frame.records,n),current=env.current(f.processed);expect(Object.values(env.remaining(f)).reduce((a,b)=>a+b,0)+(current?1:0)+f.placements.length+f.excluded.length+f.missing.length).toBe(env.total);}
   for(const record of r.frame.records){expect(record.observation).toEqual(env.current(record.step-1));expect(record.analysis?.stockSelection).toBeUndefined();if(record.disposition==='placed'){expect(inspectConstraints(record.placement!,record.observation,record.before,s.pallet,s.constraints).reasons).toEqual([]);expect(record.path!.model).toBe('gripper');expect(record.analysis!.selectedBoxId).toBe(record.observation.id);}}
   const evaluation=evaluatePattern(r.frame,s);expect(evaluation.valid).toBe(true);expect(evaluation.score).not.toBeNull();for(const record of r.frame.records)if(record.path)expect(record.path.points.every(p=>Number.isFinite(p.yaw))).toBe(true);results.push({scenario:s,algorithm,evaluation,previousGreedy:old.metrics,metrics:r.metrics,placements:r.frame.placements,records:r.frame.records.map(r=>({context:r.context,step:r.step,observation:r.observation,disposition:r.disposition,remaining:r.remaining,placement:r.placement,online:r.analysis?.online,explanation:r.analysis?.explanation,path:r.path,reason:r.reason}))});console.log(`online ${seed} ${algorithm}: old greedy ${old.metrics.count} -> ${r.metrics.count}/${env.total}, median=${r.metrics.medianMs.toFixed(1)}ms, reason=${r.metrics.reason}`);
  }
 }
 writeFileSync('docs/pallet-online-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),model:'unknown future sequence; current arrival only; each-support heavy rule; gripper yaw sweep and TCP annular reach proxy; exact remaining probes and causal sampled rollout',settings:ONLINE_SEARCH,results},null,2));
},300000);
