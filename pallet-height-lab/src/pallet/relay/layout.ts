import {robotCount,idleTCP} from './fleet';
import { DEFAULT_ROBOT_ARM } from '../robotArm';
import type { Pallet,Placement,Vec3 } from '../types';
import type { RelaySegment } from './types';
export const ROBOT_COUNT=4;
export const RELAY_COLORS=['#73cdb8','#e7b968','#84aef0','#cf9be1','#f39b83','#92d37e','#79d4e4','#e19cbd'];
export const nextRobot=(i:number,count=ROBOT_COUNT)=>(i+1)%count;
export const previousRobot=(i:number,count=ROBOT_COUNT)=>(i+count-1)%count;
export const stationPitch=(p:Pallet)=>Math.max(3600,p.width+2200,p.palletsPerRobot===2?2*p.width+600:0);
export const cellRadius=(p:Pallet)=>stationPitch(p)*Math.max(.3,(robotCount(p)-1)/2);
export function cellPose(index:number,p:Pallet){return {x:(index-(robotCount(p)-1)/2)*stationPitch(p),y:p.depth/2+1000,angle:0};}
export function toWorld(v:Vec3,index:number,p:Pallet):Vec3 {const c=cellPose(index,p),x=v.x-p.width/2,y=v.y-p.depth/2;return {x:c.x+x*Math.cos(c.angle)-y*Math.sin(c.angle),y:c.y+x*Math.sin(c.angle)+y*Math.cos(c.angle),z:v.z};}
export function toLocal(v:Vec3,index:number,p:Pallet):Vec3 {const c=cellPose(index,p),x=v.x-c.x,y=v.y-c.y;return {x:p.width/2+x*Math.cos(c.angle)+y*Math.sin(c.angle),y:p.depth/2-x*Math.sin(c.angle)+y*Math.cos(c.angle),z:v.z};}
export const queueCenter=(i:number,p:Pallet)=>toWorld({x:-500,y:525,z:0},i,p);
export function handoffCenter(i:number,p:Pallet){return {x:cellPose(i,p).x,y:-500,z:450};}
export const park=(i:number,p:Pallet)=>toWorld(idleTCP(p,i)??{x:DEFAULT_ROBOT_ARM.baseX+350,y:DEFAULT_ROBOT_ARM.baseY+300,z:1000},i,p);
// Transform all four corners: diagonal cells need a conservative world AABB.
export function worldBox(b:Placement,i:number,p:Pallet):Placement {const corners=[0,b.size.w].flatMap(x=>[0,b.size.d].map(y=>toWorld({x:b.position.x+x,y:b.position.y+y,z:b.position.z},i,p))),xs=corners.map(v=>v.x),ys=corners.map(v=>v.y);return {...b,position:{x:Math.min(...xs),y:Math.min(...ys),z:b.position.z},size:{w:Math.max(...xs)-Math.min(...xs),d:Math.max(...ys)-Math.min(...ys),h:b.size.h}};}
export function transferMotion(segments:RelaySegment[],progress:number,initialCenter:Vec3,halfHeight=initialCenter.z){
 let time=progress*segments.reduce((n,v)=>n+v.seconds,0),center={...initialCenter},yaw=segments[0].yawFrom;const targets:Record<number,{tcp:Vec3;yaw:number}>={};
 for(let i=0;i<segments.length;i++){const s=segments[i],t=Math.min(1,time/s.seconds),tcp={x:s.from.x+(s.to.x-s.from.x)*t,y:s.from.y+(s.to.y-s.from.y)*t,z:s.from.z+(s.to.z-s.from.z)*t},angle=s.yawFrom+(s.yawTo-s.yawFrom)*t;
  targets[s.robot]={tcp,yaw:angle};if(s.carrying){center={...tcp,z:tcp.z-halfHeight};yaw=angle;}
  if(time<=s.seconds||i===segments.length-1)return {center,yaw,targets,label:s.label,robot:s.robot};time-=s.seconds;
 }
 throw Error('전달 경로가 비어 있습니다.');
}
