import type {Box,Config,Grasp,Placed,Solid} from './types';
import type {Vec3} from '../types';
import {area,bounds,collides,overlap,transformPoint,wallSolids,worldParts} from './shape';
export function suctionCandidates(box:Box,c:Config,locations?:{x:number;y:number}[]):Grasp[]{
 const b=bounds(box.parts),r=c.cup.diameterMm/2+c.cup.marginMm,out:Grasp[]=[];
 const xs=[b.x+b.w/2,...Array.from({length:7},(_,i)=>b.x+r+(b.w-2*r)*i/6)],ys=[b.y+b.d/2,...Array.from({length:7},(_,i)=>b.y+r+(b.d-2*r)*i/6)];
 for(const {x,y} of locations||xs.flatMap(x=>ys.map(y=>({x,y})))){
  const rect={x:x-r,y:y-r,w:2*r,d:2*r},cover=box.parts.flatMap(p=>{const v=overlap(p,rect);return v?[{...v,z:p.z+p.h}]:[]}),reasons:string[]=[];
  if(rect.x<b.x||rect.y<b.y||rect.x+rect.w>b.x+b.w||rect.y+rect.d>b.y+b.d||area(cover)<4*r*r-1e-4)reasons.push('가장자리·전체 컵 영역 부족');
  const topAt=(px:number,py:number)=>Math.max(-Infinity,...box.parts.filter(p=>px>=p.x-1e-6&&px<=p.x+p.w+1e-6&&py>=p.y-1e-6&&py<=p.y+p.d+1e-6).map(p=>p.z+p.h));
  // Exact arrangement cells of overlapping surface patches, not one centre pixel.
  const gx=[rect.x,rect.x+rect.w,...cover.flatMap(p=>[p.x,p.x+p.w])].sort((a,b)=>a-b),gy=[rect.y,rect.y+rect.d,...cover.flatMap(p=>[p.y,p.y+p.d])].sort((a,b)=>a-b),zs:number[]=[];
  for(let i=1;i<gx.length;i++)for(let j=1;j<gy.length;j++)if(gx[i]>gx[i-1]&&gy[j]>gy[j-1])zs.push(topAt((gx[i]+gx[i-1])/2,(gy[j]+gy[j-1])/2));
  const hi=Math.max(...zs),lo=Math.min(...zs),flatnessMm=hi-lo;
  if(!Number.isFinite(flatnessMm)||flatnessMm>c.cup.flatnessMm||Math.atan2(flatnessMm,2*r)*180/Math.PI>c.cup.angleDeg)reasons.push('컵 전체 평탄도·방향');
  if(box.masks.some(m=>overlap(m,rect)))reasons.push('구멍·찢김 금지 영역');
  const leverMm=Math.hypot(x-box.com.x,y-box.com.y);
  if(box.mass>Math.min(box.suction.maxMassKg,c.gripper.payloadKg)||box.mass*9.80665*leverMm/1000>Math.min(box.suction.maxMomentNm,c.gripper.maxMomentNm))reasons.push('가반 질량·모멘트');
  out.push({point:{x,y,z:Number.isFinite(hi)?hi:b.z+b.h},quality:Math.max(0,1-flatnessMm/Math.max(.01,c.cup.flatnessMm))*.6+.4*Math.max(0,1-leverMm/Math.hypot(b.w,b.d)),flatnessMm,leverMm,valid:reasons.length===0,reasons});
 }return out.sort((a,b)=>Number(b.valid)-Number(a.valid)||b.quality-a.quality).slice(0,64);
}
function sweep(s:Solid,delta:Vec3):Solid{return{x:s.x+Math.min(0,delta.x),y:s.y+Math.min(0,delta.y),z:s.z+Math.min(0,delta.z),w:s.w+Math.abs(delta.x),d:s.d+Math.abs(delta.y),h:s.h+Math.abs(delta.z)};}
export function transport(p:Placed,others:Placed[],grasp:Grasp|null,c:Config):{path:Vec3[];reasons:string[];seconds:number}{
 const g=grasp?.point||{x:p.box.nominal.w/2,y:p.box.nominal.d/2,z:p.box.nominal.h},q=transformPoint(g,p.box,{rotation:p.rotation,position:{x:0,y:0,z:0}}),obstacles=[...others.flatMap(worldParts),...wallSolids(c)];
 const b=bounds(worldParts(p)),safe=Math.max(c.pallet.maxHeight,...obstacles.map(s=>s.z+s.h),b.z+b.h)+150;
 const pickup={x:-800,y:-500,z:0},lift={...pickup,z:safe},overX={x:p.position.x,y:pickup.y,z:safe},over={...p.position,z:safe};
 // Box-origin coordinates. All segments axis-aligned; swept compound AABBs are exact for translation.
 const path=[lift,pickup,lift,lift,overX,over,{...p.position},over],reasons:string[]=[];
 if(safe+q.z+c.gripper.height>c.workspaceHeight)reasons.push('path');
 for(let i=1;i<path.length;i++){
  const start=path[i-1],end=path[i],delta={x:end.x-start.x,y:end.y-start.y,z:end.z-start.z},carrying=i>=2&&i<=6;
  const segmentQ=i<=2?g:q;const solids=carrying?worldParts({...p,rotation:i<=2?0:p.rotation,position:start}):[];
  solids.push({x:start.x+segmentQ.x-c.gripper.width/2,y:start.y+segmentQ.y-c.gripper.depth/2,z:start.z+segmentQ.z+c.gripper.clearance,w:c.gripper.width,d:c.gripper.depth,h:c.gripper.height});
  if(solids.some(s=>obstacles.some(o=>collides(sweep(s,delta),o,c.penetrationMm))))reasons.push('path');
  // Retreat must clear the released box as well (cup contact excluded by clearance).
  if(i===7&&solids.some(s=>worldParts(p).some(o=>collides(sweep(s,delta),o,c.penetrationMm))))reasons.push('path');
 }
 const length=path.slice(1).reduce((s,v,i)=>s+Math.hypot(v.x-path[i].x,v.y-path[i].y,v.z-path[i].z),0);
 // 90-degree yaw is performed in the cleared pickup column before translation.
 if(p.rotation){const radius=Math.hypot(p.box.nominal.w,p.box.nominal.d)+Math.max(c.gripper.width,c.gripper.depth),rotSweep={x:pickup.x-radius,y:pickup.y-radius,z:safe,w:2*radius,d:2*radius,h:b.h+c.gripper.height};if(obstacles.some(o=>collides(rotSweep,o,c.penetrationMm)))reasons.push('path');}
 return{path,reasons:[...new Set(reasons)],seconds:length/c.gripper.speedMmS+2+(p.rotation?0.5:0)};
}
