import type { Vec3,Placement } from './types';

export interface RobotArmModel { baseX:number;baseY:number;shoulderHeight:number;upperArm:number;forearm:number;wristLength:number }
// A fixed-size illustrative cell, outside the pallet and incoming table. This is
// independent of the planner's horizontal TCP envelope, not a specific robot model.
export const DEFAULT_ROBOT_ARM:RobotArmModel={baseX:-900,baseY:-450,shoulderHeight:650,upperArm:1600,forearm:1600,wristLength:120};
export const armDistance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export interface ArmPose { base:Vec3;shoulder:Vec3;elbow:Vec3;wrist:Vec3;flange:Vec3;tcp:Vec3;target:Vec3;errorMm:number;reachable:boolean;yaw:number;shoulderAngle:number;elbowAngle:number }
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
export function solveRobotArm(target:Vec3,normal:Vec3,toolHeight:number,m:RobotArmModel=DEFAULT_ROBOT_ARM):ArmPose{
 const base={x:m.baseX,y:m.baseY,z:0},shoulder={...base,z:m.shoulderHeight},offset=toolHeight+m.wristLength;
 const goal={x:target.x+normal.x*offset,y:target.y+normal.y*offset,z:target.z+normal.z*offset};
 const dx=goal.x-shoulder.x,dy=goal.y-shoulder.y,dz=goal.z-shoulder.z,r=Math.hypot(dx,dy),d=Math.hypot(r,dz),yaw=r>1e-8?Math.atan2(dy,dx):0;
 const min=Math.abs(m.upperArm-m.forearm)+1e-6,max=m.upperArm+m.forearm-1e-6,reach=clamp(d,min,max),azimuth=d>1e-8?Math.atan2(dz,r):Math.PI/2;
 const shoulderAngle=azimuth+Math.acos(clamp((m.upperArm*m.upperArm+reach*reach-m.forearm*m.forearm)/(2*m.upperArm*reach),-1,1));
 const elbowAngle=-Math.acos(clamp((reach*reach-m.upperArm*m.upperArm-m.forearm*m.forearm)/(2*m.upperArm*m.forearm),-1,1));
 const radial=(length:number,angle:number)=>({x:Math.cos(yaw)*length*Math.cos(angle),y:Math.sin(yaw)*length*Math.cos(angle),z:length*Math.sin(angle)});
 const a=radial(m.upperArm,shoulderAngle),b=radial(m.forearm,shoulderAngle+elbowAngle),elbow={x:shoulder.x+a.x,y:shoulder.y+a.y,z:shoulder.z+a.z},wrist={x:elbow.x+b.x,y:elbow.y+b.y,z:elbow.z+b.z};
 const flange={x:wrist.x-normal.x*m.wristLength,y:wrist.y-normal.y*m.wristLength,z:wrist.z-normal.z*m.wristLength},tcp={x:flange.x-normal.x*toolHeight,y:flange.y-normal.y*toolHeight,z:flange.z-normal.z*toolHeight},errorMm=armDistance(tcp,target);
 return {base,shoulder,elbow,wrist,flange,tcp,target,errorMm,reachable:errorMm<.01,yaw,shoulderAngle,elbowAngle};
}

// Conservative segment / expanded AABB test; highlights possible link contact.
// It is not a swept-path certificate, and does not alter packing decisions.
export function armSegmentHitsBox(a:Vec3,b:Vec3,box:Pick<Placement,'position'|'size'>,radius:number){
 let lo=0,hi=1;
 for(const [axis,size] of [['x','w'],['y','d'],['z','h']] as const){const delta=b[axis]-a[axis],min=box.position[axis]-radius,max=box.position[axis]+box.size[size]+radius;
  if(Math.abs(delta)<1e-8){if(a[axis]<min||a[axis]>max)return false;continue;}
  const t0=(min-a[axis])/delta,t1=(max-a[axis])/delta;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(lo>hi)return false;
 }return true;
}
export function armInterference(p:ArmPose,boxes:Placement[]){
 const segments:[Vec3,Vec3,number][]=[[p.shoulder,p.elbow,105],[p.elbow,p.wrist,80],[p.wrist,p.flange,65]];
 return segments.map(([a,b,r])=>{const hit=boxes.find(box=>armSegmentHitsBox(a,b,box,r));return hit?.id??(Math.min(a.z,b.z)<r?'바닥':null);});
}
