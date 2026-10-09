import { it,expect } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { scenario } from '../src/pallet/scenarios';
import { runScenario,ArrivalEnvironment } from '../src/pallet/environment';
import { ALL_ORIENTATIONS,isStanding } from '../src/pallet/orientations';
import { COMPACT_SEARCH,DEFAULT_PHYSICS } from '../src/pallet/types';
import { interiorSpace } from '../src/pallet/interior';
import { inspectConstraints } from '../src/pallet/constraints';
import { verifyPhysics } from '../src/pallet/physics';
it('measures interior packing and six poses against the unchanged prior random inputs',async()=>{
 const previous=JSON.parse(readFileSync('docs/pallet-compact-measurements.json','utf8')),results=[];
 const cases=previous.results.filter((r:any)=>[20261004,7919,20261005].includes(r.scenario.generation.seed));
 for(const entry of cases){const base=entry.scenario,old=entry.policies.find((p:any)=>p.name==='compact'),variants=[];
  variants.push({name:'previous-two-poses',scenario:base,metrics:old.metrics,interior:interiorSpace(old.placements),placements:old.placements,physics:old.physics});
  for(const six of (base.generation.seed===20261004?[false,true]:[true])){
   const s=structuredClone(base);if(six)for(const t of s.types)if(t.handling!=='upright')t.orientations=[...ALL_ORIENTATIONS];
   const r=runScenario(s,'greedy',COMPACT_SEARCH),physics=await verifyPhysics(r.frame.placements,s.pallet,DEFAULT_PHYSICS,r.runId),interior=interiorSpace(r.frame.placements);
   for(const record of r.frame.records)if(record.placement)expect(inspectConstraints(record.placement,record.observation,record.before,s.pallet,s.constraints).reasons).toEqual([]);
   expect(new ArrivalEnvironment(s).total).toBe(r.metrics.count+Object.values(new ArrivalEnvironment(s).remaining(r.frame)).reduce((a,b)=>a+b,0));
   const standing=r.frame.placements.filter(b=>isStanding(b.orientation)).length;
   console.log(base.generation.seed,six?'six':'two',r.metrics.count,r.metrics.height,(interior.voidVolume/1e9).toFixed(4),standing,physics.status,r.metrics.totalMs.toFixed(0));
   variants.push({name:six?'interior-six-poses':'interior-two-poses',scenario:s,settings:COMPACT_SEARCH,metrics:r.metrics,interior,standing,placements:r.frame.placements,physics});
  }
  results.push({seed:base.generation.seed,variants});
 }
 writeFileSync('docs/pallet-interior-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),results},null,2));
},300000);
