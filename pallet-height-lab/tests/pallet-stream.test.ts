import {describe,it,expect} from 'vitest';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {createStream,advanceStream,applyDecision,assertStreamInventory} from '../src/pallet/relay/streamEngine';
import {observedProblem,planStream} from '../src/pallet/relay/streamPlanner';
import {streamPosition,boxRadius,stationArc} from '../src/pallet/relay/streamGeometry';
import {toWorld} from '../src/pallet/relay/layout';
import {top,intersects} from '../src/pallet/geometry';
import type {RelayMotion} from '../src/pallet/relay/types';

describe('continuous conveyor',()=>{
 it('generates reproducible individual dimensions with varied material, weight and proportions',()=>{
  const a=streamInventory(821,96),b=streamInventory(821,96),c=streamInventory(822,96);
  expect(a.types).toEqual(b.types);expect(a.types).not.toEqual(c.types);
  expect(new Set(a.types.map(t=>JSON.stringify(t.size))).size).toBe(96);
  expect(new Set(a.types.map(t=>t.material)).size).toBe(3);
  expect(a.types.every(t=>t.quantity===1)).toBe(true);
  expect(Math.max(...a.types.map(t=>t.size.w/t.size.d))).toBeGreaterThan(3);
 });
 it('withholds future boxes from planning and scans while the belt moves',()=>{
  const s=streamInventory(42,8);let w=createStream(s);w=advanceStream(s,w,[],.1).world;
  expect(observedProblem(s,w).world.boxes).toHaveLength(0);
  const before=streamPosition(w.boxes[0],.1,w.stream!.speed,s.pallet);
  w=advanceStream(s,w,[],4).world;
  expect(streamPosition(w.boxes[0],4,w.stream!.speed,s.pallet).x).toBeGreaterThan(before.x);
  expect(observedProblem(s,w).world.boxes).toHaveLength(1);
  expect(observedProblem(s,w).scenario.types).toHaveLength(1);
  expect(w.boxes.some(b=>b.status==='pending')).toBe(true);
 });
 it('runs overlapping infeed and four independent robots with interception and conserved stock',()=>{
  const s=streamInventory(42,24);let w=createStream(s),motions:RelayMotion[]=[],peak=0,overlap=false,picked=0;
  for(let time=.25;time<600;time+=.5){
   ({world:w,motions}=advanceStream(s,w,motions,time));
   const observed=observedProblem(s,w),d=planStream(observed.scenario,observed.world,motions.map(m=>m.action.robot));
   const prior=new Set(motions.map(m=>m.action.boxId));({world:w,motions}=applyDecision(s,w,motions,d));
   for(const m of motions.filter(m=>!prior.has(m.action.boxId))){
    picked++;const b=w.boxes.find(b=>b.observation.id===m.action.boxId)!;
    const actual=streamPosition(b,m.action.tracking!.graspAt,w.stream!.speed,s.pallet);
    const pickup=toWorld({...m.action.pickup!,x:m.action.pickup!.x+b.observation.size.w/2,y:m.action.pickup!.y+b.observation.size.d/2},m.action.robot,s.pallet);
    expect(Math.hypot(actual.x-pickup.x,actual.y-pickup.y)).toBeLessThan(1);
   }
   const belt=w.boxes.filter(b=>b.status==='belt');
   for(let i=0;i<belt.length;i++)for(let j=i+1;j<belt.length;j++){
    const a=streamPosition(belt[i],time,w.stream!.speed,s.pallet),b=streamPosition(belt[j],time,w.stream!.speed,s.pallet);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThan(boxRadius(belt[i])+boxRadius(belt[j]));
   }
   peak=Math.max(peak,motions.length);if(motions.length&&w.boxes.some(b=>b.status==='pending'))overlap=true;
   assertStreamInventory(w,motions);
   if(w.stream!.complete)break;
  }
  expect(picked).toBeGreaterThan(12);expect(peak).toBeGreaterThanOrEqual(2);expect(overlap).toBe(true);
  for(const cell of [...w.cells,...w.stream!.dispatched])for(const p of cell.placements){
   expect(top(p)).toBeLessThanOrEqual(s.pallet.maxHeight);expect(p.supportRatio).toBeGreaterThanOrEqual(.92-1e-8);
   expect(cell.placements.some(q=>q.id!==p.id&&intersects(p,q))).toBe(false);
  }
 },120000);
 it('reserves four arriving boxes simultaneously and rejects duplicate or stale decisions',()=>{
  const s=streamInventory(42,8);s.types.forEach(t=>{t.size={w:320,d:270,h:180};t.weight=3;t.maxLoadKg=100;t.handling=undefined;t.orientations=[0,90];});
  s.types=s.types.slice(0,4);const w=createStream(s);w.time=100;w.stream!.inputClosed=true;
  w.boxes.slice(0,4).forEach((b,i)=>{b.status='belt';b.flow={enteredAt:100-(stationArc(i,s.pallet)-600)/w.stream!.speed,measuredAt:0,passes:0,lastReason:'',checks:{}};});
  const observed=observedProblem(s,w),d=planStream(observed.scenario,observed.world),result=applyDecision(s,w,[],d);
  expect(result.motions).toHaveLength(4);expect(new Set(result.motions.map(m=>m.action.boxId)).size).toBe(4);
  expect(applyDecision(s,result.world,result.motions,d).motions).toHaveLength(4);
  expect(applyDecision(s,createStream(s),[],d).motions).toHaveLength(0);
  assertStreamInventory(result.world,result.motions);
 });
 it('leaves infeasible boxes on the moving belt, including after a complete lap',()=>{
  const s=streamInventory(5,8);s.types.forEach(t=>t.weight=100);
  let w=createStream(s);
  for(let time=1;time<=200;time++){
   w=advanceStream(s,w,[],time).world;const observed=observedProblem(s,w);
   const result=applyDecision(s,w,[],planStream(observed.scenario,observed.world));w=result.world;
   expect(result.motions).toHaveLength(0);
  }
  expect(w.stream!.passes).toBeGreaterThan(0);expect(w.stream!.complete).toBe(false);expect(w.records).toHaveLength(0);
  expect(w.boxes.every(b=>b.status==='belt')).toBe(true);
 });
});
