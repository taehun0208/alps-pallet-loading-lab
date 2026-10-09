import {describe,it,expect} from 'vitest';
import {advanceQueue,footprint,stopArc,transportLength,usesRoller} from '../src/pallet/relay/rollerQueue';
import {createStream,advanceStream,applyDecision,assertStreamInventory} from '../src/pallet/relay/streamEngine';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {withFleet} from '../src/pallet/relay/fleet';
import {observedProblem,planStream} from '../src/pallet/relay/streamPlanner';
import {beltBounds} from '../src/pallet/relay/conveyor';
import {streamPosition} from '../src/pallet/relay/streamGeometry';
import {intakeSettings} from '../src/pallet/relay/intake';
import type {RelayMotion} from '../src/pallet/relay/types';
function scenario(n=8){const s=withFleet(streamInventory(42,n),{count:1,architecture:'floor'});s.pallet.conveyorMode='straight';return s;}
describe('single-cell roller FIFO accumulation',()=>{
 it('holds unequal boxes at a stop with a conservative 100 mm gap without mutation',()=>{
  const stock=[{id:'A',arc:2500,length:800,held:true},{id:'B',arc:1700,length:400},{id:'C',arc:700,length:900}],copy=structuredClone(stock);
  const next=advanceQueue(stock,3000,2000);expect(stock).toEqual(copy);expect(next.map(b=>b.id)).toEqual(['A','B','C']);
  expect(next[0].arc).toBe(2500);expect(next[1].arc).toBe(1800);expect(next[2].arc).toBe(1050);
  expect(()=>advanceQueue([{id:'A',arc:1000,length:500},{id:'B',arc:950,length:500}],2000,1)).toThrow('overlap');
 });
 it('shifts followers after removal while preserving FIFO and counts',()=>{
  const q=advanceQueue([{id:'B',arc:1800,length:400},{id:'C',arc:1050,length:900}],3000,5000);
  expect(q.map(b=>b.id)).toEqual(['B','C']);expect(q[0].arc).toBe(2800);expect(q[1].arc).toBe(2050);
 });
 it('joins the belt to the roller and stops upstream release when the lane fills',()=>{
  const s=scenario(30);let w=createStream(s);expect(usesRoller(s.pallet)).toBe(true);
  for(let t=.1;t<300;t+=.5)w=advanceStream(s,w,[],t).world;
  const boxes=w.boxes.filter(b=>b.status==='belt').sort((a,b)=>b.flow!.roller!.arc-a.flow!.roller!.arc);
  expect(w.boxes.some(b=>b.status==='pending')).toBe(true);expect(w.boxes.some(b=>b.status==='outfeed')).toBe(false);
  expect(boxes[0].flow!.roller!.arc).toBeCloseTo(stopArc(boxes[0],s.pallet));
  for(let i=1;i<boxes.length;i++){const gap=boxes[i-1].flow!.roller!.arc-boxes[i].flow!.roller!.arc-(footprint(boxes[i-1])+footprint(boxes[i]))/2;expect(gap).toBeGreaterThanOrEqual(100-1e-7);}
  const b=boxes[0],pt=streamPosition(b,w.time,w.stream!.speed,s.pallet);expect(pt.x).toBeGreaterThan(beltBounds(s.pallet).right);expect(pt.z).toBeLessThan(450);expect(transportLength(s.pallet)).toBeGreaterThan(beltBounds(s.pallet).right-beltBounds(s.pallet).left);
 });
 it('uses FIFO stationary pickup, clears only after lift, and conserves non-overlapping normal placements',()=>{
  const s=scenario(8);s.types.forEach(t=>{t.size={w:320,d:270,h:180};t.weight=3;t.maxLoadKg=100;t.handling=undefined;t.orientations=[0,90];});let w=createStream(s),motions:RelayMotion[]=[];const picks:string[]=[];
  for(let t=.1;t<500;t+=.5){({world:w,motions}=advanceStream(s,w,motions,t));const obs=observedProblem(s,w),d=planStream(obs.scenario,obs.world,motions.map(m=>m.action.robot));const before=new Set(motions.map(m=>m.action.boxId));({world:w,motions}=applyDecision(s,w,motions,d));
   for(const m of motions.filter(m=>!before.has(m.action.boxId))){picks.push(m.action.boxId);const box=w.boxes.find(b=>b.observation.id===m.action.boxId)!;expect(streamPosition(box,m.started,w.stream!.speed,s.pallet)).toEqual(streamPosition(box,m.action.tracking!.graspAt,w.stream!.speed,s.pallet));}
   assertStreamInventory(w,motions);if(w.stream!.complete)break;
  }
  expect(picks).toEqual(w.boxes.map(b=>b.observation.id));expect(w.records).toHaveLength(8);expect(w.boxes.every(b=>b.status==='placed')).toBe(true);
 },120000);
 it('scans before entering the roller and keeps damaged boxes on the existing quarantine route',()=>{
  const s=scenario(8);s.intake=intakeSettings(1);let w=createStream(s);for(let t=.1;t<180;t+=.5)w=advanceStream(s,w,[],t).world;
  expect(w.boxes.every(b=>b.status==='quarantined')).toBe(true);expect(w.stream!.measured).toBe(8);expect(w.records).toHaveLength(0);
 });
 it('bounds failed head retries and does not call unsupported freight a successful placement',()=>{
  const s=scenario(8);s.types.forEach(t=>{t.weight=100;});let w=createStream(s);
  for(let time=1;time<1000;time++){
   w=advanceStream(s,w,[],time).world;const o=observedProblem(s,w),d=planStream(o.scenario,o.world);const r=applyDecision(s,w,[],d);w=r.world;expect(r.motions).toHaveLength(0);assertStreamInventory(w,[]);if(w.stream!.complete)break;
  }
  expect(w.stream!.complete).toBe(true);expect(w.records).toHaveLength(0);expect(w.boxes.every(b=>b.status==='outfeed')).toBe(true);expect(w.boxes.every(b=>b.flow!.lastReason.includes('빈 팔레트에도 배치 불가'))).toBe(true);
 },120000);
 it('leaves the multi-robot looping configuration untouched',()=>{const s=streamInventory(42,8);expect(usesRoller(s.pallet)).toBe(false);expect(createStream(s).stream!.speed).toBe(210);});
});
