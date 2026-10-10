import { intersects, top } from '../geometry';
import { poseVector,orientedSize } from '../orientations';
import type { Constraints, GripPath, Observation, Placement, Vec3 } from '../types';
import type { GraspFace } from './spec';
export interface ReachModel {base:Vec3;minReach:number;maxReach:number;approach:number}
export function reachability(target:Vec3,robot:ReachModel){const distance=Math.hypot(target.x-robot.base.x,target.y-robot.base.y,target.z-robot.base.z);return {distance,valid:distance>=robot.minReach-1e-6&&distance<=robot.maxReach+1e-6};}
const normals:Record<GraspFace,Vec3>={TOP:{x:0,y:0,z:1},FRONT:{x:0,y:-1,z:0},BACK:{x:0,y:1,z:0},LEFT:{x:-1,y:0,z:0},RIGHT:{x:1,y:0,z:0}};
const add=(a:Vec3,b:Vec3,n:number):Vec3=>({x:a.x+b.x*n,y:a.y+b.y*n,z:a.z+b.z*n});
const dist=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function swept(a:Vec3,b:Vec3,half:Vec3){return {position:{x:Math.min(a.x,b.x)-half.x,y:Math.min(a.y,b.y)-half.y,z:Math.min(a.z,b.z)-half.z},size:{w:Math.abs(a.x-b.x)+2*half.x,d:Math.abs(a.y-b.y)+2*half.y,h:Math.abs(a.z-b.z)+2*half.z}};}
export function packagingRobot(box:Placement,current:Observation,placed:Placement[],c:Constraints){
 const spec=current.packaging!,model=c.packagingRobot??{base:{x:c.reach?.baseX??-700,y:c.reach?.baseY??500,z:650},minReach:c.reach?.minRadius??0,maxReach:c.reach?.maxRadius??3500,approach:180};
 const center={x:box.position.x+box.size.w/2,y:box.position.y+box.size.d/2,z:box.position.z+box.size.h/2},g=c.gripper;
 const faces=[...spec.graspableFaces].sort((a,b)=>Number(b===spec.preferredGraspFace)-Number(a===spec.preferredGraspFace));
 const reasons:string[]=[];let lastDistance=0;
 for(const face of faces){
  const n=poseVector(normals[face],box.orientation);if(n.z<-.5){reasons.push(`ROBOT: ${face} 면이 바닥을 향함`);continue;}
  const extent=Math.abs(n.x)*box.size.w/2+Math.abs(n.y)*box.size.d/2+Math.abs(n.z)*box.size.h/2;
  const target=add(center,n,extent+g.height/2+g.margin),approach=add(target,n,model.approach);
  const half={x:n.x?g.height/2:g.width/2,y:n.y?g.height/2:g.depth/2,z:n.z?g.height/2:Math.max(g.width,g.depth)/2};
  const approachBody=swept(target,approach,half),blocker=placed.find(b=>intersects(approachBody,b,g.margin));
  if(blocker){reasons.push(`ROBOT: ${face} 접근 corridor 간섭 · ${blocker.id}`);continue;}
  const targetReach=reachability(target,model);lastDistance=targetReach.distance;
  if(!targetReach.valid){reasons.push(`ROBOT: TCP 3D 거리 ${targetReach.distance.toFixed(1)} mm / 허용 ${model.minReach}–${model.maxReach} mm`);continue;}
  const source=current.pickupPosition??{x:-900,y:200,z:0},pickCenter={x:source.x+current.size.w/2,y:source.y+current.size.d/2,z:source.z+current.size.h/2},sn=normals[face],se=Math.abs(sn.x)*current.size.w/2+Math.abs(sn.y)*current.size.d/2+Math.abs(sn.z)*current.size.h/2,pick=add(pickCenter,sn,se+g.height/2+g.margin);
  const safe=Math.max(top(box),...placed.map(top),current.size.h)+Math.max(box.size.h,current.size.h)+g.lift+g.height;
  const points:GripPath['points']=[{label:'입고 파지',tcp:pick,carrying:true,hold:g.pickSeconds,pose:0},{label:'상승',tcp:{...pick,z:safe},carrying:true,hold:0,pose:0},{label:'안전면 이동·회전',tcp:{...approach,z:safe},carrying:true,hold:0,pose:box.orientation},{label:'접근면 진입',tcp:approach,carrying:true,hold:0,pose:box.orientation},{label:'내려놓기',tcp:target,carrying:true,hold:g.placeSeconds,pose:box.orientation},{label:'면 이탈',tcp:approach,carrying:false,hold:0,pose:box.orientation},{label:'복귀 상승',tcp:{...approach,z:safe},carrying:false,hold:0,pose:box.orientation},{label:'입고 복귀',tcp:{...pick,z:safe},carrying:false,hold:0,pose:0}];
  let failure='';
  for(let i=1;i<points.length;i++){
   const a=points[i-1].tcp,b=points[i].tcp,delta={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},length=dist(a,b),t=length?Math.max(0,Math.min(1,((model.base.x-a.x)*delta.x+(model.base.y-a.y)*delta.y+(model.base.z-a.z)*delta.z)/(length*length))):0;
   if([a,b,add(a,delta,t)].some(v=>!reachability(v,model).valid)){failure='ROBOT: 운반 경로 3D 도달 범위 밖';break;}
   const tool=swept(a,b,{x:Math.max(g.width,g.height)/2+g.margin,y:Math.max(g.depth,g.height)/2+g.margin,z:Math.max(g.width,g.height)/2+g.margin});
   // Tool and carried box are checked separately. For the rotated travel segment use a conservative sphere envelope.
   const from=points[i-1].pose??0,to=points[i].pose??0,sa=orientedSize(current.size,from),sb=orientedSize(current.size,to);
   const heldCenter=(tcp:Vec3,pose:typeof from,size:typeof sa)=>{const normal=poseVector(normals[face],pose),extent=Math.abs(normal.x)*size.w/2+Math.abs(normal.y)*size.d/2+Math.abs(normal.z)*size.h/2;return add(tcp,normal,-extent-g.height/2-g.margin);};
   const radius=Math.hypot(current.size.w,current.size.d,current.size.h)/2,half=from===to?{x:sb.w/2,y:sb.d/2,z:sb.h/2}:{x:radius,y:radius,z:radius};
   const held=swept(heldCenter(a,from,sa),heldCenter(b,to,sb),half);
   const volumes=[tool,...(points[i].carrying?[held]:[])],w=c.workspace;
   if(volumes.some(v=>v.position.z< -1e-6||v.position.x<w.xMin||v.position.y<w.yMin||v.position.x+v.size.w>w.xMax||v.position.y+v.size.d>w.yMax||v.position.z+v.size.h>w.zMax)){failure='ROBOT: 공구 / 운반 경로 작업공간 밖';break;}
   const hit=placed.find(other=>volumes.some(v=>intersects(v,other)));if(hit){failure=`ROBOT: ${face} 운반 경로 간섭 · ${hit.id}`;break;}
  }
  if(failure){reasons.push(failure);continue;}
  const lengths=points.slice(1).map((v,i)=>dist(points[i].tcp,v.tcp)),slow=spec.shockSensitive?1.35:1,segmentSeconds=lengths.map((d,i)=>d/g.speed*slow+points[i+1].hold+(i===0?g.pickSeconds:0)+(i===1&&box.orientation!==0?90/(g.rotationSpeed??90)*slow:0));
  const path:GripPath={graspFace:face,model:'gripper',points,lengthMm:lengths.reduce((a,b)=>a+b,0),seconds:segmentSeconds.reduce((a,b)=>a+b,0),segmentSeconds};
  return {valid:true,reasons:[] as string[],face,distance:lastDistance,path};
 }
 return {valid:false,reasons:[...new Set(reasons)],distance:lastDistance,face:null,path:null};
}
