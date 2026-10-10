import { top,volume } from './geometry';
import type { Placement } from './types';
type Box=Pick<Placement,'position'|'size'>;
const cache=new WeakMap<Placement[],ReturnType<typeof calculate>>();
// Exact integration over box-bottom/top height bands. Counts empty space inside each
// band's bounding rectangle, including open notches, not just sealed air pockets.
function calculate(boxes:Box[]){
 const levels=[...new Set(boxes.flatMap(b=>[b.position.z,b.position.z+b.size.h]))].sort((a,b)=>a-b);let envelope=0;
 for(let i=1;i<levels.length;i++){const lo=levels[i-1],hi=levels[i],active=boxes.filter(b=>b.position.z<hi&&b.position.z+b.size.h>lo);if(!active.length)continue;
  const x0=Math.min(...active.map(b=>b.position.x)),x1=Math.max(...active.map(b=>b.position.x+b.size.w)),y0=Math.min(...active.map(b=>b.position.y)),y1=Math.max(...active.map(b=>b.position.y+b.size.d));envelope+=(x1-x0)*(y1-y0)*(hi-lo);
 }
 const occupied=boxes.reduce((n,b)=>n+volume(b.size),0);return {envelope,voidVolume:Math.max(0,envelope-occupied),fill:envelope?occupied/envelope:0};
}
export function interiorSpace(boxes:Placement[]){let value=cache.get(boxes);if(!value){value=calculate(boxes);cache.set(boxes,value);}return value;}
export const interiorAfter=(boxes:Placement[],b:Box)=>calculate([...boxes,b]);
// Cheap local footprint-span cost used only to order the finite candidate budget.
export function localSpan(b:Box,placed:Placement[]){
 const active=placed.filter(p=>p.position.z<=b.position.z&&top(p)>b.position.z),xs=[b.position.x,...active.map(p=>p.position.x)],ys=[b.position.y,...active.map(p=>p.position.y)];
 const w=Math.max(b.position.x+b.size.w,...active.map(p=>p.position.x+p.size.w))-Math.min(...xs),d=Math.max(b.position.y+b.size.d,...active.map(p=>p.position.y+p.size.d))-Math.min(...ys);
 return w*d-b.size.w*b.size.d-active.reduce((n,p)=>n+p.size.w*p.size.d,0);
}
