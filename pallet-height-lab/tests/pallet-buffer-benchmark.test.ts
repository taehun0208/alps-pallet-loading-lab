import { it,expect } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { runScenario,ArrivalEnvironment,replay } from '../src/pallet/environment';
import { inspectConstraints } from '../src/pallet/constraints';
import { COMPACT_SEARCH,DEFAULT_PHYSICS } from '../src/pallet/types';
import { verifyPhysics } from '../src/pallet/physics';
it('measures deferral on three saved heterogeneous inputs with unchanged physical constraints',async()=>{
 const previous=JSON.parse(readFileSync('docs/pallet-standing-height-measurements.json','utf8')),results=[];
 for(const entry of previous.results){const s=entry.scenario,r=runScenario(s,'greedy',COMPACT_SEARCH),env=new ArrivalEnvironment(s);
  for(let n=1;n<=r.frame.records.length;n++){const f=replay(r.frame.records,n),rec=f.records.at(-1)!;
   expect(f.placements.length+env.available(f).length).toBe(env.total);
   if(rec.placement)expect(inspectConstraints(rec.placement,rec.observation,rec.before,s.pallet,s.constraints).reasons).toEqual([]);
   for(const h of f.buffer||[])expect(inspectConstraints(h.reservedTop,{...h.observation,pickupPosition:h.source},f.placements,s.pallet,s.constraints).reasons).toEqual([]);
  }
  const physics=await verifyPhysics(r.frame.placements,s.pallet,DEFAULT_PHYSICS,r.runId),events=r.frame.records.filter(rec=>rec.analysis?.bufferPlan?.addedIds.length||rec.analysis?.bufferPlan?.releasedId).map(rec=>({step:rec.step,placed:rec.observation.id,buffer:rec.analysis!.bufferPlan}));
  results.push({seed:entry.seed,scenario:s,settings:COMPACT_SEARCH,before:entry.after.metrics,after:r.metrics,events,held:r.frame.buffer,placements:r.frame.placements,physics});
  console.log(JSON.stringify({seed:entry.seed,before:entry.after.metrics.count,after:r.metrics.count,height:r.metrics.height,events:events.map(e=>({step:e.step,held:e.buffer?.addedIds,released:e.buffer?.releasedId})),remainingHeld:r.frame.buffer?.length,physics:physics.status,milliseconds:Math.round(r.metrics.totalMs)}));
 }
 writeFileSync('docs/pallet-buffer-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),results},null,2));
},300000);
