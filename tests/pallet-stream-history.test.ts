import { describe,expect,it } from 'vitest';
import { initializeStreamHistory,captureStreamHistory,HISTORY_LIMIT } from '../src/pallet/relay/streamHistory';
import { createStream,advanceStream } from '../src/pallet/relay/streamEngine';
import { streamInventory } from '../src/pallet/relay/streamInventory';
import type { RelayMotion } from '../src/pallet/relay/types';

describe('semantic stream history',()=>{
 it('retains immutable old worlds through engine time transitions',()=>{
  const s=streamInventory(42,8),initial=initializeStreamHistory(createStream(s)),before=structuredClone(initial.history[0]);
  const next=advanceStream(s,initial.world,[],1),captured=captureStreamHistory({...initial,...next});
  expect(captured.history).toHaveLength(2);expect(initial.history).toHaveLength(1);
  expect(initial.history[0]).toEqual(before);expect(captured.history[1].world.time).toBe(1);
  const after=advanceStream(s,captured.world,[],1.01);
  expect(captureStreamHistory({...captured,...after}).history).toBe(captured.history);
  expect(captured.history[1].world.time).toBe(1);
 });
 it('records a measured decision even when assignment and revision are unchanged',()=>{
  const s=streamInventory(42,8),initial=initializeStreamHistory(createStream(s));
  const timed={...initial,world:{...initial.world,time:2.5},ms:121,checks:4};
  expect(captureStreamHistory(timed)).toBe(timed);
  const captured=captureStreamHistory(timed,true),event=captured.history.at(-1)!;
  expect(event.event).toBe('decision');expect(event.decisionMilliseconds).toBe(121);expect(event.world.time).toBe(2.5);
  expect(initial.history[0].decisionMilliseconds).toBeUndefined();
 });
 it('preserves exact reserved motion elapsed and progress rather than reconstructing it from a later clock',()=>{
  const s=streamInventory(42,8),world=createStream(s),box=world.boxes[0];
  box.status='reserved';box.owner=0;box.flow={enteredAt:0,measuredAt:0,passes:0,lastReason:'fixture',checks:{}};
  // This fixture remains in motion; commit geometry is intentionally not exercised here.
  const motion={action:{boxId:box.observation.id,robot:0,seconds:100,tracking:{graspAt:1}},started:0,elapsed:2,progress:.02} as RelayMotion;
  world.time=2;const initial={...initializeStreamHistory(world),motions:[motion]};
  const at2=captureStreamHistory(initial,true),at7=advanceStream(s,world,[motion],7),later=captureStreamHistory({...at2,...at7},true);
  expect(at2.history.at(-1)!.motions[0].elapsed).toBe(2);expect(at2.history.at(-1)!.motions[0].progress).toBe(.02);
  expect(later.history.at(-1)!.motions[0].elapsed).toBe(7);expect(later.history.at(-1)!.motions[0].progress).toBe(.07);
  expect(at2.history.at(-1)!.world.boxes[0].status).toBe('reserved');
 });
 it('captures changed soft assignments without revision and bounds the retained frame count',()=>{
  const s=streamInventory(42,8),initial=initializeStreamHistory(createStream(s)),world=structuredClone(initial.world);
  world.stream!.orchestration={mode:'central',at:0,observedBoxes:1,evaluatedBids:1,assignments:[{boxId:'A',robot:2,launchNow:false,score:10,reason:'test',bids:[]}]};
  expect(captureStreamHistory({...initial,world}).history).toHaveLength(2);
  let state=initial;for(let i=1;i<=HISTORY_LIMIT+10;i++)state=captureStreamHistory({...state,world:{...state.world,time:i},ms:i},true);
  expect(state.history).toHaveLength(HISTORY_LIMIT);expect(state.history[0].world.time).toBe(11);expect(state.history.at(-1)!.world.time).toBe(HISTORY_LIMIT+10);
  expect(initial.history).toHaveLength(1);
 });
});
