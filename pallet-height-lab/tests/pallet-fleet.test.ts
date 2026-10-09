import {describe,it,expect} from 'vitest';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {fleet,withFleet,validateFleet,robotKind,gantryReach,robotObservation} from '../src/pallet/relay/fleet';
import {createStream,advanceStream,applyDecision,assertStreamInventory} from '../src/pallet/relay/streamEngine';
import {observedProblem,planStream} from '../src/pallet/relay/streamPlanner';
import {stationArc,loopLength,loopPoint} from '../src/pallet/relay/streamGeometry';
import {cellPose,toWorld,toLocal} from '../src/pallet/relay/layout';
import {beltBounds} from '../src/pallet/relay/conveyor';
import {inspectMotion} from '../src/pallet/relay/motion';
import {applyStreamSettings} from '../src/pallet/relay/streamSettings';
import {initialDashboardView} from '../src/pallet/relay/dashboardView';
import type {RobotLayout} from '../src/pallet/types';
function ready(count:number,architecture:RobotLayout['architecture']){
 const s=withFleet(streamInventory(42,8),{count,architecture,floorCount:Math.max(1,Math.floor(count/2))});s.types=s.types.slice(0,count);s.types.forEach(t=>{t.size={w:320,d:270,h:180};t.weight=3;t.maxLoadKg=100;t.handling=undefined;t.orientations=[0,90,'whd'];});
 const w=createStream(s);w.time=1000;w.stream!.inputClosed=true;w.boxes.forEach((b,i)=>{b.status='belt';b.flow={enteredAt:1000-(stationArc(i,s.pallet)-600)/w.stream!.speed,measuredAt:0,passes:0,lastReason:'',checks:{}};});return{s,w};
}
describe('configurable robot fleet',()=>{
 it('defaults to single, preserving bookmarked routes',()=>{expect(initialDashboardView('')).toBe('single');expect(initialDashboardView('?palletDemo=compact')).toBe('single');for(const v of ['relay','adaptive','simulate','packaging'])expect(initialDashboardView('?palletView='+v)).toBe(v);});
 it('rejects invalid counts and mixtures',()=>{for(const count of [0,9,2.5,NaN])expect(()=>validateFleet({count,architecture:'floor',floorCount:count})).toThrow();for(const floorCount of [0,4,NaN])expect(()=>validateFleet({count:4,architecture:'mixed',floorCount})).toThrow();expect(()=>validateFleet({count:1,architecture:'mixed',floorCount:1})).toThrow();});
 it('preserves the old default station locations',()=>{const p=streamInventory(42,8).pallet;expect(fleet(p)).toEqual({count:4,architecture:'floor',floorCount:4});expect([0,1,2,3].map(i=>cellPose(i,p).x)).toEqual([-6000,-2000,2000,6000]);});
 it('assigns every mixed robot one architecture with the requested count',()=>{for(const count of [2,3,4,8])for(let floorCount=1;floorCount<count;floorCount++){const p=withFleet(streamInventory(42,8),{count,architecture:'mixed',floorCount}).pallet;expect(Array.from({length:count},(_,i)=>robotKind(p,i)).filter(k=>k==='floor')).toHaveLength(floorCount);}});
 for(const count of [1,2,4,8])for(const architecture of ['floor','ceiling','mixed'] as const){if(count===1&&architecture==='mixed')continue;
  it(`reserves and completes ${count} ${architecture} robots together`,()=>{
   const {s,w}=ready(count,architecture);expect(w.cells).toHaveLength(count);expect(w.pads).toHaveLength(count);expect(w.stream!.cells).toHaveLength(count);expect(w.boxes.every(b=>b.forwardedAt.length===count)).toBe(true);
   const o=observedProblem(s,w),d=planStream(o.scenario,o.world),a=applyDecision(s,w,[],d);
   expect(d.commands).toHaveLength(count);expect(a.motions.map(m=>m.action.robot).sort((a,b)=>a-b)).toEqual(Array.from({length:count},(_,i)=>i));
   expect(new Set(a.motions.map(m=>m.action.boxId)).size).toBe(count);expect(assertStreamInventory(a.world,a.motions)).toBe(true);
   for(const m of a.motions){expect(inspectMotion(s,w,m.action)).toEqual([]);if(robotKind(s.pallet,m.action.robot)==='ceiling')expect([0,90]).toContain(m.action.candidate!.placement.orientation);}
   const done=advanceStream(s,a.world,a.motions,1000+Math.max(...a.motions.map(m=>m.action.seconds))+1);expect(done.world.records).toHaveLength(count);expect(assertStreamInventory(done.world,done.motions)).toBe(true);
   expect(applyDecision(s,createStream(s),[],d).motions).toHaveLength(0);
  },60000);
 }
 it('resizes conveyor and preserves coordinate round trips',()=>{for(const count of [1,2,4,8]){const {s}=ready(count,'floor'),p=s.pallet,b=beltBounds(p);expect(b.left).toBe(cellPose(0,p).x-1600);expect(b.right).toBe(cellPose(count-1,p).x+1600);expect(loopPoint(p,loopLength(p))).toEqual(loopPoint(p,0));for(let i=0;i<count;i++)expect(toLocal(toWorld({x:111,y:222,z:333},i,p),i,p)).toEqual({x:111,y:222,z:333});}});
 it('checks gantry workspace, tool axis and orientation',()=>{const {s,w}=ready(1,'ceiling'),n={x:0,y:0,z:1};expect(gantryReach(s.pallet,{x:900,y:500,z:1600},n,160)).toBe(true);expect(gantryReach(s.pallet,{x:5000,y:500,z:1600},n,160)).toBe(false);expect(gantryReach(s.pallet,{x:900,y:500,z:3350},n,160)).toBe(false);expect(gantryReach(s.pallet,{x:900,y:500,z:1000},{x:1,y:0,z:0},160)).toBe(false);expect(robotObservation(s.pallet,0,w.boxes[0].observation).orientationAllowed).toEqual([0,90]);});
 it('retains fleet through height and seed changes',()=>{const {s}=ready(4,'mixed');for(const seed of [42,43]){const n=applyStreamSettings(s,{seed,count:8,height:1800});expect(n.pallet.robotLayout).toEqual(s.pallet.robotLayout);expect(n.pallet.maxHeight).toBe(1800);}});
});
