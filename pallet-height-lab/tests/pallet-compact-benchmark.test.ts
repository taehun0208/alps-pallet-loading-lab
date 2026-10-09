import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scenario } from '../src/pallet/scenarios';
import { heterogeneousInventory,DEFAULT_FIELD } from '../src/pallet/inventoryGeneration';
import { runScenario,ArrivalEnvironment } from '../src/pallet/environment';
import { ONLINE_SEARCH,COMPACT_SEARCH,DEFAULT_PHYSICS } from '../src/pallet/types';
import { inspectConstraints } from '../src/pallet/constraints';
import { stability } from '../src/pallet/stability';
import { verifyPhysics } from '../src/pallet/physics';

it('compares unchanged heterogeneous stock, including holdout seeds, under identical hard constraints',async()=>{
 const results=[];
 for(const [seed,count] of [[20261004,30],[7919,24],[15401,24],[20261005,30]]){
  const s=scenario('online-task');s.supplyMode='stock-select';const generated=heterogeneousInventory({...DEFAULT_FIELD,seed,totalCount:count});s.types=generated.types;s.generation=generated.generation;
  const policies=[];
  for(const [name,settings] of [['centred',ONLINE_SEARCH],['compact',COMPACT_SEARCH]] as const){
   const r=runScenario(s,'greedy',settings);expect(stability(r.frame.placements,s.constraints.stability).violations).toEqual([]);
   for(const record of r.frame.records)if(record.placement)expect(inspectConstraints(record.placement,record.observation,record.before,s.pallet,s.constraints).reasons).toEqual([]);
   const remaining=new ArrivalEnvironment(s).remaining(r.frame);expect(Object.values(remaining).reduce((a,b)=>a+b,0)+r.metrics.count).toBe(count);
   const physics=name==='compact'?await verifyPhysics(r.frame.placements,s.pallet,DEFAULT_PHYSICS,`${seed}-${name}`):null;
   const report={name,settings,metrics:r.metrics,placements:r.frame.placements,remaining,physics};policies.push(report);
   console.log(seed,name,r.metrics.count,r.metrics.height,(r.metrics.efficiency*100).toFixed(1),r.metrics.totalMs.toFixed(0),physics?.status);
  }
  results.push({scenario:s,policies});
 }
 writeFileSync('docs/pallet-compact-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),results},null,2));
},300000);
