import { it,expect } from 'vitest';
import { scenario } from '../src/pallet/scenarios';
import { advance,ArrivalEnvironment,replay,runScenario } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { inspectConstraints } from '../src/pallet/constraints';
import { COMPACT_SEARCH,emptyFrame } from '../src/pallet/types';
import { BUFFER_SOURCE } from '../src/pallet/temporaryBuffer';

for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm}: holds the fragile cap, builds both foundations, then retrieves it onto the top`,()=>{
 const s=scenario('buffer-demo'),settings={...COMPACT_SEARCH,weights:{...COMPACT_SEARCH.weights,maximum:2000}},r=runScenario(s,algorithm,settings);
 expect(r.frame.records.map(v=>v.observation.typeId)).toEqual(['BASE','MID','CAP']);
 expect(r.metrics.complete).toBe(true);expect(r.metrics.height).toBe(450);
 expect(r.frame.records[0].bufferAfter?.map(h=>h.observation.id)).toEqual(['CAP-01']);
 expect(r.frame.records[1].bufferAfter?.[0].reservedTop.position.z).toBe(350);
 expect(r.frame.records[2].observation.pickupPosition).toEqual(BUFFER_SOURCE);
 expect(r.frame.records[2].analysis?.valid).toBeGreaterThan(0);expect(r.frame.records[2].analysis?.generated).toBeGreaterThan(0);expect(r.frame.records[2].placement?.position.z).toBe(350);expect(r.frame.buffer).toEqual([]);
 expect(r.frame.records[2].path?.points[0].tcp.x).toBe(BUFFER_SOURCE.x+200);
 const env=new ArrivalEnvironment(s);
 for(let n=0;n<=3;n++){const f=replay(r.frame.records,n);expect(f.placements.length+env.available(f).length).toBe(3);
  expect(new Set([...f.placements.map(p=>p.id),...env.available(f).map(o=>o.id)]).size).toBe(3);
  if(n===1||n===2)expect(f.buffer?.[0].observation.id).toBe('CAP-01');
 }
 for(const rec of r.frame.records)expect(inspectConstraints(rec.placement!,rec.observation,rec.before,s.pallet,s.constraints).reasons).toEqual([]);
});
it('without the buffer a lowest-top baseline places the cap first and blocks further stacking',()=>{
 const r=runScenario(scenario('buffer-demo'),'bl',{...COMPACT_SEARCH,temporaryBuffer:false});
 expect(r.metrics.count).toBe(1);expect(r.frame.records[0].observation.typeId).toBe('CAP');
 expect(r.frame.buffer).toBeUndefined();
});
it('planning does not mutate or consume stock; cancelling a proposal leaves the frame and inventory intact',()=>{
 const s=scenario('buffer-demo'),env=new ArrivalEnvironment(s),f=emptyFrame(),input=env.input(f,'bl',COMPACT_SEARCH,'a')!,before=structuredClone(input);
 const proposal=plan(input);expect(input).toEqual(before);expect(f).toEqual(emptyFrame());expect(env.available(f)).toHaveLength(3);
 expect(advance(f,input,{...proposal,runId:'stale'})).toBe(f);
 const committed=advance(f,input,proposal),next=env.input(committed,'bl',COMPACT_SEARCH,'a')!;
 const blocked=advance(committed,next,{...plan(next),selectedId:null});expect(blocked.buffer).toEqual(committed.buffer);expect(env.available(blocked)).toHaveLength(2);
});
it('does not look into unreached arrivals or invent a buffer in sequential mode',()=>{
 const s=scenario('buffer-demo');s.supplyMode='arrival';s.arrival.pattern='ordered';
 const r=runScenario(s,'bl',COMPACT_SEARCH);expect(r.metrics.count).toBe(1);expect(r.frame.buffer).toBeUndefined();
});
it('refuses to hold a box when no safe upper site or accessible retrieval exists',()=>{
 for(const kind of ['height','workspace'] as const){const s=scenario('buffer-demo');if(kind==='height')s.pallet.maxHeight=200;else s.constraints.workspace.yMax=800;
 const r=runScenario(s,'bl',COMPACT_SEARCH);expect(r.frame.records.every(v=>!v.bufferAfter?.length)).toBe(true);
 }
});

it('does not divert an already safe greedy order just because an unused alternative would block stock',()=>{
 const r=runScenario(scenario('buffer-demo'),'greedy',COMPACT_SEARCH);
 expect(r.metrics.complete).toBe(true);expect(r.frame.records.every(r=>!r.analysis?.bufferPlan?.addedIds.length)).toBe(true);
});
it('returns before the next foundation would consume the reserved headroom',()=>{
 const s=scenario('buffer-demo');s.pallet.maxHeight=350;const r=runScenario(s,'bl',COMPACT_SEARCH);
 expect(r.frame.records.filter(r=>r.placement).map(r=>r.observation.typeId)).toEqual(['BASE','CAP']);
 expect(r.frame.records[1].analysis?.bufferPlan?.releasedId).toBe('CAP-01');expect(r.metrics.height).toBe(300);
 expect(r.frame.buffer).toEqual([]);
});
it('rechecks the reserved upper site during commit and rejects a corrupted promise without losing stock',()=>{
 const s=scenario('buffer-demo'),env=new ArrivalEnvironment(s),f=emptyFrame(),input=env.input(f,'bl',COMPACT_SEARCH,'a')!,a=plan(input);
 a.bufferPlan!.held[0].reservedTop.position.x=10000;
 const rejected=advance(f,input,a);expect(rejected.blocked).toBe(true);expect(rejected.placements).toHaveLength(0);expect(env.available(rejected)).toHaveLength(3);
 expect(rejected.reason).toContain('상단 복귀');
});
