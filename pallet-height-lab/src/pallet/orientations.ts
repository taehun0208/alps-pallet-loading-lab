import type { Dimensions,Orientation,Handling,Vec3 } from './types';
export const ALL_ORIENTATIONS:Orientation[]=[0,90,'whd','hwd','hdw','dhw'];
export const isStanding=(o:Orientation)=>typeof o==='string';
export const orientationRank=(o:Orientation)=>ALL_ORIENTATIONS.indexOf(o);
export const orientationYaw=(o:Orientation)=>o===90||o==='hwd'||o==='dhw'?90:0;
export const verticalAxis=(o:Orientation):'w'|'d'|'h'=>o==='hdw'||o==='dhw'?'w':o==='whd'||o==='hwd'?'d':'h';
export const orientationLabel=(o:Orientation)=>({0:'높이축 유지 · 0°',90:'높이축 유지 · 90°',whd:'깊이축 세움 · 0°',hwd:'깊이축 세움 · 90°',hdw:'가로축 세움 · 0°',dhw:'가로축 세움 · 90°'}[o]);
export function orientedSize(s:Dimensions,o:Orientation):Dimensions{
 const axes:Record<Orientation,[number,number,number]>={0:[s.w,s.d,s.h],90:[s.d,s.w,s.h],whd:[s.w,s.h,s.d],hwd:[s.h,s.w,s.d],hdw:[s.h,s.d,s.w],dhw:[s.d,s.h,s.w]};
 const [w,d,h]=axes[o];return {w,d,h};
}
export function originalSize(s:Dimensions,o:Orientation):Dimensions{
 const axes:Record<Orientation,Dimensions>={0:{...s},90:{w:s.d,d:s.w,h:s.h},whd:{w:s.w,d:s.h,h:s.d},hwd:{w:s.d,d:s.h,h:s.w},hdw:{w:s.h,d:s.d,h:s.w},dhw:{w:s.h,d:s.w,h:s.d}};return axes[o];
}
// Right-handed box pose expressed in engine coordinates (z up), keeping one fixed grasp face.
export function poseVector(v:Vec3,o:Orientation):Vec3{
 let p=verticalAxis(o)==='w'?{x:-v.z,y:v.y,z:v.x}:verticalAxis(o)==='d'?{x:v.x,y:-v.z,z:v.y}:{...v};
 if(orientationYaw(o))p={x:p.y,y:-p.x,z:p.z};return p;
}
export function allowedOrientations(size:Dimensions,allowed:Orientation[],handling?:Handling,axisLoads?:Partial<Record<'w'|'d'|'h',number>>){
 const seen=new Set<string>();return allowed.filter(o=>{if(handling==='upright'&&isStanding(o))return false;const s=orientedSize(size,o),key=`${s.w}:${s.d}:${s.h}:${axisLoads?verticalAxis(o):''}`;if(seen.has(key))return false;seen.add(key);return true;});
}
export function standingPermissions(allowed:Orientation[],enabled=true):Orientation[]{
 const flat=allowed.filter(o=>!isStanding(o));if(!enabled)return flat.length?flat:[0];
 const result=[...allowed];if(allowed.includes(0))result.push('whd','hdw');if(allowed.includes(90))result.push('hwd','dhw');return [...new Set(result)];
}
