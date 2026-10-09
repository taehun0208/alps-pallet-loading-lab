import * as THREE from 'three';
import {uprightToolQuaternion} from './poseRendering';
import { engineToRender } from './coordinates';
import { solveRobotArm,armInterference,type RobotArmModel } from './robotArm';
import type { Pallet,Placement,Vec3 } from './types';

const DEFAULT_ROBOT_PALETTE={body:'#deaa58',steel:'#536473',dark:'#202e39',accent:'#77d9c2',warning:'#f06d5f',warningEmission:'#5a1008',gap:'#ff7060'};
/** Hyundai-inspired visual shell only. Solver, TCP and collision model remain generic. */
export function createRobotArmView(palette=DEFAULT_ROBOT_PALETTE,design:'generic'|'hyundai'='generic'){
 const hyundai=design==='hyundai',group=new THREE.Group();group.name=hyundai?'hyundai-inspired-robot':'robot-arm';
 const body=new THREE.MeshStandardMaterial({color:palette.body,metalness:hyundai?.12:.45,roughness:hyundai?.48:.38}),steel=new THREE.MeshStandardMaterial({color:palette.steel,metalness:.65,roughness:.3}),dark=new THREE.MeshStandardMaterial({color:palette.dark,metalness:.5,roughness:.4}),accent=new THREE.MeshStandardMaterial({color:palette.accent,metalness:.3,roughness:.3}),warning=new THREE.MeshStandardMaterial({color:palette.warning,emissive:palette.warningEmission,roughness:.5});
 const add=(geometry:THREE.BufferGeometry,material:THREE.Material)=>{const mesh=new THREE.Mesh(geometry,material);group.add(mesh);return mesh;};
 const castLink=(width:number,depth:number)=>{
  const shape=new THREE.Shape();shape.moveTo(-width*.65,-.5);shape.lineTo(width*.65,-.5);shape.lineTo(width,-.32);shape.lineTo(width*.6,.38);shape.lineTo(width*.45,.5);shape.lineTo(-width*.45,.5);shape.lineTo(-width*.6,.38);shape.lineTo(-width,-.32);shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.014,bevelThickness:.012,bevelSegments:2,steps:1});geo.translate(0,0,-depth/2);return geo;
 };
 const foot=add(hyundai?new THREE.BoxGeometry(.56,.12,.56):new THREE.CylinderGeometry(.24,.29,.12,24),dark),turret=add(new THREE.CylinderGeometry(hyundai?.20:.16,hyundai?.25:.21,.23,24),body),column=add(new THREE.CylinderGeometry(hyundai?.18:.12,hyundai?.21:.17,1,16),hyundai?body:steel);
 const upper=add(hyundai?castLink(.18,.20):new THREE.CylinderGeometry(.085,.105,1,12),body),forearm=add(hyundai?castLink(.115,.15):new THREE.CylinderGeometry(.058,.08,1,12),body),wristLink=add(new THREE.CylinderGeometry(.052,.065,1,16),steel);
 const radii=hyundai?[.19,.15,.09]:[.135,.112,.082];
 const joints=radii.map(r=>add(new THREE.CylinderGeometry(r,r,r*1.65,24),dark));
 const caps=(hyundai?[.192,.152]:[.138,.115]).map(r=>add(hyundai?new THREE.CylinderGeometry(r*.87,r*.87,.035,24):new THREE.TorusGeometry(r,.012,6,24),hyundai?body:accent));
 const motors=hyundai?[add(new THREE.BoxGeometry(.26,.23,.23),dark),add(new THREE.BoxGeometry(.23,.19,.21),dark)]:[];
 if(hyundai){
  for(const cap of caps)for(let i=0;i<4;i++){const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.010,.010,.009,6),steel);bolt.position.set(Math.cos(i*Math.PI/2)*.09,.022,Math.sin(i*Math.PI/2)*.09);cap.add(bolt);}
  if(typeof document!=='undefined'){
   const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const ctx=canvas.getContext('2d');
   if(ctx){ctx.clearRect(0,0,512,96);ctx.fillStyle=palette.dark;ctx.font='700 66px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('HYUNDAI',256,48);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const label=new THREE.Mesh(new THREE.PlaneGeometry(.60,.112),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide}));label.rotation.z=Math.PI/2;label.position.set(0,.10,.09);forearm.add(label);
   }
  }
 }
 const wrist=new THREE.Group();group.add(wrist);
 for(const [r,h,y,mat] of [[.073,.045,0,dark],[.063,.027,-.033,accent],[.061,.035,-.064,steel]] as const){const ring=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24),mat);ring.position.y=y;wrist.add(ring);}
 const flange=add(new THREE.CylinderGeometry(.073,.073,.026,24),accent);
 const gapGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),gap=new THREE.Line(gapGeometry,new THREE.LineDashedMaterial({color:palette.gap,dashSize:.05,gapSize:.035}));group.add(gap);
 const axis=new THREE.Vector3(0,1,0),v=(p:Vec3,pallet:Pallet)=>new THREE.Vector3(...engineToRender(p,pallet));
 function link(mesh:THREE.Mesh,a:Vec3,b:Vec3,pallet:Pallet){const from=v(a,pallet),to=v(b,pallet),delta=to.clone().sub(from);mesh.position.copy(from).add(to).multiplyScalar(.5);mesh.scale.y=delta.length();mesh.quaternion.setFromUnitVectors(axis,delta.normalize());}
 function update(target:Vec3,rotation:THREE.Quaternion,toolHeight:number,model:RobotArmModel,pallet:Pallet,boxes:Placement[]){
  const toolRotation=hyundai?uprightToolQuaternion(rotation):rotation,n=new THREE.Vector3(0,1,0).applyQuaternion(toolRotation),normal={x:n.x,y:n.z,z:n.y},pose=solveRobotArm(target,normal,toolHeight,model),hits=armInterference(pose,boxes);
  foot.position.copy(v(pose.base,pallet)).y=.06;turret.position.copy(v(pose.base,pallet)).y=.235;turret.rotation.y=-pose.yaw;
  link(column,{...pose.base,z:280},pose.shoulder,pallet);link(upper,pose.shoulder,pose.elbow,pallet);link(forearm,pose.elbow,pose.wrist,pallet);link(wristLink,pose.wrist,pose.flange,pallet);
  [upper,forearm,wristLink].forEach((mesh,i)=>mesh.material=hits[i]?warning:i===2?steel:body);
  const hinge=new THREE.Vector3(-Math.sin(pose.yaw),0,Math.cos(pose.yaw));
  [pose.shoulder,pose.elbow,pose.wrist].forEach((point,i)=>{joints[i].position.copy(v(point,pallet));joints[i].quaternion.setFromUnitVectors(axis,hinge);});
  caps.forEach((cap,i)=>{cap.position.copy(joints[i].position).addScaledVector(hinge,hyundai?radii[i]*.825+.02:i===0?.113:.096);cap.quaternion.setFromUnitVectors(hyundai?axis:new THREE.Vector3(0,0,1),hinge);});
  motors.forEach((motor,i)=>{motor.position.copy(joints[i].position).addScaledVector(hinge,-radii[i]*1.2);motor.rotation.y=-pose.yaw;});
  wrist.position.copy(v(pose.wrist,pallet));wrist.quaternion.copy(toolRotation);flange.position.copy(v(pose.flange,pallet));flange.quaternion.copy(toolRotation);
  gap.visible=!pose.reachable;const attr=gapGeometry.getAttribute('position') as THREE.BufferAttribute;[pose.tcp,target].forEach((point,i)=>{const p=v(point,pallet);attr.setXYZ(i,p.x,p.y,p.z);});attr.needsUpdate=true;gap.computeLineDistances();
  return {pose,hits};
 }
 return {group,update};
}
