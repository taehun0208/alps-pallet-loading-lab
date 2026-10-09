import {usesBranches,BRANCH} from './branchedConveyor';
import type {Dimensions,Pallet,Vec3} from '../types';
import type {RelayBox} from './types';
import {beltBounds,CONVEYOR} from './conveyor';
import {SCANNER_OFFSET} from './intake';
export interface RejectPlacement {boxId:string;position:Vec3;size:Dimensions}
export interface RejectPallet {index:number;placements:RejectPlacement[]}
export interface RejectLayout {pallets:RejectPallet[];overflow:{boxId:string;reason:string}[]}
const GAP=20;
// Floor-only quarantine: damaged boxes carry no other boxes. No strength inference.
export function rejectLayout(p:Pallet,boxes:readonly RelayBox[]):RejectLayout{
 if(!Number.isFinite(p.width)||!Number.isFinite(p.depth)||p.width<=0||p.depth<=0)throw Error('불량 팔레트 규격이 유효하지 않습니다.');
 const pallets:RejectPallet[]=[],overflow:RejectLayout['overflow']=[],shelves:{x:number;y:number;depth:number}[]=[];
 for(const b of boxes){
  const size=b.observation.size;
  if(!Object.values(size).every(v=>Number.isFinite(v)&&v>0)||size.w>p.width||size.d>p.depth){overflow.push({boxId:b.observation.id,reason:'불량 팔레트 규격 초과 · 별도 대형물 대기'});continue;}
  let placed=false;
  for(let i=0;i<=pallets.length;i++){
   if(i===pallets.length){pallets.push({index:i,placements:[]});shelves.push({x:0,y:0,depth:0});}
   const row=shelves[i];let x=row.x,y=row.y,depth=row.depth;
   if(x+size.w>p.width){x=0;y+=depth+GAP;depth=0;}
   if(y+size.d>p.depth)continue;
   pallets[i].placements.push({boxId:b.observation.id,position:{x,y,z:0},size:{...size}});
   shelves[i]={x:x+size.w+GAP,y,depth:Math.max(depth,size.d)};placed=true;break;
  }
  if(!placed)throw Error('불량 팔레트 분리 배치 실패');
 }
 return {pallets,overflow};
}
// Pallet top -290 mm, deck thickness 115 mm: sits on the factory floor at -405 mm.
export function rejectStation(p:Pallet,index=0):Vec3{
 return {x:beltBounds(p).left+(usesBranches(p)?BRANCH.pusherOffset:SCANNER_OFFSET)+(index%3)*(p.width+350),y:Math.min(CONVEYOR.front-2200,CONVEYOR.back-2000)-Math.floor(index/3)*(p.depth+350),z:-290};
}
export function rejectCenter(p:Pallet,index:number,b:RejectPlacement):Vec3{
 const station=rejectStation(p,index);return {x:station.x-p.width/2+b.position.x+b.size.w/2,y:station.y-p.depth/2+b.position.y+b.size.d/2,z:station.z+b.size.h/2};
}
export function rejectMotion(from:Vec3,to:Vec3,progress:number):Vec3{
 // A separate quarantine transfer animation, not a verified robot/actuator path.
 const t=Math.max(0,Math.min(1,progress)),safe=Math.max(from.z,to.z)+900;
 if(t<.2)return {...from,z:from.z+(safe-from.z)*t/.2};
 if(t<.75){const u=(t-.2)/.55;return {x:from.x+(to.x-from.x)*u,y:from.y+(to.y-from.y)*u,z:safe};}
 return {...to,z:safe+(to.z-safe)*(t-.75)/.25};
}
