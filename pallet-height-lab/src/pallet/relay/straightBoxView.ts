import {usesBranches,mainY} from './branchedConveyor';
import {usesRoller,ROLLER} from './rollerQueue';
import {beltBounds,CONVEYOR} from './conveyor';
import type {Dimensions,Pallet,Vec3} from '../types';
import type {RelayBox,RelayMotion} from './types';
// Render-only: do not classify waiting cartons as successfully placed cartons.
export function isSingleStraight(p:Pallet){return p.conveyorMode==='straight'&&p.robotLayout?.count===1;}
export function transportDisplay(b:RelayBox|undefined,motions:readonly RelayMotion[]){return b?.status==='reserved'&&motions.some(m=>m.action.boxId===b.observation.id);}
export function onBeltDisplay(b:RelayBox){return b.status==='belt'||b.status==='rejecting';}
export function exitDisplayCenter(p:Pallet,size:Dimensions,boxes:readonly RelayBox[]):Vec3 {
 const widest=Math.max(size.w,...boxes.map(b=>b.observation.size.w));
 // The last moving carton can extend half its width beyond the end.
 // Keep a real gap to the full stationary carton, not merely to its centre.
 return {x:beltBounds(p).right+(usesRoller(p)?ROLLER.length:0)+widest/2+size.w/2+100,y:usesBranches(p)?mainY:CONVEYOR.front,z:CONVEYOR.deck+size.h/2};
}
