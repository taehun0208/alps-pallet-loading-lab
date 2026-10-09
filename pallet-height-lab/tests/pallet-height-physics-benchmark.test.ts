import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scenario } from '../src/pallet/scenarios';
import { runScenario } from '../src/pallet/environment';
import { ONLINE_SEARCH,DEFAULT_PHYSICS } from '../src/pallet/types';
import { verifyPhysics } from '../src/pallet/physics';
import { heightSummary } from '../src/pallet/heightSummary';
it('checks centred stock positions and rigid-body convergence without relaxing movement tolerances',async()=>{
 const results=[];
 for(const s of [scenario('high-stack'),{...scenario('online-task'),supplyMode:'stock-select' as const}]){
  const r=runScenario(s,'greedy',ONLINE_SEARCH),physics=await verifyPhysics(r.frame.placements,s.pallet,DEFAULT_PHYSICS,'seat');
  expect(physics.status).toBe('stable');expect(physics.settings.moveToleranceMm).toBe(5);expect(physics.settings.angleToleranceDeg).toBe(3);
  if(s.id==='high-stack')expect(Math.max(...r.metrics.supportBalances!.map(b=>b.offsetMm))).toBeLessThan(1e-4);
  const convergence=[];
  if(s.id==='high-stack')for(const settings of [{...DEFAULT_PHYSICS,solverIterations:24},{...DEFAULT_PHYSICS,dt:1/240}]){
   const refined=await verifyPhysics(r.frame.placements,s.pallet,settings,'convergence');
   const maxDifferenceMm=Math.max(...refined.poses.map(p=>{const a=physics.poses.find(v=>v.id===p.id)!.actual;return Math.hypot(p.actual.x-a.x,p.actual.y-a.y,p.actual.z-a.z);}));
   expect(refined.status).toBe('stable');expect(maxDifferenceMm).toBeLessThan(.2);convergence.push({settings:refined.settings,maxDifferenceMm,maxDisplacementMm:Math.max(...refined.poses.map(p=>p.displacementMm))});
  }
  const out={scenario:s,metrics:r.metrics,placements:r.frame.placements,heightAnalysis:heightSummary(r.frame,s),physics,convergence};results.push(out);
  console.log(JSON.stringify({name:s.name,count:r.metrics.count,height:r.metrics.height,layers:out.heightAnalysis.layers,physics:physics.status,maxMm:Math.max(...physics.poses.map(p=>p.displacementMm)),maxDeg:Math.max(...physics.poses.map(p=>p.angleDeg))}));
 }
 writeFileSync('docs/pallet-height-physics.json',JSON.stringify({measuredAt:new Date().toISOString(),results},null,2));
 expect(results[0].metrics.complete).toBe(true);
},180000);
