import type {Box,Config,Damage,Observed,Placed,Pose,Rect,Solid} from './types';
import type {Dimensions,Vec3} from '../types';
export const EPS=1e-6;
export function rng(seed:number){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=Math.imul(a^(a>>>15),1|a);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
export function hash(seed:number,id:string,rev=0){for(const c of id)seed=Math.imul(seed^c.charCodeAt(0),16777619);return(seed^Math.imul(rev+1,2654435761))>>>0;}
export function overlap(a:Rect,b:Rect):Rect|null {const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(a.x+a.w,b.x+b.w)-x,d=Math.min(a.y+a.d,b.y+b.d)-y;return w>EPS&&d>EPS?{x,y,w,d}:null;}
export function disjoint(rects:Rect[]):Rect[]{
 const xs=[...new Set(rects.flatMap(r=>[r.x,r.x+r.w]))].sort((a,b)=>a-b),out:Rect[]=[];
 for(let i=1;i<xs.length;i++){const x=xs[i-1],w=xs[i]-x,ys=rects.filter(r=>r.x<x+w-EPS&&r.x+r.w>x+EPS).map(r=>[r.y,r.y+r.d]).sort((a,b)=>a[0]-b[0]);let lo=0,hi=0,active=false;
  for(const [a,b] of ys){if(!active){lo=a;hi=b;active=true;}else if(a<=hi+EPS)hi=Math.max(hi,b);else{out.push({x,y:lo,w,d:hi-lo});lo=a;hi=b;}}if(active)out.push({x,y:lo,w,d:hi-lo});
 }return out;
}
export const area=(r:Rect[])=>disjoint(r).reduce((s,v)=>s+v.w*v.d,0);
export function bounds(parts:Solid[]):Solid {const x=Math.min(...parts.map(p=>p.x)),y=Math.min(...parts.map(p=>p.y)),z=Math.min(...parts.map(p=>p.z));return{x,y,z,w:Math.max(...parts.map(p=>p.x+p.w))-x,d:Math.max(...parts.map(p=>p.y+p.d))-y,h:Math.max(...parts.map(p=>p.z+p.h))-z};}
export function occupied(parts:Solid[]){const zs=[...new Set(parts.flatMap(p=>[p.z,p.z+p.h]))].sort((a,b)=>a-b);let v=0;for(let i=1;i<zs.length;i++)v+=area(parts.filter(p=>p.z<zs[i]-EPS&&p.z+p.h>zs[i-1]+EPS))*(zs[i]-zs[i-1]);return v;}
export function volumes(box:Box,rotation:0|90=0){const b=bounds(worldParts({box,rotation,position:{x:0,y:0,z:0}}));return{nominalVolume:box.nominal.w*box.nominal.d*box.nominal.h,occupiedVolume:occupied(box.parts),envelopeVolume:b.w*b.d*b.h,method:'복합 직육면체 합집합의 외형 체적 · mm³'};}
export function shape(size:Dimensions,damage:Damage,amount:number):Solid[]{
 const {w,d,h}=size,a=Math.min(amount,h*.35,w*.2,d*.2);
 if(damage==='normal'||damage==='tear'||a===0)return[{x:0,y:0,z:0,w,d,h}];
 const parts:Solid[]=[];const n=4;
 for(let ix=0;ix<n;ix++)for(let iy=0;iy<n;iy++){
  let x=ix*w/n,y=iy*d/n,z=0,pw=w/n,pd=d/n,top=h;
  if(damage==='corner'&&ix===0&&iy===0){x+=a;pw-=a;top-=a;}
  if(damage==='dent'&&ix>=1&&ix<=2&&iy>=1&&iy<=2)top-=a;
  if(damage==='bulge'&&ix===n-1&&iy>=1&&iy<=2)pw+=a;
  if(damage==='bottom'&&(ix+iy)%3!==0)z=a;
  parts.push({x,y,z,w:pw,d:pd,h:top-z});
 }return parts;
}
export function transformPoint(v:Vec3,b:Box,pose:Pose):Vec3 {return pose.rotation===90?{x:pose.position.x+b.nominal.d-v.y,y:pose.position.y+v.x,z:pose.position.z+v.z}:{x:pose.position.x+v.x,y:pose.position.y+v.y,z:pose.position.z+v.z};}
export function worldParts(p:Placed):Solid[]{return p.box.parts.map(s=>p.rotation===90?{x:p.position.x+p.box.nominal.d-s.y-s.d,y:p.position.y+s.x,z:p.position.z+s.z,w:s.d,d:s.w,h:s.h}:{...s,x:s.x+p.position.x,y:s.y+p.position.y,z:s.z+p.position.z});}
export function collides(a:Solid,b:Solid,tol=0){return Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>tol&&Math.min(a.y+a.d,b.y+b.d)-Math.max(a.y,b.y)>tol&&Math.min(a.z+a.h,b.z+b.h)-Math.max(a.z,b.z)>tol;}
export function makeBoxes(c:Config):Box[]{const random=rng(c.seed);return Array.from({length:c.count},(_,i)=>{
 const size={w:Math.round(240+random()*400),d:Math.round(220+random()*300),h:Math.round(180+random()*280)};
 const damage=c.damageKinds[i%c.damageKinds.length],mass=+(2+random()*13).toFixed(2);
 return{id:'B'+String(i+1).padStart(3,'0'),nominal:size,parts:shape(size,damage,c.deformation),mass,com:{x:size.w/2,y:size.d/2,z:size.h/2},rotations:[0,90],friction:.4+random()*.3,
 strength:{topLoadKg:Math.round(15+random()*75),residual:i%4===0?c.materialResidual:1,source:'assumption',note:'사용자 수정 가능한 합성 직접 상부하중 kg; 변형과 독립'},
 damage,shapeDamage:damage==='normal'?[]:[{kind:damage,region:damage==='corner'?{x:0,y:0,z:0,w:size.w/4,d:size.d/4,h:size.h}:damage==='dent'?{x:size.w/4,y:size.d/4,z:size.h-c.deformation,w:size.w/2,d:size.d/2,h:c.deformation||1}:damage==='bulge'?{x:size.w*3/4,y:size.d/4,z:0,w:size.w/4+c.deformation,d:size.d/2,h:size.h}:{x:0,y:0,z:0,...size}}],masks:damage==='tear'?[{x:size.w*.35,y:size.d*.35,w:size.w*.3,d:size.d*.3}]:[],arrival:i,color:['#d5b183','#80b7b0','#9aafc9','#b7a7bf','#b8c69c','#c79686'][i%6],
 suction:{seal:'unknown',maxMassKg:35,maxMomentNm:12}};});}
export function observe(p:Placed,c:Config,revision:number):Observed {
 const random=rng(hash(c.seed,p.box.id,revision)),noise=(v:number)=>(random()*2-1)*v;
 const dx=noise(c.noise.dimensionMm),dy=noise(c.noise.dimensionMm),dz=noise(c.noise.dimensionMm),box=structuredClone(p.box),n=box.nominal;
 box.parts=box.parts.map(s=>({...s,x:s.x*(1+dx/n.w),y:s.y*(1+dy/n.d),w:s.w*(1+dx/n.w),d:s.d*(1+dy/n.d),h:Math.max(1,s.h+dz+noise(c.noise.surfaceMm))}));
 box.nominal={w:n.w+dx,d:n.d+dy,h:n.h+dz};
 const yawErrorDeg=noise(c.noise.yawDeg),theta=yawErrorDeg*Math.PI/180;
 // Observed yaw is conservatively rasterised into per-part AABBs, never read from true geometry by the planner.
 if(theta)box.parts=box.parts.map(s=>{const points=[[s.x,s.y],[s.x+s.w,s.y],[s.x,s.y+s.d],[s.x+s.w,s.y+s.d]].map(([x,y])=>({x:n.w/2+(x-n.w/2)*Math.cos(theta)-(y-n.d/2)*Math.sin(theta),y:n.d/2+(x-n.w/2)*Math.sin(theta)+(y-n.d/2)*Math.cos(theta)}));const x=Math.min(...points.map(v=>v.x)),y=Math.min(...points.map(v=>v.y));return{...s,x,y,w:Math.max(...points.map(v=>v.x))-x,d:Math.max(...points.map(v=>v.y))-y};});
 return{box,rotation:p.rotation,position:{x:p.position.x+noise(c.noise.positionMm),y:p.position.y+noise(c.noise.positionMm),z:p.position.z+noise(c.noise.positionMm)},yawErrorDeg,revision};
}
export function wallSolids(c:Config):Solid[]{if(c.environment==='pallet')return[];const{width:w,depth:d,maxHeight:h}=c.pallet,t=20;return[...(c.walls.left?[{x:-t,y:0,z:0,w:t,d,h}]:[]),...(c.walls.right?[{x:w,y:0,z:0,w:t,d,h}]:[]),...(c.walls.back?[{x:0,y:d,z:0,w,d:t,h}]:[])];}
