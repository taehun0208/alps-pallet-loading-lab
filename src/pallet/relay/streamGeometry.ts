import {beltBounds,CONVEYOR} from './conveyor';
import {cellPose,toLocal} from './layout';
import type {Pallet,Vec3} from '../types';
import type {RelayBox} from './types';
export const STREAM_SPEED=210;
export function loopLength(p:Pallet){const b=beltBounds(p);return 2*(b.right-b.left+CONVEYOR.front-CONVEYOR.back);}
export function loopPoint(p:Pallet,distance:number):Vec3{
 const b=beltBounds(p),width=b.right-b.left,depth=CONVEYOR.front-CONVEYOR.back,L=2*(width+depth);let arc=((distance%L)+L)%L;
 if(arc<=width)return {x:b.left+arc,y:CONVEYOR.front,z:CONVEYOR.deck};arc-=width;
 if(arc<=depth)return {x:b.right,y:CONVEYOR.front-arc,z:CONVEYOR.deck};arc-=depth;
 if(arc<=width)return {x:b.right-arc,y:CONVEYOR.back,z:CONVEYOR.deck};arc-=width;
 return {x:b.left,y:CONVEYOR.back+arc,z:CONVEYOR.deck};
}
export const beltArc=(b:RelayBox,time:number,speed:number,p:Pallet)=>Math.max(0,time-b.flow!.enteredAt)*speed%loopLength(p);
export const streamPosition=(b:RelayBox,time:number,speed:number,p:Pallet)=>loopPoint(p,Math.max(0,time-b.flow!.enteredAt)*speed);
export const stationArc=(robot:number,p:Pallet)=>cellPose(robot,p).x-beltBounds(p).left;
export function inPickWindow(b:RelayBox,time:number,speed:number,p:Pallet,robot:number){const delta=beltArc(b,time,speed,p)-stationArc(robot,p);return delta>=-1050&&delta<=150;}
export function movingPickup(b:RelayBox,time:number,speed:number,p:Pallet,robot:number){const pt=toLocal(streamPosition(b,time,speed,p),robot,p);return {x:pt.x-b.observation.size.w/2,y:pt.y-b.observation.size.d/2,z:CONVEYOR.deck};}
export const boxRadius=(b:RelayBox)=>Math.hypot(b.observation.size.w,b.observation.size.d)/2;
export function entryClear(box:RelayBox,belt:RelayBox[],time:number,speed:number,p:Pallet){
 const L=loopLength(p);return belt.every(b=>{const d=beltArc(b,time,speed,p);return Math.min(d,L-d)>Math.SQRT2*(boxRadius(box)+boxRadius(b)+100);});
}
