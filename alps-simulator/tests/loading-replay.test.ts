import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {loadingDuration,loadingFrame} from '../src/cluster/loading';
import type {TrialResult} from '../src/engine/types';
const trial:TrialResult=JSON.parse(readFileSync(new URL('../public/cluster/trials/evaluation-22010-cluster-layer.json',import.meta.url),'utf8'));
describe('loading replay faithfully projects recorded accept/reject decisions',()=>{
 it('shows an accepted box only after its recorded drop and never counts the moving box twice',()=>{
  const d=trial.decisions.find(d=>d.accepted)!;
  const before=loadingFrame(trial,d.timing.robotStart!);
  expect(before.moving?.id).toBe(d.box.id);expect(before.placed.some(p=>p.id===d.box.id)).toBe(false);
  const after=loadingFrame(trial,d.timing.robotEnd!);
  expect(after.placed.some(p=>p.id===d.box.id)).toBe(true);expect(after.moving?.id).not.toBe(d.box.id);
 });
 it('conserves all IDs at every recorded timing boundary and during motion',()=>{
  const times=trial.decisions.flatMap(d=>[d.timing.start,d.timing.end,...(d.timing.robotStart===null?[]:[d.timing.robotStart,(d.timing.robotStart+d.timing.robotEnd!)/2,d.timing.robotEnd!])]);
  for(const time of times){const f=loadingFrame(trial,time);const all=[...f.placed,...f.rejected,...f.pending,...(f.moving?[f.moving]:[])];
   expect(all).toHaveLength(trial.arrivals.length);expect(new Set(all.map(b=>b.id)).size).toBe(trial.arrivals.length);
  }
 });
 it('finishes at the exact computed layout and excludes every unplaced box',()=>{
  const f=loadingFrame(trial,loadingDuration(trial));
  expect(f.placed).toEqual(trial.placements);expect(f.rejected.map(b=>b.id).sort()).toEqual(trial.unplaced.map(b=>b.id).sort());
  expect(f.pending).toEqual([]);expect(f.moving).toBeNull();expect(f.done).toBe(true);
 });
 it('counts remaining arrivals from recognition, including rejected arrivals, with no future peek',()=>{
  for(const d of trial.decisions){
   const f=loadingFrame(trial,d.timing.start);
   // Multiple zero-duration boundaries can expose later decisions at the same instant.
   const latest=trial.decisions.filter(x=>x.timing.start<=d.timing.start).at(-1)!;
   expect(f.remaining).toEqual(latest.remaining);
   const observed=trial.decisions.slice(0,latest.index+1);
   for(const type of trial.scenario.types)expect(f.remaining[type.id]).toBe(type.quantity-observed.filter(x=>x.box.typeId===type.id).length);
  }
 });
 it('scrubbing does not modify source data and rejects a nonfinite clock',()=>{
  const original=structuredClone(trial);loadingFrame(trial,100);loadingFrame(trial,2);loadingFrame(trial,9000);
  expect(trial).toEqual(original);expect(()=>loadingFrame(trial,NaN)).toThrow();
 });
});
