import {robotCount} from './fleet';
import type { Observation, Pallet, Vec3 } from '../types';
import type { RelayWorld,RelayMotion,RelayPad } from './types';
import { cellPose, nextRobot, toLocal } from './layout';
import { incomingPosition } from '../constraints';

// One closed, zoned accumulation conveyor. Each outbound segment holds one box;
// the receiving station remains reserved until that box is physically picked.
export const CONVEYOR = { speed:600, width:900, deck:450, front:-500, back:-2500 } as const;
export function beltBounds(p:Pallet) {
  const extra=p.conveyorExtensionMm??0;
  if(!Number.isInteger(extra)||extra<0||extra>4000)throw Error('벨트 추가 길이는 양 끝 각각 0–4000 mm 정수로 입력하세요.');
  if(p.conveyorMode==='straight'&&robotCount(p)===1){const right=cellPose(0,p).x-2400;return {left:right-4600-extra*2,right};}
  return { left:cellPose(0,p).x-(p.conveyorMode==='straight'||p.conveyorMode==='branched'?3000:1600)-extra, right:cellPose(robotCount(p)-1,p).x+1600+extra };
}
export function beltStation(robot:number,p:Pallet):Vec3 {
  return {x:cellPose(robot,p).x,y:CONVEYOR.front,z:CONVEYOR.deck};
}
export function beltRoute(from:number,p:Pallet):Vec3[] {
  const start=beltStation(from,p),end=beltStation(nextRobot(from,robotCount(p)),p),b=beltBounds(p);
  return from<robotCount(p)-1 ? [start,end] : [start,
    {...start,x:b.right},{x:b.right,y:CONVEYOR.back,z:CONVEYOR.deck},
    {x:b.left,y:CONVEYOR.back,z:CONVEYOR.deck},{x:b.left,y:CONVEYOR.front,z:CONVEYOR.deck},end];
}
export const routeLength=(route:Vec3[])=>route.slice(1).reduce((n,v,i)=>n+Math.hypot(v.x-route[i].x,v.y-route[i].y),0);
export const beltSeconds=(from:number,p:Pallet)=>routeLength(beltRoute(from,p))/CONVEYOR.speed;
export function beltPosition(from:number,p:Pallet,progress:number):Vec3 {
  const route=beltRoute(from,p);let left=routeLength(route)*Math.max(0,Math.min(1,progress));
  for(let i=1;i<route.length;i++) {const a=route[i-1],b=route[i],distance=Math.hypot(b.x-a.x,b.y-a.y);
    if(left<=distance)return {x:a.x+(b.x-a.x)*left/distance,y:a.y+(b.y-a.y)*left/distance,z:CONVEYOR.deck};
    left-=distance;
  }return route.at(-1)!;
}
export function beltPickup(box:Observation,robot:number,p:Pallet) {
  const center=toLocal(beltStation(robot,p),robot,p);
  return {x:center.x-box.size.w/2,y:center.y-box.size.d/2,z:CONVEYOR.deck};
}
export function sourcePickup(w:RelayWorld,box:Observation,robot:number,p:Pallet) {
  return w.boxes.find(b=>b.observation.id===box.id)!.visited.length>1 ? incomingPosition() : beltPickup(box,robot,p);
}
export const hasBeltTransit=(w:RelayWorld)=>w.pads.some(p=>p.boxId&&!p.arrived);
export const nextBeltArrival=(w:RelayWorld)=>Math.min(...w.pads.filter(p=>p.boxId&&!p.arrived).map(p=>p.readyAt));
export function beltProgress(pad:RelayPad,from:number,p:Pallet,time:number) {
  const length=routeLength(beltRoute(from,p)),tail=1000;
  const distance=Math.min(length-tail,Math.max(0,time-pad.departedAt)*CONVEYOR.speed)
    +Math.max(0,time-(pad.readyAt-tail/CONVEYOR.speed))*CONVEYOR.speed;
  return pad.arrived?1:Math.min(1,distance/length);
}
export function advanceConveyor(w:RelayWorld,time:number,running:RelayMotion[]=[]):RelayWorld {
  // Stop 1 m before a station occupied by an already launched robot. New work
  // cannot claim a station with inbound stock. Resume the last metre after exit.
  const delays=w.pads.map((p,i)=>!p.boxId||p.arrived?p.readyAt:Math.max(p.readyAt,...running.filter(m=>m.action.robot===nextRobot(i,w.cells.length)&&m.started+m.action.seconds>time+1e-8).map(m=>m.started+m.action.seconds+1000/CONVEYOR.speed)));
  if(!w.pads.some((p,i)=>p.boxId&&!p.arrived&&(delays[i]!==p.readyAt||p.readyAt<=time+1e-8)))return w;
  const next=structuredClone(w);
  next.pads.forEach((p,i)=>{p.readyAt=delays[i];});
  next.pads.forEach(p=>{if(p.boxId&&!p.arrived&&p.readyAt<=time+1e-8){p.arrived=true;p.version++;}});
  next.time=Math.max(w.time,time);next.revision++;
  return next;
}
