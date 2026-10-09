import { it,expect } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { runScenario,ArrivalEnvironment } from '../src/pallet/environment';
import { COMPACT_SEARCH,DEFAULT_PHYSICS } from '../src/pallet/types';
import { standingHeight,DEFAULT_STANDING_HEIGHT,isTallBox } from '../src/pallet/standingHeight';
import { inspectConstraints } from '../src/pallet/constraints';
import { verifyPhysics } from '../src/pallet/physics';
import { interiorSpace } from '../src/pallet/interior';
it('measures local standing height on the same three mixed inputs before UI integration',async()=>{
 const previous=JSON.parse(readFileSync('docs/pallet-interior-measurements.json','utf8')),results=[];
 for(const entry of previous.results){const old=entry.variants.find((v:any)=>v.name==='interior-six-poses');if(!old)continue;
  const s=structuredClone(old.scenario);s.constraints.standingHeight={...DEFAULT_STANDING_HEIGHT};
  const before=old.placements.filter(isTallBox).map((b:any)=>({id:b.id,...standingHeight(b,old.placements.filter((o:any)=>o.id!==b.id),s.constraints)}));
  const r=runScenario(s,'greedy',COMPACT_SEARCH),details=r.frame.placements.filter(isTallBox).map(b=>({id:b.id,...standingHeight(b,r.frame.placements.filter(o=>o.id!==b.id),s.constraints)}));
  for(const rec of r.frame.records)if(rec.placement)expect(inspectConstraints(rec.placement,rec.observation,rec.before,s.pallet,s.constraints).reasons).toEqual([]);
  expect(details.every(v=>v.valid)).toBe(true);const env=new ArrivalEnvironment(s);expect(r.metrics.count+Object.values(env.remaining(r.frame)).reduce((a,b)=>a+b,0)).toBe(env.total);
  const physics=await verifyPhysics(r.frame.placements,s.pallet,DEFAULT_PHYSICS,r.runId),interior=interiorSpace(r.frame.placements);
  results.push({seed:entry.seed,scenario:s,settings:COMPACT_SEARCH,before:{metrics:old.metrics,details},after:{metrics:r.metrics,details,placements:r.frame.placements,interior,physics,order:r.frame.records.filter(rec=>rec.placement).map(rec=>({id:rec.observation.id,position:rec.placement!.position,...standingHeight(rec.placement!,rec.before,s.constraints)}))}});
  console.log(JSON.stringify({seed:entry.seed,before:old.metrics.count,after:r.metrics.count,height:r.metrics.height,beforeIsolated:before.filter((v:any)=>!v.valid).length,afterIsolated:details.filter(v=>!v.valid).length,tall:details.length,physics:physics.status,milliseconds:Math.round(r.metrics.totalMs)}));
 }
 writeFileSync('docs/pallet-standing-height-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),results},null,2));
},300000);
