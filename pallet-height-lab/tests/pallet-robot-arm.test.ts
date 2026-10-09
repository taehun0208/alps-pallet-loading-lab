import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { solveRobotArm,armDistance,armSegmentHitsBox,armInterference,DEFAULT_ROBOT_ARM } from '../src/pallet/robotArm';
import { ALL_ORIENTATIONS,poseVector } from '../src/pallet/orientations';
import { poseQuaternion } from '../src/pallet/poseRendering';
import { gripperPath } from '../src/pallet/constraints';
import { pathPosition } from '../src/pallet/PalletScene';
import { virtualObservation } from '../src/pallet/remainingSites';
import type { Placement,Scenario } from '../src/pallet/types';

it('follows every box pose at the real tool tip, keeping both links and the wrist adapter fixed',()=>{
 for(const orientation of ALL_ORIENTATIONS)for(const target of [{x:-650,y:350,z:150},{x:800,y:700,z:1600},{x:50,y:200,z:2500}]){
  const normal=poseVector({x:0,y:0,z:1},orientation),p=solveRobotArm(target,normal,160);
  expect(p.reachable).toBe(true);expect(p.errorMm).toBeLessThan(1e-6);
  expect(armDistance(p.shoulder,p.elbow)).toBeCloseTo(DEFAULT_ROBOT_ARM.upperArm,8);expect(armDistance(p.elbow,p.wrist)).toBeCloseTo(DEFAULT_ROBOT_ARM.forearm,8);expect(armDistance(p.wrist,p.flange)).toBeCloseTo(120,8);expect(armDistance(p.flange,p.tcp)).toBeCloseTo(160,8);
 }
});

it('reports an unreachable target without lengthening the arm or claiming the displayed endpoint reached it',()=>{
 const p=solveRobotArm({x:8000,y:1000,z:1000},{x:0,y:0,z:1},160);expect(p.reachable).toBe(false);expect(p.errorMm).toBeGreaterThan(5000);expect(armDistance(p.shoulder,p.elbow)).toBeCloseTo(1600);expect(armDistance(p.elbow,p.wrist)).toBeCloseTo(1600);expect(p.tcp).not.toEqual(p.target);
});

it('handles vertical and coincident wrist targets and unequal-link inner reach limits without NaN',()=>{
 for(const target of [{x:-900,y:-450,z:370},{x:-900,y:-450,z:1800}]){const p=solveRobotArm(target,{x:0,y:0,z:1},160);expect(Object.values(p.elbow).every(Number.isFinite)).toBe(true);expect(armDistance(p.shoulder,p.elbow)).toBeCloseTo(1600);expect(armDistance(p.elbow,p.wrist)).toBeCloseTo(1600);}
 const p=solveRobotArm({x:-900,y:-450,z:370},{x:0,y:0,z:1},160,{...DEFAULT_ROBOT_ARM,forearm:500});expect(p.reachable).toBe(false);expect(p.errorMm).toBeCloseTo(1100,4);
});

it('flags a link crossing a box, including its radius, while clearing a separated parallel link',()=>{
 const b={position:{x:0,y:0,z:0},size:{w:100,d:100,h:100}};
 expect(armSegmentHitsBox({x:-100,y:50,z:50},{x:200,y:50,z:50},b,10)).toBe(true);
 expect(armSegmentHitsBox({x:-100,y:108,z:50},{x:200,y:108,z:50},b,10)).toBe(true);
 expect(armSegmentHitsBox({x:-100,y:130,z:50},{x:200,y:130,z:50},b,10)).toBe(false);
 const p=solveRobotArm({x:500,y:500,z:500},{x:0,y:0,z:1},160),center={x:(p.shoulder.x+p.elbow.x)/2,y:(p.shoulder.y+p.elbow.y)/2,z:(p.shoulder.z+p.elbow.z)/2},block={...b,id:'obstacle',position:center} as Placement;
 expect(armInterference(p,[block])).toContain('obstacle');
});

it('tracks the recorded 16-box mixed run through pickup, standing rotation, placement and return without altering geometry',()=>{
 const data=JSON.parse(readFileSync('docs/pallet-interior-measurements.json','utf8')),r=data.results.find((r:any)=>r.seed===20261004).variants.find((v:any)=>v.name==='interior-six-poses'),s=r.scenario as Scenario,placed:Placement[]=[];let points=0,maxError=0;
 for(const b of r.placements as Placement[]){const type=s.types.find(t=>t.id===b.typeId)!,current=virtualObservation(type,b.id),path=gripperPath(b,current,placed,s.constraints);let seconds=0;
  for(const segment of path.segmentSeconds){for(const fraction of [0,.25,.5,.75,1]){const sample=pathPosition(path,(seconds+fraction*segment)/path.seconds),q=poseQuaternion(sample.fromPose).slerp(poseQuaternion(sample.toPose),sample.blend),n=new Vector3(0,1,0).applyQuaternion(q),arm=solveRobotArm(sample.tcp,{x:n.x,y:n.z,z:n.y},s.constraints.gripper.height);expect(arm.reachable).toBe(true);maxError=Math.max(maxError,arm.errorMm);points++;}seconds+=segment;}
  placed.push(b);
 }
 expect(points).toBeGreaterThan(500);expect(maxError).toBeLessThan(1e-6);expect(placed).toEqual(r.placements);
});
