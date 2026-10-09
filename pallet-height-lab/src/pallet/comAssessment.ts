import {convexHull,EPS} from './geometry';
import type {Pallet,Placement,Vec3} from './types';

export interface ComAssessment {
 status:'empty'|'invalid'|'inside'|'outside';
 reason:string;
 score:number|null;
 center:Vec3|null;
 mass:number;
 hull:{x:number;y:number}[];
 marginMm:number|null;
 tippingDeg:number|null;
 offsetRatio:number|null;
}
/**
 * Display-only global geometric index for uniformly distributed box masses.
 * The floor-contact hull assumes a coherent stack; it does not establish local
 * contact stability, compression strength, friction, or dynamic robot safety.
 * Score = 100*d/(d+h), d = nonnegative minimum hull clearance, h = CoM height.
 * No fitted thresholds, probability, planner score, or safety certification.
 */
export function assessPalletCom(pallet:Pallet,placements:readonly Placement[]):ComAssessment {
 const blank=(status:ComAssessment['status'],reason:string):ComAssessment=>({status,reason,score:null,center:null,mass:0,hull:[],marginMm:null,tippingDeg:null,offsetRatio:null});
 if(![pallet.width,pallet.depth,pallet.maxHeight].every(n=>Number.isFinite(n)&&n>0))return blank('invalid','팔레트 규격 확인 필요');
 if(!placements.length)return blank('empty','적재 대기');
 if(placements.some(p=>![p.weight,p.size.w,p.size.d,p.size.h].every(n=>Number.isFinite(n)&&n>0)||![p.position.x,p.position.y,p.position.z].every(Number.isFinite)||p.position.z<-EPS))
  return blank('invalid','질량·치수·좌표 확인 필요');
 const mass=placements.reduce((n,p)=>n+p.weight,0);
 const center=placements.reduce((c,p)=>({x:c.x+(p.position.x+p.size.w/2)*(p.weight/mass),y:c.y+(p.position.y+p.size.d/2)*(p.weight/mass),z:c.z+(p.position.z+p.size.h/2)*(p.weight/mass)}),{x:0,y:0,z:0});
 if(!Number.isFinite(mass)||!Object.values(center).every(Number.isFinite))return blank('invalid','계산 가능한 범위 초과');
 const hull=convexHull(placements.filter(p=>Math.abs(p.position.z)<=EPS).flatMap(p=>{
  const x=Math.max(0,p.position.x),y=Math.max(0,p.position.y),right=Math.min(pallet.width,p.position.x+p.size.w),back=Math.min(pallet.depth,p.position.y+p.size.d);
  return right-x>EPS&&back-y>EPS?[{x,y},{x:right,y},{x:right,y:back},{x,y:back}]:[];
 }));
 if(hull.length<3)return {...blank('invalid','팔레트 바닥 접촉 없음'),center,mass};
 const signed=hull.map((a,i)=>{
  const b=hull[(i+1)%hull.length],dx=b.x-a.x,dy=b.y-a.y;
  return (dx*(center.y-a.y)-dy*(center.x-a.x))/Math.hypot(dx,dy);
 });
 const marginMm=Math.min(...signed),inside=marginMm>EPS,d=inside?marginMm:0;
 return {status:inside?'inside':'outside',reason:inside?'지지 외곽 내부':'지지 외곽 경계 또는 밖',center,mass,hull,marginMm,
  score:100*d/(d+center.z),tippingDeg:Math.atan2(d,center.z)*180/Math.PI,
  offsetRatio:Math.hypot((center.x-pallet.width/2)/(pallet.width/2),(center.y-pallet.depth/2)/(pallet.depth/2))};
}
