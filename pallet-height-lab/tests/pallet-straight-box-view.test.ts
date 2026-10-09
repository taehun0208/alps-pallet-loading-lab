import {describe,it,expect} from 'vitest';
import {isSingleStraight,onBeltDisplay,transportDisplay,exitDisplayCenter} from '../src/pallet/relay/straightBoxView';
import {beltBounds,CONVEYOR} from '../src/pallet/relay/conveyor';
import {createStream} from '../src/pallet/relay/streamEngine';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import type {RelayMotion} from '../src/pallet/relay/types';
import {withFleet} from '../src/pallet/relay/fleet';
describe('one-arm straight conveyor rendering',()=>{
 const scenario=()=>{const s=withFleet(streamInventory(42,8),{count:1,architecture:'floor',floorCount:1});s.pallet.conveyorMode='straight';s.pallet.conveyorExtensionMm=1500;return s;};
 it('a fixed 550 mm exit centre overlaps wide cartons; the corrected centre leaves 100 mm clearance',()=>{
  const s=scenario(),w=createStream(s),incoming=w.boxes[0],waiting=w.boxes[1];
  incoming.observation.size={w:900,d:500,h:300};waiting.observation.size={w:800,d:400,h:200};
  const end=beltBounds(s.pallet).right;
  expect(end+550-waiting.observation.size.w/2).toBeLessThan(end+incoming.observation.size.w/2);
  const p=exitDisplayCenter(s.pallet,waiting.observation.size,w.boxes);
  expect(p.x-waiting.observation.size.w/2-(end+incoming.observation.size.w/2)).toBeGreaterThanOrEqual(100);
  expect(p.y).toBe(CONVEYOR.front);expect(p.z-waiting.observation.size.h/2).toBe(CONVEYOR.deck);
 });
 it('reserving or completing a box immediately removes its old belt representation',()=>{
  const b=createStream(scenario()).boxes[0];
  for(const status of ['pending','reserved','placed','outfeed','quarantined'] as const){b.status=status;expect(onBeltDisplay(b)).toBe(false);}
  for(const status of ['belt','rejecting'] as const){b.status=status;expect(onBeltDisplay(b)).toBe(true);}
 });
 it('restricts the fix to one-robot straight mode and preserves the other mode selection',()=>{
  const s=scenario();expect(isSingleStraight(s.pallet)).toBe(true);
  s.pallet.conveyorMode='loop';expect(isSingleStraight(s.pallet)).toBe(false);
  s.pallet.conveyorMode='straight';s.pallet.robotLayout!.count=4;expect(isSingleStraight(s.pallet)).toBe(false);
 });
 it('shows only the current reserved actor through asynchronous completion and next-box transitions',()=>{
  const w=createStream(scenario()),b=w.boxes[0],other=w.boxes[1];
  const motion={action:{boxId:b.observation.id}} as RelayMotion;
  b.status='reserved';expect(transportDisplay(b,[motion])).toBe(true);expect(onBeltDisplay(b)).toBe(false);
  b.status='placed';expect(transportDisplay(b,[motion])).toBe(false);expect(transportDisplay(b,[])).toBe(false);
  other.status='reserved';const next={action:{boxId:other.observation.id}} as RelayMotion;
  expect(transportDisplay(b,[next])).toBe(false);expect(transportDisplay(other,[next])).toBe(true);
  expect(transportDisplay(undefined,[next])).toBe(false);
 });
 it('never changes box IDs, states, pallet or planning geometry',()=>{
  const s=scenario(),w=createStream(s),before=structuredClone({s,w});
  exitDisplayCenter(s.pallet,w.boxes[0].observation.size,w.boxes);
  expect({s,w}).toEqual(before);
 });
});
