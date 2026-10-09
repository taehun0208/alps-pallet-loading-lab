import { orientedSize,poseVector } from './orientations';
import { top } from './geometry';
import type { Constraints,GripPath,Observation,Placement,Vec3,PathPoint,Orientation,Dimensions } from './types';
const add=(a:Vec3,b:Vec3):Vec3=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
export const graspOffset=(size:Dimensions,pose:Orientation)=>poseVector({x:0,y:0,z:size.h/2},pose);
// Fixed original top-face grasp: standing poses put the TCP on a side face.
// This is a conservative tool/box proxy, not an IK or suction-capacity certificate.
export function tiltPath(box:Placement,current:Observation,placed:Placement[],c:Constraints,source:Vec3):GripPath{
 const pickup={x:source.x+current.size.w/2,y:source.y+current.size.d/2,z:source.z+current.size.h},pose=box.orientation;
 const center={x:box.position.x+box.size.w/2,y:box.position.y+box.size.d/2,z:box.position.z+box.size.h/2},target=add(center,graspOffset(current.size,pose));
 const radius=Math.max(Math.hypot(current.size.w/2,current.size.d/2,current.size.h),Math.hypot(c.gripper.width/2,c.gripper.depth/2,c.gripper.height))+c.gripper.margin;
 const safe=Math.max(top(box),pickup.z,...placed.map(top))+radius+c.gripper.lift,away=add(target,poseVector({x:0,y:0,z:c.gripper.height+c.gripper.margin+20},pose));
 const points:PathPoint[]=[
  {label:current.pickupPosition?'임시 대기대 · 회수 대기':'입고 위치 · 대기',tcp:{...pickup,z:safe},carrying:false,hold:0,pose:0},
  {label:'접근 · 집기',tcp:pickup,carrying:false,hold:c.gripper.pickSeconds,pose:0},
  {label:'안전 높이로 이동',tcp:{...pickup,z:safe},carrying:true,hold:0,pose:0},
  {label:'안전 높이 · 박스 세우기',tcp:{...pickup,z:safe},carrying:true,hold:0,pose},
  {label:'목표 위로 이동',tcp:{...target,z:safe},carrying:true,hold:0,pose},
  {label:'내려놓기',tcp:target,carrying:true,hold:c.gripper.placeSeconds,pose},
  {label:'파지면 바깥으로 이탈',tcp:away,carrying:false,hold:0,pose},
  {label:'안전 높이 복귀',tcp:{...away,z:safe},carrying:false,hold:0,pose},
  {label:current.pickupPosition?'임시 대기대로 복귀':'입고 위치로 복귀',tcp:{...pickup,z:safe},carrying:false,hold:0,pose},
  {label:'빈 그리퍼 자세 복원',tcp:{...pickup,z:safe},carrying:false,hold:0,pose:0},
 ];
 const lengths=points.slice(1).map((p,i)=>Math.hypot(p.tcp.x-points[i].tcp.x,p.tcp.y-points[i].tcp.y,p.tcp.z-points[i].tcp.z));
 const segmentSeconds=lengths.map((l,i)=>Math.max(l/c.gripper.speed,points[i].pose!==points[i+1].pose?180/(c.gripper.rotationSpeed??180):0)+points[i+1].hold);
 return {model:'gripper',fixedGrasp:true,points,lengthMm:lengths.reduce((a,b)=>a+b,0),segmentSeconds,seconds:segmentSeconds.reduce((a,b)=>a+b,0)};
}
function translateSweep(a:Vec3,b:Vec3,size:Dimensions,offset:Vec3,margin:number){return {position:{x:Math.min(a.x,b.x)+offset.x-size.w/2-margin,y:Math.min(a.y,b.y)+offset.y-size.d/2-margin,z:Math.min(a.z,b.z)+offset.z-size.h/2-margin},size:{w:Math.abs(a.x-b.x)+size.w+2*margin,d:Math.abs(a.y-b.y)+size.d+2*margin,h:Math.abs(a.z-b.z)+size.h+2*margin}};}
export function tiltSweeps(a:PathPoint,b:PathPoint,current:Observation,c:Constraints){
 const from=a.pose??0,to=b.pose??0,grip={w:c.gripper.width,d:c.gripper.depth,h:c.gripper.height};
 if(from!==to){const radius=Math.max(Math.hypot(grip.w/2,grip.d/2,grip.h),b.carrying?Math.hypot(current.size.w/2,current.size.d/2,current.size.h):0)+c.gripper.margin;return [translateSweep(a.tcp,b.tcp,{w:2*radius,d:2*radius,h:2*radius},{x:0,y:0,z:0},0)];}
 const bounds=[translateSweep(a.tcp,b.tcp,orientedSize(grip,to),poseVector({x:0,y:0,z:grip.h/2},to),c.gripper.margin)];
 if(b.carrying)bounds.push(translateSweep(a.tcp,b.tcp,orientedSize(current.size,to),poseVector({x:0,y:0,z:-current.size.h/2},to),0));return bounds;
}
