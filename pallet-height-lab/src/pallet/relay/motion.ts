import {allPallets,palletToWorld,worldToPallet,palletToRobot} from './palletStations';
import {robotReach} from './fleet';
import { beltPickup,beltStation,sourcePickup,CONVEYOR } from './conveyor';
import { Vector3 } from 'three';
import { gripperPath,incomingPosition } from '../constraints';
import { intersects,top } from '../geometry';
import { poseQuaternion } from '../poseRendering';
import { cellPose,toWorld,toLocal,park,nextRobot } from './layout';
import type { GripPath,Observation,Placement,Scenario,Vec3 } from '../types';
import type { RelayAction,RelaySegment,RelayWorld } from './types';

export function padPickup(s:Scenario,box:Observation,pad:number){
 return beltPickup(box,nextRobot(pad),s.pallet);
}
export function parkedPath(s:Scenario,path:GripPath,robot:number):GripPath{
 const idle=toLocal(park(robot,s.pallet),robot,s.pallet),first=path.points[0],last=path.points.at(-1)!;
 const start=Math.hypot(idle.x-first.tcp.x,idle.y-first.tcp.y,idle.z-first.tcp.z)/s.constraints.gripper.speed;
 const end=Math.hypot(idle.x-last.tcp.x,idle.y-last.tcp.y,idle.z-last.tcp.z)/s.constraints.gripper.speed;
 return {...path,points:[{label:'자기 작업 시작',tcp:idle,carrying:false,hold:0,pose:0},...path.points,{label:'자기 작업 완료',tcp:idle,carrying:false,hold:0,pose:0}],segmentSeconds:[start,...path.segmentSeconds,end],seconds:start+path.seconds+end};
}
export function stagingPath(s:Scenario,w:RelayWorld,box:Observation,from:number,receive=false){
 const robot=receive?nextRobot(from):from,g=s.constraints.gripper,to=nextRobot(from),angle=cellPose(robot,s.pallet).angle;
 const input=receive?incomingPosition():sourcePickup(w,box,robot,s.pallet),q=toWorld({x:input.x+box.size.w/2,y:input.y+box.size.d/2,z:input.z+box.size.h},robot,s.pallet),pad={...beltStation(receive?robot:from,s.pallet),z:CONVEYOR.deck+box.size.h};
 const pick=receive?pad:q,drop=receive?q:pad,initialYaw=angle,finalYaw=angle;
 const safe=Math.max(pick.z,drop.z,...w.cells[robot].placements.map(top))+box.size.h+g.lift,up=(p:Vec3)=>({...p,z:safe});
 const segments:RelaySegment[]=[];
 const add=(a:Vec3,b:Vec3,carrying:boolean,label:string,ya:number,yb=ya,hold=0)=>segments.push({robot,from:a,to:b,carrying,label,yawFrom:ya,yawTo:yb,seconds:Math.max(.05,Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)/g.speed,Math.abs(yb-ya)*180/Math.PI/(g.rotationSpeed||90))+hold});
 add(park(robot,s.pallet),up(park(robot,s.pallet)),false,'대기 자세에서 상승',initialYaw);
 add(up(park(robot,s.pallet)),up(pick),false,receive?'옆 벨트 픽업 구역 접근':'자기 재고 접근',initialYaw);
 add(up(pick),pick,false,receive?'옆 벨트 픽업 구역에서 집기':'보낼 박스 집기',initialYaw,initialYaw,g.pickSeconds);
 add(pick,up(pick),true,'안전 높이로 이동',initialYaw);
 if(!receive)add(up(pick),up(pick),true,'받는 팔 방향으로 회전',initialYaw,finalYaw);
 add(up(pick),up(drop),true,receive?'자기 대기 재고로 운반':'옆 벨트 픽업 구역로 운반',finalYaw);
 add(up(drop),drop,true,receive?'자기 대기 재고에 보관':'벨트 픽업 구역에 내려놓기',finalYaw,finalYaw,g.placeSeconds);
 add(drop,up(drop),false,'벨트 픽업 구역 / 재고대 이탈',finalYaw);
 add(up(drop),up(park(robot,s.pallet)),false,'대기 구역으로 복귀',finalYaw,angle);
 add(up(park(robot,s.pallet)),park(robot,s.pallet),false,'자기 작업 완료',angle);
 const initialCenter={...pick,z:pick.z-box.size.h/2};
 return {segments,seconds:segments.reduce((n,v)=>n+v.seconds,0),initialCenter};
}

