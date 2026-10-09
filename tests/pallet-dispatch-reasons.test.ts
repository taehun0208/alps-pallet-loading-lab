import { describe,expect,it } from 'vitest';
import { streamInventory } from '../src/pallet/relay/streamInventory';
import { createStream,advanceStream } from '../src/pallet/relay/streamEngine';
import type { Placement } from '../src/pallet/types';

function fixture(height=100){
 const s=streamInventory(42,8),w=createStream(s),b=w.boxes[0];w.time=200;
 const p:Placement={id:b.observation.id,typeId:b.observation.typeId,position:{x:0,y:0,z:0},size:{w:200,d:200,h:height},weight:1,orientation:0,supports:[],supportRatio:1,loadAbove:0};
 b.status='placed';b.owner=0;w.cells[0].placements=[p];w.cells[0].version=1;w.stream!.cells[0].lastPlaced=200;
 // Keep unplaced stock on the belt and away from boundary crossings in these phase tests.
 for(const box of w.boxes.slice(1)){box.status='belt';box.flow={enteredAt:200,measuredAt:0,passes:0,lastReason:'fixture',checks:{}};}
 return {s,w};
}
describe('pallet departure explanations',()=>{
 it('labels final low-fill pallets as order completion and retains the reason in the archive',()=>{
  const {s,w}=fixture();w.boxes=w.boxes.slice(0,1);let next=advanceStream(s,w,[],201).world;
  expect(next.stream!.cells[0].dispatchReason).toBe('order-complete');
  next=advanceStream(s,next,[],204).world;next=advanceStream(s,next,[],213).world;
  expect(next.stream!.dispatched[0].dispatchReason).toBe('order-complete');expect(next.stream!.dispatched[0].placements[0].size.h).toBe(100);
  next=advanceStream(s,next,[],222).world;expect(next.stream!.cells[0].dispatchReason).toBeUndefined();expect(next.stream!.dispatched[0].dispatchReason).toBe('order-complete');
 });
 it('distinguishes the 96 percent height threshold from full volume',()=>{
  const {s,w}=fixture(1550),next=advanceStream(s,w,[],201).world;
  expect(next.stream!.cells[0].dispatchReason).toBe('height-limit');expect(next.stream!.cells[0].phase).toBe('checking');
 });
 it('labels a stale rejected-candidate set as bounded search exhaustion',()=>{
  const {s,w}=fixture();w.stream!.cells[0].lastPlaced=0;w.stream!.cells[0].rejected=w.boxes.slice(1).map(b=>b.observation.id);
  const next=advanceStream(s,w,[],201).world;expect(next.stream!.cells[0].dispatchReason).toBe('candidate-exhaustion');
 });
 it('keeps a low pallet open without completion or rejection evidence',()=>{
  const {s,w}=fixture(),next=advanceStream(s,w,[],201).world;
  expect(next.stream!.cells[0].phase).toBe('loading');expect(next.stream!.cells[0].dispatchReason).toBeUndefined();
 });
});
