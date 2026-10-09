import {it,expect} from 'vitest';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {applyStreamSettings,settingsChanged,streamSettings} from '../src/pallet/relay/streamSettings';
import {createStream,applyDecision,advanceStream} from '../src/pallet/relay/streamEngine';
import {frameClock} from '../src/pallet/relay/frameClock';
it('does not reverse simulation time when the first RAF timestamp predates effect initialization',()=>{
 const source=streamInventory(42,8);let world=createStream(source),last=1005;
 for(const now of [1000,1004,1016,1032,10032]){
  const frame=frameClock(now,last);expect(frame.last).toBeGreaterThanOrEqual(last);last=frame.last;
  expect(frame.delta).toBeGreaterThanOrEqual(0);expect(frame.delta).toBeLessThanOrEqual(.1);
  world=advanceStream(source,world,[],world.time+frame.delta*4).world;
 }
 expect(world.time).toBeCloseTo((.011+.016+.1)*4);
});
it('changes only the height, preserving custom packaging and the exact box set',()=>{
 const source=streamInventory(42,24);source.id='packaging-aware';source.constraints.gripper.height=205;
 const next=applyStreamSettings(source,{...streamSettings(source),height:1200});
 expect(source.pallet.maxHeight).toBe(1600);expect(next.pallet.maxHeight).toBe(1200);
 expect(next.types).toEqual(source.types);expect(next.constraints).toEqual(source.constraints);expect(next.id).toBe('packaging-aware');
 expect(settingsChanged(next,{...streamSettings(source),height:1200})).toBe(false);
});
it('restarts a finished run with fresh clocks, reservations, observations and worker identity',()=>{
 const source=streamInventory(42,8),old=createStream(source);old.stream!.complete=true;old.time=500;
 const next=applyStreamSettings(source,{...streamSettings(source),height:2000}),fresh=createStream(next);
 expect(fresh.runId).not.toBe(old.runId);expect(fresh.stream!.complete).toBe(false);expect(fresh.time).toBe(0);
 expect(applyDecision(next,fresh,[],{runId:old.runId,proposals:[],milliseconds:0,checks:0}).world).toBe(fresh);
 const running=advanceStream(next,fresh,[],1);expect(running.world.stream!.entered).toBe(1);
});
it('rejects invalid drafts without damaging the current simulation input',()=>{
 const source=streamInventory(42,8),copy=structuredClone(source);
 for(const height of [0,NaN,Infinity,599,2001,1200.5])expect(()=>applyStreamSettings(source,{seed:42,count:8,height})).toThrow();
 expect(source).toEqual(copy);
});

it('preserves the order while editing actual pallet dimensions and cargo limits',()=>{
 const source=streamInventory(42,24);
 const next=applyStreamSettings(source,{...streamSettings(source),width:1200,depth:800,deckHeight:144,maxLoadKg:600});
 expect(next.types).toEqual(source.types);expect(next.pallet).toEqual({width:1200,depth:800,maxHeight:1600,deckHeightMm:144,maxLoadKg:600});
 const cleared=applyStreamSettings(next,{...streamSettings(next),maxLoadKg:null,deckHeight:null});
 expect(cleared.pallet.maxLoadKg).toBeUndefined();expect(cleared.pallet.deckHeightMm).toBeUndefined();
 for(const patch of [{maxLoadKg:0},{maxLoadKg:NaN},{deckHeight:-1},{width:0},{depth:Infinity}])expect(()=>applyStreamSettings(next,{...streamSettings(next),...patch})).toThrow();
});
