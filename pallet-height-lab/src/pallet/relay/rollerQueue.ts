import type {Pallet,Vec3} from '../types';
import type {RelayBox} from './types';
import {beltBounds,CONVEYOR} from './conveyor';
import {robotCount} from './fleet';
export const ROLLER={length:2400,deck:250,gap:100,speed:160} as const;
export const usesRoller=(p:Pallet)=>p.conveyorMode==='straight'&&robotCount(p)===1;
export const transportLength=(p:Pallet)=>beltBounds(p).right-beltBounds(p).left+ROLLER.length;
export const footprint=(b:RelayBox)=>Math.hypot(b.observation.size.w,b.observation.size.d);
export const stopArc=(b:RelayBox,p:Pallet)=>transportLength(p)-footprint(b)/2;
export function rollerPoint(p:Pallet,arc:number):Vec3 {
 const b=beltBounds(p),belt=b.right-b.left,t=Math.max(0,Math.min(1,(arc-belt)/ROLLER.length));
 return {x:b.left+Math.max(0,Math.min(transportLength(p),arc)),y:CONVEYOR.front,z:arc<=belt?CONVEYOR.deck:CONVEYOR.deck+(ROLLER.deck-CONVEYOR.deck)*t};
}
export interface QueueItem{id:string;arc:number;length:number;held?:boolean}
export function advanceQueue(items:QueueItem[],end:number,travel:number,gap:number=ROLLER.gap){
 if(!Number.isFinite(end)||!Number.isFinite(travel)||travel<0||!Number.isFinite(gap)||gap<0)throw Error('Invalid roller queue settings');
 const ids=new Set<string>();let ahead:QueueItem|undefined;
 return [...items].sort((a,b)=>b.arc-a.arc).map(item=>{
  if(ids.has(item.id)||!Number.isFinite(item.arc)||!Number.isFinite(item.length)||item.length<=0)throw Error('Invalid roller queue item');ids.add(item.id);
  const limit=Math.min(end-item.length/2,ahead?ahead.arc-(ahead.length+item.length)/2-gap:Infinity);
  if(limit<item.arc-1e-7)throw Error('Roller queue overlap');
  const arc=item.held?item.arc:Math.min(limit,item.arc+travel);ahead={...item,arc};return {...ahead,limit};
 });
}
export function atRollerStop(b:RelayBox,p:Pallet){return !!b.flow?.roller&&Math.abs(b.flow.roller.arc-stopArc(b,p))<.01;}
