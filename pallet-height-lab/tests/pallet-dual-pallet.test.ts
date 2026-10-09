import { describe, it, expect } from 'vitest';
import { Box3 } from 'three';
import { withFleet } from '../src/pallet/relay/fleet';
import { streamInventory } from '../src/pallet/relay/streamInventory';
import { createStream, advanceStream, applyDecision, assertStreamInventory } from '../src/pallet/relay/streamEngine';
import { observedProblem, planStream } from '../src/pallet/relay/streamPlanner';
import { allPallets, palletToWorld, worldToPallet } from '../src/pallet/relay/palletStations';
import { scanBox } from '../src/pallet/relay/intake';
import { BRANCH, branchPosition, forkArc } from '../src/pallet/relay/branchedConveyor';
import { createBranchedConveyorView } from '../src/pallet/relay/BranchedConveyorView';
import { tailGeometry, tailPoint, mainPoint } from '../src/pallet/relay/conveyorTail';
import { beltBounds } from '../src/pallet/relay/conveyor';
import type { RelayMotion } from '../src/pallet/relay/types';
import { intersects } from '../src/pallet/geometry';

function fixture(count=4) {
 const s=withFleet(streamInventory(42,8),{count,architecture:'floor',floorCount:count});
 s.pallet.conveyorMode='branched';s.pallet.palletsPerRobot=2;s.intake={damageRate:0,thresholdMm:8};
 s.types.forEach(t=>{t.size={w:320,d:270,h:180};t.weight=4;t.maxLoadKg=100;t.handling=undefined;t.orientations=[0,90];});return s;
}
function ready(s:ReturnType<typeof fixture>,robot=0){
 const w=createStream(s);w.time=100;w.stream!.inputClosed=true;
 w.boxes.forEach((b,i)=>{b.status=i===0?'belt':'outfeed';if(i)return;b.flow={enteredAt:0,measuredAt:90,passes:0,lastReason:'',checks:{},transport:{kind:'branch',robot,arc:BRANCH.length,limit:BRANCH.length,at:100,attempts:0}};b.scan=scanBox(b,90,s);});return w;
}
describe('two independent pallets per arm',()=>{
 it('creates eight pallets with four arms and round-trips each independent coordinate frame',()=>{
  const s=fixture(),w=createStream(s);expect(w.cells).toHaveLength(4);expect(allPallets(w)).toHaveLength(8);
  w.secondaryCells![0].version=7;expect(w.cells[0].version).toBe(0);
  for(const v of allPallets(w)){const point={x:37,y:93,z:180};expect(worldToPallet(palletToWorld(point,v.robot,s.pallet,v.pallet),v.robot,s.pallet,v.pallet)).toEqual(point);}
 });
 it('selects and commits to P2 while P1 is being replaced, keeping one job per robot',()=>{
  const s=fixture(),w=ready(s);w.stream!.cells[0].phase='outbound';
  const o=observedProblem(s,w),d=planStream(o.scenario,o.world),r=applyDecision(s,w,[],d);
  expect(r.motions).toHaveLength(1);expect(r.motions[0].action.pallet).toBe(1);expect(r.motions[0].action.robot).toBe(0);
  const final=advanceStream(s,r.world,r.motions,100+r.motions[0].action.seconds+.01);
  expect(final.world.cells[0].placements).toHaveLength(0);expect(final.world.secondaryCells![0].placements).toHaveLength(1);
  expect(final.world.records[0].pallet).toBe(1);assertStreamInventory(final.world,final.motions);
 });
 it('chooses the other valid pallet after the first pallet reaches its height limit',()=>{
  const s=fixture(1);s.pallet.width=400;s.pallet.depth=350;s.pallet.maxHeight=180;
  let w=ready(s),o=observedProblem(s,w),r=applyDecision(s,w,[],planStream(o.scenario,o.world));
  expect(r.motions).toHaveLength(1);const first=r.motions[0].action.pallet??0;
  ({world:w}=advanceStream(s,r.world,r.motions,100+r.motions[0].action.seconds+.01));
  // Keep the completed pallet loaded for comparison; its automatic replacement may have started.
  w.stream!.cells[0].phase='loading';w.stream!.secondaryCells![0].phase='loading';
  const b=w.boxes[1];b.status='belt';b.flow={...w.boxes[0].flow!,checks:{},transport:{kind:'branch',robot:0,arc:BRANCH.length,limit:BRANCH.length,at:w.time,attempts:0}};b.scan=scanBox(b,w.time,s);
  o=observedProblem(s,w);r=applyDecision(s,w,[],planStream(o.scenario,o.world));
  expect(r.motions).toHaveLength(1);expect(r.motions[0].action.pallet).toBe(1-first);
 });
 it('runs four arms concurrently, never treating eight pallets as eight arms',()=>{
  const s=fixture(),w=ready(s);for(let i=1;i<4;i++){const b=w.boxes[i];b.status='belt';b.flow=structuredClone(w.boxes[0].flow!);b.flow.transport!.robot=i;b.scan=scanBox(b,90,s);}
  const o=observedProblem(s,w),r=applyDecision(s,w,[],planStream(o.scenario,o.world));
  expect(r.motions).toHaveLength(4);expect(new Set(r.motions.map(m=>m.action.robot)).size).toBe(4);assertStreamInventory(r.world,r.motions);
 });
 it('keeps a single straight roller robot running with two independently loaded pallets',()=>{
  const s=withFleet(streamInventory(17,16),{count:1,architecture:'floor',floorCount:1});s.pallet.conveyorMode='straight';s.pallet.palletsPerRobot=2;s.intake={damageRate:0,thresholdMm:8};
  let w=createStream(s),motions:RelayMotion[]=[];
  for(let time=.5;time<1600;time+=1){({world:w,motions}=advanceStream(s,w,motions,time));const o=observedProblem(s,w);({world:w,motions}=applyDecision(s,w,motions,planStream(o.scenario,o.world,motions.map(m=>m.action.robot))));expect(motions.length).toBeLessThanOrEqual(1);assertStreamInventory(w,motions);if(w.stream!.complete)break;}
  expect(w.stream!.complete).toBe(true);expect(new Set(w.records.map(r=>r.pallet)).size).toBe(2);
 },120000);
 it('keeps mixed arrivals, both pallet histories and damaged stock conserved through completion',()=>{
  const s=withFleet(streamInventory(82,24),{count:4,architecture:'floor',floorCount:4});s.pallet.conveyorMode='branched';s.pallet.palletsPerRobot=2;s.intake={damageRate:.35,thresholdMm:8};let w=createStream(s),motions:RelayMotion[]=[];
  for(let time=.5;time<1600;time+=1){({world:w,motions}=advanceStream(s,w,motions,time));const o=observedProblem(s,w);({world:w,motions}=applyDecision(s,w,motions,planStream(o.scenario,o.world,motions.map(m=>m.action.robot))));assertStreamInventory(w,motions);if(w.stream!.complete)break;}
  expect(w.stream!.complete).toBe(true);expect(w.boxes.some(b=>b.status==='placed')).toBe(true);expect(w.boxes.some(b=>b.status==='quarantined')).toBe(true);
  for(const cell of [...allPallets(w).map(v=>v.cell),...w.stream!.dispatched])for(const p of cell.placements)expect(cell.placements.some(q=>q.id!==p.id&&intersects(p,q))).toBe(false);
 },120000);
});
describe('rounded conveyor tail',()=>{
 it('removes the last direct fork in both rendering and assigned carton movement',()=>{
  const s=fixture(),g=tailGeometry(s.pallet),end=tailGeometry(s.pallet).right-beltBounds(s.pallet).left+g.length;
  expect(forkArc(3,s.pallet)).toBe(end);expect(forkArc(2,s.pallet)).toBeLessThan(end-g.length);
  const view=createBranchedConveyorView(s.pallet),last=view.group.getObjectByName('sub-blue-conveyor-4')!;
  const bounds=new Box3().setFromObject(last);
  expect(bounds.min.z).toBeCloseTo(-.5);expect(bounds.max.z).toBeCloseTo(-.05);
  expect(view.group.children.filter(c=>c.name==='rounded-end-to-last-sub')).toHaveLength(1);
  const w=ready(s),b=w.boxes[0],oldFork=g.x-beltBounds(s.pallet).left;
  b.flow!.transport={kind:'main',robot:3,arc:oldFork-1,limit:oldFork-1,at:100,attempts:0};
  let current=advanceStream(s,w,[],100.1).world;
  expect(current.boxes[0].flow!.transport!.kind).toBe('main');
  let previous=branchPosition(current.boxes[0],100.1,210,s.pallet);
  for(let time=100.2;time<180;time+=.1){current=advanceStream(s,current,[],time).world;const next=current.boxes[0],point=branchPosition(next,time,210,s.pallet);expect(Math.hypot(point.x-previous.x,point.y-previous.y)).toBeLessThanOrEqual(21.01);previous=point;if(next.flow!.transport!.kind==='branch')break;}
  expect(current.boxes[0].flow!.transport!.kind).toBe('branch');expect(current.boxes[0].flow!.transport!.robot).toBe(3);
  expect(current.boxes[0].flow!.transport!.arc).toBe(BRANCH.length);
 });
 it('has continuous position and tangents from main end to only the final sub-line head',()=>{
  const p=fixture().pallet,g=tailGeometry(p),length=g.right-beltBounds(p).left;
  expect(mainPoint(p,length)).toEqual(tailPoint(p,0));expect(g.robot).toBe(3);
  expect(tailPoint(p,0).y).toBe(-2500);expect(tailPoint(p,g.length).x).toBeCloseTo(g.x);expect(tailPoint(p,g.length).y).toBeCloseTo(-500);
  expect(tailPoint(p,1).x).toBeGreaterThan(tailPoint(p,0).x);expect(tailPoint(p,g.length).y).toBeGreaterThan(tailPoint(p,g.length-1).y);
  for(let arc=1;arc<g.length;arc+=10){const a=tailPoint(p,arc),b=tailPoint(p,arc+10);expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThanOrEqual(10.001);expect(b.x).toBeGreaterThanOrEqual(a.x-1e-6);expect(b.y).toBeGreaterThanOrEqual(a.y-1e-6);expect(b.x).toBeLessThanOrEqual(g.x+1e-6);}
  expect(g.right).toBe(g.x-g.radius);expect(g.length).toBeLessThan(2500);
 });
 it('moves a bypassed carton continuously into the last sub-line instead of dropping it at the end',()=>{
  const s=fixture(),w=ready(s),b=w.boxes[0],length=tailGeometry(s.pallet).right-beltBounds(s.pallet).left;
  b.flow!.transport={kind:'main',arc:length-1,limit:length-1,at:100,attempts:0,bypass:true};b.owner=-1;
  let current=w,previous=branchPosition(b,100,210,s.pallet);
  for(let time=100.1;time<150;time+=.1){current=advanceStream(s,current,[],time).world;const next=current.boxes[0],point=branchPosition(next,time,210,s.pallet);expect(Math.hypot(point.x-previous.x,point.y-previous.y)).toBeLessThanOrEqual(21.01);expect(next.status).toBe('belt');previous=point;if(next.flow!.transport!.kind==='branch')break;}
  expect(current.boxes[0].flow!.transport!.kind).toBe('branch');expect(current.boxes[0].flow!.transport!.robot).toBe(3);
 });
 it('backs up the rounded tail while the last sub-line head is occupied without overlapping cartons',()=>{
  const s=fixture(),w=ready(s,3),g=tailGeometry(s.pallet),length=tailGeometry(s.pallet).right-beltBounds(s.pallet).left,b=w.boxes[1];
  b.status='belt';b.flow={enteredAt:0,measuredAt:90,passes:0,lastReason:'',checks:{},transport:{kind:'main',arc:length+g.length-1200,limit:length+g.length,at:100,attempts:0,bypass:true}};b.scan=scanBox(b,90,s);
  let current=w;
  for(let time=100.1;time<115;time+=.1){current=advanceStream(s,current,[],time).world;const a=branchPosition(current.boxes[0],time,210,s.pallet),c=branchPosition(current.boxes[1],time,210,s.pallet);expect(Math.hypot(a.x-c.x,a.y-c.y)).toBeGreaterThanOrEqual(Math.hypot(320,270)+BRANCH.gap-1e-5);}
  expect(current.boxes[1].flow!.transport!.kind).toBe('main');expect(current.boxes[1].status).toBe('belt');
 });
});
