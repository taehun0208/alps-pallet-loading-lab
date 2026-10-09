import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {operationScenario,phaseSeconds,nextPhase,canRelease,manifest,actionTiming} from '../src/pallet/relay/operations';
import {relayDemo} from '../src/pallet/relay/demo';
import {createRelay,planRelay,runRelay,assertRelayInventory} from '../src/pallet/relay/engine';
import {inspectConstraints} from '../src/pallet/constraints';
it('applies physical tooling and context speed/payload without mutating the box source',()=>{
 const source=relayDemo(),snapshot=structuredClone(source),a=operationScenario(source,'amr',160),b=operationScenario(source,'cobot',80);
 expect(source).toEqual(snapshot);expect(a.constraints.robotMode).toBe('gripper');expect(b.constraints.gripper).toMatchObject({speed:300,payload:15,height:80});
 const w=createRelay(a,42,false),d=planRelay(a,w,'bl');expect(d.actions.length).toBeGreaterThan(0);
 const slow=planRelay(b,createRelay(b,42,false),'bl');expect(slow.actions[0].seconds).toBeGreaterThan(d.actions[0].seconds);
 const timing=actionTiming(d.actions[0],a);expect(timing.motion+timing.handling).toBeCloseTo(timing.total);
});
it('tool thickness changes actual clearance acceptance',()=>{
 const s=operationScenario(relayDemo(),'amr',40),w=createRelay(s,42,false),a=planRelay(s,w,'bl').actions.find(a=>a.kind==='place')!;
 const box=w.boxes.find(b=>b.observation.id===a.boxId)!.observation,c=a.candidate!;
 const thin=inspectConstraints(c.placement,box,[],s.pallet,s.constraints);expect(thin.reasons).toEqual([]);
 s.constraints.workspace.zMax=Math.max(...thin.path.points.map(p=>p.tcp.z))+100;
 expect(inspectConstraints(c.placement,box,[],s.pallet,s.constraints).reasons).toEqual([]);
 s.constraints.gripper.height=250;
 expect(inspectConstraints(c.placement,box,[],s.pallet,s.constraints).reasons).toContain('설정된 작업공간 밖');
});
it('releases only settled pallets, preserves stock, and accounts for complete operation timing',()=>{
 const s=operationScenario(relayDemo(),'amr',160),r=runRelay(s,'bl',{shuffle:false}),w=r.world;
 expect(assertRelayInventory(w)).toBe(true);expect(canRelease(w,1,false,r.decision)).toBe(false);expect(canRelease(w,0,true,r.decision)).toBe(false);expect(canRelease(w,0,false,null)).toBe(false);expect(canRelease(w,0,false,{actions:[{}]})).toBe(false);expect(canRelease(w,0,false,r.decision)).toBe(true);
 const before=JSON.stringify(w),out=manifest(w),ids=out.flatMap(p=>p.boxIds);expect(new Set(ids).size).toBe(ids.length);expect(ids.length+w.cells.reduce((n,c)=>n+c.queue.length,0)+w.pads.filter(p=>p.boxId).length).toBe(w.boxes.length);expect(JSON.stringify(w)).toBe(before);
 expect(nextPhase('receiving')).toBe('packing');expect(nextPhase('checking')).toBe('outbound');expect(nextPhase('outbound')).toBe('returning');expect(nextPhase('returning')).toBe('complete');expect(phaseSeconds('outbound',8,'amr')).toBe(9);expect(phaseSeconds('receiving',192,'amr')).toBeCloseTo(67.2);
 writeFileSync('docs/pallet-operations-validation.json',JSON.stringify({context:'amr',peak:r.peakConcurrent,placed:ids.length,total:w.boxes.length,unplaced:w.boxes.length-ids.length,robotSeconds:r.elapsed,processSeconds:phaseSeconds('receiving',8,'amr')+3+18,manifest:out},null,2));
});
it('measures candidate filtering and reuses unchanged plans',()=>{
 const s=operationScenario(relayDemo(),'amr',160),w=createRelay(s,42,false),first=planRelay(s,w,'bl'),cached=planRelay(s,w,'bl');
 expect(first.compute!.checked).toBeGreaterThan(0);expect(first.compute!.generated).toBeGreaterThanOrEqual(first.compute!.checked);expect(cached.compute!.cacheHits).toBeGreaterThan(0);expect(cached.compute!.checked).toBeLessThan(first.compute!.checked);expect(cached.actions.map(a=>a.boxId)).toEqual(first.actions.map(a=>a.boxId));
});
