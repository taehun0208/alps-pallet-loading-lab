import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scenario } from '../src/pallet/scenarios';
import { runScenario } from '../src/pallet/environment';
import { COMPACT_SEARCH,DEFAULT_PHYSICS } from '../src/pallet/types';
import { verifyPhysics } from '../src/pallet/physics';
it('runs repeated randomly generated SKUs without fitting their dimensions to the pallet',async()=>{
 const s=scenario('compact-mixed'),r=runScenario(s,'greedy',COMPACT_SEARCH),physics=await verifyPhysics(r.frame.placements,s.pallet,DEFAULT_PHYSICS,r.runId);
 expect(s.constraints).toEqual(scenario('online-task').constraints);expect(s.generation?.assortment).toBe('repeated');
 console.log(r.metrics.count,r.metrics.height,r.metrics.efficiency,physics.status,r.metrics.reason);
 writeFileSync('docs/pallet-compact-demo.json',JSON.stringify({scenario:s,metrics:r.metrics,placements:r.frame.placements,physics},null,2));
},60000);
