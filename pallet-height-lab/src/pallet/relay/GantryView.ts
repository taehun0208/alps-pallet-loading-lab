import * as THREE from 'three';
import type {Pallet,Vec3} from '../types';
import {engineToRender} from '../coordinates';
import type {RobotArmModel} from '../robotArm';
import {gantryEnvelope,gantryReach} from './fleet';
import {TWIN_ROBOT_PALETTE as colors} from './twinSceneTheme';
// Cartesian X/Y bridge + telescopic Z mast. A generic mechanism, not a Hyundai product.
export function createGantryView(p:Pallet){
 const group=new THREE.Group();group.name='ceiling-rail-robot';const e=gantryEnvelope(p);
 const body=new THREE.MeshStandardMaterial({color:colors.body,roughness:.55,metalness:.25}),steel=new THREE.MeshStandardMaterial({color:colors.steel,roughness:.4,metalness:.6}),dark=new THREE.MeshStandardMaterial({color:colors.dark});
 const v=(t:Vec3)=>new THREE.Vector3(...engineToRender(t,p));
 function box(size:number[],at:Vec3,mat:THREE.Material,parent=group){const mesh=new THREE.Mesh(new THREE.BoxGeometry(size[0]/1000,size[1]/1000,size[2]/1000),mat);mesh.position.copy(v(at));mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
 for(const x of [e.xMin-170,e.xMax+170]){
  box([140,220,e.yMax-e.yMin+600],{x,y:(e.yMin+e.yMax)/2,z:e.railZ},steel);
  // Short hangers explicitly indicate ceiling mounting, without floor pedestals.
  for(const y of [e.yMin-200,e.yMax+200])box([100,700,100],{x,y,z:e.railZ+430},steel);
 }
 const bridge=box([e.xMax-e.xMin+520,180,190],{x:(e.xMin+e.xMax)/2,y:0,z:e.railZ-140},body);
 const carriage=box([320,250,360],{x:0,y:0,z:e.railZ-330},dark);
 const housing=box([170,850,170],{x:0,y:0,z:e.railZ-780},body);
 const mast=box([90,1000,90],{x:0,y:0,z:2000},steel);
 const flange=box([150,80,150],{x:0,y:0,z:0},dark);
 function update(target:Vec3,rotation:THREE.Quaternion,toolHeight:number,_model:RobotArmModel,pallet:Pallet){
  bridge.position.copy(v({x:(e.xMin+e.xMax)/2,y:target.y,z:e.railZ-140}));
  carriage.position.copy(v({x:target.x,y:target.y,z:e.railZ-330}));
  housing.position.copy(v({x:target.x,y:target.y,z:e.railZ-780}));
  const bottom=target.z+toolHeight+80,top=e.railZ-420;
  mast.position.copy(v({x:target.x,y:target.y,z:(bottom+top)/2}));mast.scale.y=Math.max(.05,(top-bottom)/1000);
  flange.position.copy(v({x:target.x,y:target.y,z:target.z+toolHeight+40}));flange.quaternion.copy(rotation);
  const normal=new THREE.Vector3(0,1,0).applyQuaternion(rotation);
  return {pose:{reachable:gantryReach(pallet,target,{x:normal.x,y:normal.z,z:normal.y},toolHeight)},hits:[]};
 }
 return {group,update};
}
