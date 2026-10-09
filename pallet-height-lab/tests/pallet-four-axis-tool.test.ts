import {it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {uprightToolQuaternion,poseQuaternion} from '../src/pallet/poseRendering';
import {robotObservation,robotReach,withFleet} from '../src/pallet/relay/fleet';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {createStream} from '../src/pallet/relay/streamEngine';
import {createRobotArmView} from '../src/pallet/RobotArmView';
import {DEFAULT_ROBOT_ARM} from '../src/pallet/robotArm';
it('removes wrist pitch/roll but retains the fourth-axis yaw without modifying the input',()=>{
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const tilt of [0,.3,Math.PI/2]){
  const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),tilt)),before=q.clone(),fixed=uprightToolQuaternion(q),expected=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw);
  expect(q.equals(before)).toBe(true);expect(fixed.angleTo(expected)).toBeLessThan(1e-7);expect(new Vector3(0,1,0).applyQuaternion(fixed).distanceTo(new Vector3(0,1,0))).toBeLessThan(1e-8);
 }
 expect(uprightToolQuaternion(new Quaternion(1,0,0,0)).equals(new Quaternion())).toBe(true);
});
it('rejects tilted floor-arm commands and filters them before candidate search',()=>{
 const s=withFleet(streamInventory(42,8),{count:1,architecture:'floor'}),b=createStream(s).boxes[0].observation;b.orientationAllowed=[0,90,'whd','wdh'];
 expect(robotObservation(s.pallet,0,b).orientationAllowed).toEqual([0,90]);expect(b.orientationAllowed).toHaveLength(4);
 expect(robotReach(s.pallet,0,{x:900,y:500,z:1000},{x:0,y:0,z:1},160)).toBe(true);expect(robotReach(s.pallet,0,{x:900,y:500,z:1000},{x:1,y:0,z:0},160)).toBe(false);
});
it('the Hyundai-style four-axis wrist adapter stays vertical even for an old tilted pose',()=>{
 const s=streamInventory(42,8),arm=createRobotArmView(undefined,'hyundai'),target={x:900,y:500,z:1000},state=arm.update(target,poseQuaternion('whd'),160,DEFAULT_ROBOT_ARM,s.pallet,[]);
 expect(new Vector3(state.pose.tcp.x,state.pose.tcp.y,state.pose.tcp.z).distanceTo(new Vector3(target.x,target.y,target.z))).toBeLessThan(1e-8);expect(state.pose.wrist.x).toBeCloseTo(target.x);expect(state.pose.wrist.y).toBeCloseTo(target.y);expect(state.pose.wrist.z-state.pose.tcp.z).toBeCloseTo(280);
 arm.group.traverse(o=>{if('geometry' in o)(o as any).geometry.dispose();});
});
