import { massCenter } from './packaging/spec';
import { orientedSize } from './orientations';
import type { Contact, Dimensions, Orientation, Pallet, Placement, Vec3 } from './types';
export const EPS=1e-6;
export const oriented=(s:Dimensions,o:Orientation):Dimensions=>orientedSize(s,o);
export const volume=(s:Dimensions)=>s.w*s.d*s.h;
export const top=(b:Placement)=>b.position.z+b.size.h;
export function overlapRect(a:{x:number;y:number;w:number;d:number},b:{x:number;y:number;w:number;d:number}){
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(a.x+a.w,b.x+b.w)-x,d=Math.min(a.y+a.d,b.y+b.d)-y;
  return w>EPS&&d>EPS?{x,y,w,d}:null;
}
export const footprint=(b:Placement)=>({x:b.position.x,y:b.position.y,w:b.size.w,d:b.size.d});
export function intersects(a:{position:Vec3;size:Dimensions},b:{position:Vec3;size:Dimensions},gap=0):boolean{
  return a.position.x+a.size.w>b.position.x+EPS-gap&&b.position.x+b.size.w>a.position.x+EPS-gap&&a.position.y+a.size.d>b.position.y+EPS-gap&&b.position.y+b.size.d>a.position.y+EPS-gap&&a.position.z+a.size.h>b.position.z+EPS&&b.position.z+b.size.h>a.position.z+EPS;
}
export function contactsFor(box:Placement,others:Placement[],tolerance:number):Contact[]{
  if(Math.abs(box.position.z)<EPS)return [];
  const contacts=others.filter(b=>Math.abs(top(b)-box.position.z)<=tolerance).flatMap(b=>{const rect=overlapRect(footprint(box),footprint(b));return rect?[{id:b.id,rect,area:rect.w*rect.d,share:0}]:[];});
  const area=contacts.reduce((s,c)=>s+c.area,0);return contacts.map(c=>({...c,share:area?c.area/area:0}));
}
type Point={x:number;y:number};
const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function convexHull(points:Point[]):Point[]{
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);if(sorted.length<=2)return sorted;
  const lower:Point[]=[],upper:Point[]=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower.at(-2)!,lower.at(-1)!,p)<=EPS)lower.pop();lower.push(p);}
  for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper.at(-2)!,upper.at(-1)!,p)<=EPS)upper.pop();upper.push(p);}
  return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
export function centerSupported(box:Placement,contacts:Contact[]):boolean{
  if(box.position.z===0)return true;
  const points=contacts.flatMap(c=>[{x:c.rect.x,y:c.rect.y},{x:c.rect.x+c.rect.w,y:c.rect.y},{x:c.rect.x,y:c.rect.y+c.rect.d},{x:c.rect.x+c.rect.w,y:c.rect.y+c.rect.d}]);
  const hull=convexHull(points),p=massCenter(box);
  return hull.length>=3&&hull.every((a,i)=>cross(a,hull[(i+1)%hull.length],p)>=-EPS);
}
export function calculateLoads(placements:Placement[]):Record<string,number>{
  const loads=Object.fromEntries(placements.map(p=>[p.id,0]));
  for(const b of [...placements].sort((a,b)=>b.position.z-a.position.z||b.id.localeCompare(a.id))){for(const contact of b.supports)if(contact.id in loads)loads[contact.id]+=(b.weight+loads[b.id])*(b.packaging?contact.area/Math.max(EPS,b.supports.reduce((n,c)=>n+c.area,0)):contact.share);}
  return loads;
}
export function withLoads(placements:Placement[]):Placement[]{const loads=calculateLoads(placements);return placements.map(p=>({...p,loadAbove:loads[p.id]}));}
export function landingHeight(x:number,y:number,size:Dimensions,placed:Placement[]):number{
  const rect={x,y,w:size.w,d:size.d};let z=0;
  for(const p of placed)if(overlapRect(rect,footprint(p)))z=Math.max(z,top(p));return z;
}
// Sparse edge alignment, not an exhaustive voxel lattice. Same deterministic cap for every algorithm.
export function sparseOrigins(pallet:Pallet,size:Dimensions,placed:Placement[],gap:number):{x:number;y:number;z:number}[]{
  const keys=new Set<string>(),result:{x:number;y:number;z:number}[]=[];
  const add=(x:number,y:number)=>{if(!Number.isFinite(x)||!Number.isFinite(y))return;const key=`${x.toFixed(4)}:${y.toFixed(4)}`;if(!keys.has(key)){keys.add(key);result.push({x,y,z:landingHeight(x,y,size,placed)});}};
  for(const x of [0,pallet.width-size.w])for(const y of [0,pallet.depth-size.d])add(x,y);
  for(const b of placed){
    const xs=[b.position.x,b.position.x+b.size.w+gap,b.position.x-size.w-gap,b.position.x+b.size.w-size.w],ys=[b.position.y,b.position.y+b.size.d+gap,b.position.y-size.d-gap,b.position.y+b.size.d-size.d];
    for(const x of xs)for(const y of ys)add(x,y);
    for(const x of xs)for(const y of [0,pallet.depth-size.d])add(x,y);
    for(const y of ys)for(const x of [0,pallet.width-size.w])add(x,y);
  }
  return result.sort((a,b)=>a.z-b.z||a.y-b.y||a.x-b.x);
}