// Reservations are swept tool/box volumes, not a certificate for full robot links.
export function actionSweeps(s:Scenario,w:RelayWorld,a:RelayAction){
 const box=w.boxes.find(b=>b.observation.id===a.boxId)!.observation,g=s.constraints.gripper;
 const result:Placement[]=[];
 const add=(u:Vec3,v:Vec3,carrying:boolean,width:number,depth:number,height:number)=>result.push({position:{x:Math.min(u.x,v.x)-width/2-g.margin,y:Math.min(u.y,v.y)-depth/2-g.margin,z:Math.min(u.z,v.z)-(carrying?height:0)},size:{w:Math.abs(v.x-u.x)+width+2*g.margin,d:Math.abs(v.y-u.y)+depth+2*g.margin,h:Math.abs(v.z-u.z)+(carrying?height:0)+g.height}} as Placement);
 if(a.segments)for(const p of a.segments){const rotating=Math.abs(p.yawTo-p.yawFrom)>1e-6,diag=Math.hypot(box.size.w,box.size.d);
  add(p.from,p.to,p.carrying,p.carrying?(rotating?diag:Math.abs(Math.cos(p.yawFrom))*box.size.w+Math.abs(Math.sin(p.yawFrom))*box.size.d):g.width,p.carrying?(rotating?diag:Math.abs(Math.sin(p.yawFrom))*box.size.w+Math.abs(Math.cos(p.yawFrom))*box.size.d):g.depth,box.size.h);
 }else if(a.path){for(let i=1;i<a.path.points.length;i++){const u=a.path.points[i-1],v=a.path.points[i],tilted=a.path.fixedGrasp,diag=tilted?Math.hypot(box.size.w,box.size.d,box.size.h):Math.hypot(box.size.w,box.size.d);
  add(palletToWorld(u.tcp,a.robot,s.pallet,a.pallet),palletToWorld(v.tcp,a.robot,s.pallet,a.pallet),v.carrying,v.carrying?diag:Math.hypot(g.width,g.depth),v.carrying?diag:Math.hypot(g.width,g.depth),tilted?diag:box.size.h);
 }}return result;
}
export function motionsConflict(s:Scenario,w:RelayWorld,a:RelayAction,b:RelayAction){
 if(a.robot===b.robot||a.boxId===b.boxId||a.pad!==undefined&&a.pad===b.pad)return true;
 const x=actionSweeps(s,w,a),y=actionSweeps(s,w,b);return x.some(u=>y.some(v=>intersects(u,v)));
}
// Test a segment against an expanded box in the obstacle's own cell frame.
// A diagonal world AABB would fill empty triangular corners and block valid moves.
function segmentBox(u:Vec3,v:Vec3,b:Placement,radius:number,below:number,above:number){
 let low=0,high=1;
 for(const [axis,size] of [['x','w'],['y','d'],['z','h']] as const){
  const min=b.position[axis]-(axis==='z'?above:radius),max=b.position[axis]+b.size[size]+(axis==='z'?below:radius),delta=v[axis]-u[axis];
  if(Math.abs(delta)<1e-8){if(u[axis]<=min+1e-6||u[axis]>=max-1e-6)return false;continue;}
  const a=(min-u[axis])/delta,c=(max-u[axis])/delta;low=Math.max(low,Math.min(a,c));high=Math.min(high,Math.max(a,c));if(low>=high-1e-8)return false;
 }return true;
}
export function inspectMotion(s:Scenario,w:RelayWorld,a:RelayAction):string[]{
 const box=w.boxes.find(b=>b.observation.id===a.boxId)!.observation,g=s.constraints.gripper,reasons:string[]=[];
 if(box.weight+g.mass>g.payload)reasons.push('전달/적재 가반하중 초과');
 if(a.pad!==undefined&&(box.size.w>800||box.size.d>CONVEYOR.width-100))reasons.push('벨트 픽업 구역 / 대기대 치수 초과');
 if(a.segments){for(const seg of a.segments){if(Math.max(seg.from.z,seg.to.z)+g.height>s.constraints.workspace.zMax)reasons.push('작업 높이 초과');
  for(let k=0;k<=12;k++){const t=k/12,p={x:seg.from.x+(seg.to.x-seg.from.x)*t,y:seg.from.y+(seg.to.y-seg.from.y)*t,z:seg.from.z+(seg.to.z-seg.from.z)*t};if(!robotReach(s.pallet,a.robot,toLocal(p,a.robot,s.pallet),{x:0,y:0,z:1},g.height)){reasons.push('가상 로봇 작업범위 / 자세 도달 불가');break;}}
 }}else if(a.path){for(let i=1;i<a.path.points.length;i++){const u=a.path.points[i-1],v=a.path.points[i];for(let k=0;k<=12;k++){const t=k/12,p={x:u.tcp.x+(v.tcp.x-u.tcp.x)*t,y:u.tcp.y+(v.tcp.y-u.tcp.y)*t,z:u.tcp.z+(v.tcp.z-u.tcp.z)*t},q=poseQuaternion(u.pose??(u.yaw===90?90:0)).slerp(poseQuaternion(v.pose??(v.yaw===90?90:0)),t),normal=new Vector3(0,1,0).applyQuaternion(q);
   if(!robotReach(s.pallet,a.robot,palletToRobot(p,s.pallet,a.pallet),{x:normal.x,y:normal.z,z:normal.y},g.height)){reasons.push('가상 로봇 작업범위 / 자세 도달 불가');break;}
  }} }
 // Own-pallet paths are checked by inspectConstraints; additional cells/pads are obstacles here.
 const objects=allPallets(w).flatMap(({cell,robot,pallet})=>a.segments||robot!==a.robot||pallet!==(a.pallet??0)?cell.placements.map(p=>({box:p,cell:robot,pallet})):[]);
 w.pads.forEach((pad,i)=>{if(!pad.boxId||!pad.arrived||i===a.pad)return;const b=w.boxes.find(b=>b.observation.id===pad.boxId)!.observation,source=padPickup(s,b,i);objects.push({box:{position:source,size:b.size} as Placement,cell:nextRobot(i),pallet:0});});
 const segments=a.segments?.map(p=>({from:p.from,to:p.to,carrying:p.carrying,tilted:false}))||a.path!.points.slice(1).map((v,i)=>({from:palletToWorld(a.path!.points[i].tcp,a.robot,s.pallet,a.pallet),to:palletToWorld(v.tcp,a.robot,s.pallet,a.pallet),carrying:v.carrying,tilted:!!a.path!.fixedGrasp}));
 if(segments.some(v=>{const radius=(v.carrying?(v.tilted?Math.hypot(box.size.w,box.size.d,box.size.h):Math.hypot(box.size.w,box.size.d)):Math.hypot(g.width,g.depth))/2+g.margin;return objects.some(o=>segmentBox(worldToPallet(v.from,o.cell,s.pallet,o.pallet),worldToPallet(v.to,o.cell,s.pallet,o.pallet),o.box,radius,v.carrying?(v.tilted?2*radius:box.size.h):0,g.height));}))reasons.push('다른 작업셀 / 벨트 픽업 구역과 운반 경로 간섭');
 return [...new Set(reasons)];
}
export function receiveConstraints(s:Scenario){
 // The shared pickup lies outside the old single-cell rectangle. Pallet boundaries,
 // height, material and load constraints stay unchanged; virtual arm reach is checked.
 return {...s.constraints,workspace:{...s.constraints.workspace,xMin:-5000,xMax:5000,yMin:-5000,yMax:5000},reach:undefined,robotMode:'gripper' as const};
}
export function receivePath(s:Scenario,w:RelayWorld,box:Observation,pad:number,candidate:Placement){
 const robot=nextRobot(pad),pickup=padPickup(s,box,pad),path=parkedPath(s,gripperPath(candidate,{...box,pickupPosition:pickup},w.cells[robot].placements,receiveConstraints(s)),robot);
 return {path,pickup};
}
