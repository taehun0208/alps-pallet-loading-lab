import { it } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { verifyPhysics } from '../src/pallet/physics';
import { DEFAULT_PHYSICS } from '../src/pallet/types';
it('checks whether mixed contact results converge with finer solver settings',async()=>{
 const data=JSON.parse(readFileSync('docs/pallet-compact-first-pass.json','utf8')),results=[];
 for(const result of data.results){const current=result.policies[1];if(current.physics.status==='stable')continue;
  for(const settings of [{...DEFAULT_PHYSICS,solverIterations:24},{...DEFAULT_PHYSICS,dt:1/240}]){const p=await verifyPhysics(current.placements,result.scenario.pallet,settings,'convergence');results.push({seed:result.scenario.generation.seed,settings,physics:p});console.log(result.scenario.generation.seed,settings.dt,settings.solverIterations,p.status,Math.max(...p.poses.map(b=>b.displacementMm)),Math.max(...p.poses.map(b=>b.angleDeg)));}
 }
 writeFileSync('docs/pallet-compact-convergence.json',JSON.stringify(results,null,2));
},30000);
