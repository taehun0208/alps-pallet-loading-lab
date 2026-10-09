import {tiltSweeps} from '../tiltRobot';
import {intersects} from '../geometry';
import type {Constraints,GripPath,Observation,PathPoint,Placement,Vec3} from '../types';
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const pose=(p:PathPoint)=>p.pose??(p.yaw===90?90:0);
// The old route revisited the previous belt pickup before returning to park.
// Stay above the checked safe plane, return directly above park, and descend outside the pallet.
export function directReturn(path:GripPath,idle:Vec3,box:Observation,stack:Placement[],c:Constraints):GripPath{
 const index=path.points.findIndex(p=>p.label==='임시 대기대로 복귀'||p.label==='입고 위치로 복귀');
 if(index<2)return path;
 const before=path.points[index-1],safePark={...idle,z:Math.max(idle.z,before.tcp.z)},orientation=pose(before);
 const tail:PathPoint[]=[{label:'안전 높이 · 대기 자세로 직접 복귀',tcp:safePark,carrying:false,hold:0,pose:orientation},...(orientation!==0?[{label:'빈 그리퍼 자세 복원',tcp:safePark,carrying:false,hold:0,pose:0 as const}]:[])];
 const inspected=[{...before,pose:orientation},...tail,{label:'대기 자세',tcp:idle,carrying:false,hold:0,pose:0 as const}];
 for(let i=1;i<inspected.length;i++)for(const sweep of tiltSweeps(inspected[i-1],inspected[i],box,c)){
  const p=sweep.position,s=sweep.size,w=c.workspace;
  if(stack.some(b=>intersects(sweep,b))||p.x<w.xMin||p.y<w.yMin||p.z<0||p.x+s.w>w.xMax||p.y+s.d>w.yMax||p.z+s.h>w.zMax)return path;
 }
 const points=[...path.points.slice(0,index),...tail],segmentSeconds=[...path.segmentSeconds.slice(0,index-1)];
 for(let i=index;i<points.length;i++)segmentSeconds.push(Math.max(distance(points[i-1].tcp,points[i].tcp)/c.gripper.speed,pose(points[i-1])!==pose(points[i])?180/(c.gripper.rotationSpeed||180):0));
 const seconds=segmentSeconds.reduce((n,v)=>n+v,0),returnDuration=seconds+distance(points.at(-1)!.tcp,idle)/c.gripper.speed;
 if(returnDuration>path.seconds+distance(path.points.at(-1)!.tcp,idle)/c.gripper.speed)return path;
 return {...path,points,segmentSeconds,seconds,lengthMm:points.slice(1).reduce((n,p,i)=>n+distance(points[i].tcp,p.tcp),0)};
}
