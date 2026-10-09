import type { Constraints,Vec3 } from './types';
// Horizontal annular TCP envelope, not inverse kinematics or a robot-arm link model.
export function withinReach(a:Vec3,b:Vec3,r:NonNullable<Constraints['reach']>){
 const ax=a.x-r.baseX,ay=a.y-r.baseY,bx=b.x-r.baseX,by=b.y-r.baseY,dx=bx-ax,dy=by-ay;
 const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
 const nearest=Math.hypot(ax+t*dx,ay+t*dy),farthest=Math.max(Math.hypot(ax,ay),Math.hypot(bx,by));
 return nearest+1e-6>=r.minRadius&&farthest<=r.maxRadius+1e-6;
}
export function yawEnvelope(w:number,d:number,from:number,to:number){
 const extent=(a:number)=>w*Math.abs(Math.cos(a))+d*Math.abs(Math.sin(a));
 const angles=[from,to].map(v=>v*Math.PI/180),lo=Math.min(...angles),hi=Math.max(...angles);
 const extrema=[Math.atan2(d,w),Math.atan2(w,d)];
 for(const e of extrema)for(let k=-2;k<=2;k++){const a=e+k*Math.PI/2;if(a>=lo&&a<=hi)angles.push(a);}
 return {w:Math.max(...angles.map(extent)),d:Math.max(...angles.map(a=>extent(Math.PI/2-a)))};
}
