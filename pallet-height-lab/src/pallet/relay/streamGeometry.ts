import {usesBranches,branchPosition,branchReady,forkArc,BRANCH} from './branchedConveyor';
import {usesRoller,rollerPoint,atRollerStop} from './rollerQueue';
import {beltBounds,CONVEYOR} from './conveyor';
import {cellPose,toLocal} from './layout';
import type {Pallet,Vec3} from '../types';
import type {RelayBox} from './types';
export const STREAM_SPEED=210;
export function loopLength(p:Pallet){const b=beltBounds(p);return p.conveyorMode==='straight'||usesBranches(p)?b.right-b.left:2*(b.right-b.left+CONVEYOR.front-CONVEYOR.back);}
export function loopPoint(p:Pallet,distance:number):Vec3{
 const b=beltBounds(p),width=b.right-b.left,depth=CONVEYOR.front-CONVEYOR.back,L=2*(width+depth);let arc=((distance%L)+L)%L;
 if(p.conveyorMode==='straight')return {x:b.left+Math.max(0,Math.min(width,distance)),y:CONVEYOR.front,z:CONVEYOR.deck};
 if(arc<=width)return {x:b.left+arc,y:CONVEYOR.front,z:CONVEYOR.deck};arc-=width;
 if(arc<=depth)return {x:b.right,y:CONVEYOR.front-arc,z:CONVEYOR.deck};arc-=depth;
 if(arc<=width)return {x:b.right-arc,y:CONVEYOR.back,z:CONVEYOR.deck};arc-=width;
 return {x:b.left,y:CONVEYOR.back+arc,z:CONVEYOR.deck};
}
export const beltArc=(b:RelayBox,time:number,speed:number,p:Pallet)=>usesBranches(p)&&b.flow?.transport?Math.min(b.flow.transport.limit,b.flow.transport.arc+Math.max(0,time-b.flow.transport.at)*speed):usesRoller(p)&&b.flow?.roller?Math.min(b.flow.roller.limit,b.flow.roller.arc+Math.max(0,time-b.flow.roller.at)*160):p.conveyorMode==='straight'?Math.max(0,time-b.flow!.enteredAt)*speed:Math.max(0,time-b.flow!.enteredAt)*speed%loopLength(p);
export const streamPosition=(b:RelayBox,time:number,speed:number,p:Pallet)=>usesBranches(p)?branchPosition(b,time,speed,p):usesRoller(p)?rollerPoint(p,beltArc(b,time,speed,p)):loopPoint(p,Math.max(0,time-b.flow!.enteredAt)*speed);
export const stationArc=(robot:number,p:Pallet)=>cellPose(robot,p).x-beltBounds(p).left;
export function inPickWindow(b:RelayBox,time:number,speed:number,p:Pallet,robot:number){if(usesBranches(p)){const t=b.flow?.transport;return !!t&&(t.kind==='branch'?branchReady(b,robot):t.robot===undefined&&forkArc(robot,p)>t.arc+boxRadius(b)+BRANCH.gap);}if(usesRoller(p))return atRollerStop(b,p);const delta=beltArc(b,time,speed,p)-stationArc(robot,p);return delta>=-1050&&delta<=150;}
export function movingPickup(b:RelayBox,time:number,speed:number,p:Pallet,robot:number){const pt=toLocal(streamPosition(b,time,speed,p),robot,p);return {x:pt.x-b.observation.size.w/2,y:pt.y-b.observation.size.d/2,z:pt.z};}
export const boxRadius=(b:RelayBox)=>Math.hypot(b.observation.size.w,b.observation.size.d)/2;
export function entryClear(box:RelayBox,belt:RelayBox[],time:number,speed:number,p:Pallet){
 if(usesBranches(p))return belt.filter(b=>b.flow?.transport?.kind==='main').every(b=>beltArc(b,time,speed,p)>Math.SQRT2*(boxRadius(box)+boxRadius(b)+100));
 const L=loopLength(p);return belt.every(b=>{const d=beltArc(b,time,speed,p);return (p.conveyorMode==='straight'?d:Math.min(d,L-d))>Math.SQRT2*(boxRadius(box)+boxRadius(b)+100);});
}
