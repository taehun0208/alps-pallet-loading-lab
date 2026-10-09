import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { randomScenario,DEFAULT_RANDOM } from '../src/pallet/random';
import { runScenario,ArrivalEnvironment,replay } from '../src/pallet/environment';
import { DEFAULT_SEARCH } from '../src/pallet/types';
import { stability } from '../src/pallet/stability';
import { intersects } from '../src/pallet/geometry';
it('compares fixed-arrival failures against proactive stock selection on the same unmodified heterogeneous boxes',()=>{
 const results=[];for(const [seed,arrivalSeed] of [[20261004,42],[7919,834],[15401,902]]){const s=randomScenario({...DEFAULT_RANDOM,seed,arrivalSeed,totalCount:seed===20261004?30:24});const before=runScenario(s,'greedy',DEFAULT_SEARCH);s.supplyMode='stock-select';for(const algorithm of ['bl','greedy','rollout'] as const){const r=runScenario(s,algorithm,DEFAULT_SEARCH),env=new ArrivalEnvironment(s);expect(r.metrics.count).toBeGreaterThanOrEqual(before.metrics.count);expect(stability(r.frame.placements,s.constraints.stability).violations).toEqual([]);expect(r.metrics.loadUtilization).toBeLessThanOrEqual(1);
 for(let n=0;n<=r.frame.records.length;n++){const f=replay(r.frame.records,n);expect(Object.values(env.remaining(f)).reduce((a,b)=>a+b,0)+f.placements.length).toBe(env.total);}
 for(let i=0;i<r.frame.placements.length;i++){const b=r.frame.placements[i];expect(b.position.x).toBeGreaterThanOrEqual(0);expect(b.position.y).toBeGreaterThanOrEqual(0);expect(b.position.x+b.size.w).toBeLessThanOrEqual(s.pallet.width);expect(b.position.y+b.size.d).toBeLessThanOrEqual(s.pallet.depth);expect(b.position.z+b.size.h).toBeLessThanOrEqual(s.pallet.maxHeight);expect(b.supportRatio).toBeGreaterThanOrEqual(.95);for(let j=0;j<i;j++)expect(intersects(b,r.frame.placements[j])).toBe(false);}
 results.push({scenario:s,before:before.metrics,algorithm,metrics:r.metrics,placements:r.frame.placements,remaining:env.remaining(r.frame),records:r.frame.records.map(r=>({step:r.step,observation:r.observation,remaining:r.remaining,selection:r.analysis?.stockSelection,reason:r.reason}))});console.log(`stock ${seed} ${algorithm}: ${before.metrics.count} -> ${r.metrics.count}/${env.total}, median=${r.metrics.medianMs.toFixed(1)}ms`);
 }}writeFileSync('docs/pallet-stock-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),model:'all supplied inventory selectable; joint box/position planning with foundation preservation',settings:DEFAULT_SEARCH,results},null,2));
},300000);
