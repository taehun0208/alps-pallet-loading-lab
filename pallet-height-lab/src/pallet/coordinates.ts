import type { Dimensions, Pallet, Vec3 } from './types';
export const mmToM=(value:number)=>value/1000;
export function engineToRender(v:Vec3,p:Pallet):[number,number,number]{return [(v.x-p.width/2)/1000,v.z/1000,(v.y-p.depth/2)/1000];}
export function renderToEngine(v:readonly number[],p:Pallet):Vec3{return {x:v[0]*1000+p.width/2,y:v[2]*1000+p.depth/2,z:v[1]*1000};}
export function renderSize(s:Dimensions):[number,number,number]{return [s.w/1000,s.h/1000,s.d/1000];}
export const centerOf=(position:Vec3,size:Dimensions):Vec3=>({x:position.x+size.w/2,y:position.y+size.d/2,z:position.z+size.h/2});
