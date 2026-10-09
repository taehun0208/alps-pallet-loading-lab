import {it,expect} from 'vitest';
import {Quaternion} from 'three';
import {createRobotArmView} from '../src/pallet/RobotArmView';
import {DEFAULT_ROBOT_ARM} from '../src/pallet/robotArm';
import {TWIN_ROBOT_PALETTE} from '../src/pallet/relay/twinSceneTheme';
it('changes only the visual shell, retaining the exact same pose and interference checks',()=>{
 const generic=createRobotArmView(),hyundai=createRobotArmView(TWIN_ROBOT_PALETTE,'hyundai');
 const pallet={width:1800,depth:1500,maxHeight:1600};
 for(const target of [{x:0,y:0,z:350},{x:1200,y:800,z:1500},{x:8000,y:0,z:0}]){
  const args=[target,new Quaternion(),160,DEFAULT_ROBOT_ARM,pallet,[]] as const;
  expect(hyundai.update(...args)).toEqual(generic.update(...args));
 }
 expect(hyundai.group.children.length).toBeGreaterThan(generic.group.children.length);
});