import { localSpan } from './interior';
import { orientationRank } from './orientations';
import { edgeContact } from './compactPacking';
import { sparseOrigins,landingHeight,contactsFor,centerSupported,intersects,EPS } from './geometry';
import type { Dimensions,Pallet,Placement,Vec3,Orientation,Constraints } from './types';
import { stability } from './stability';
import { standingHeight } from './standingHeight';
export interface RawCandidate {position:Vec3;size:Dimensions;orientation:Orientation;balanceTarget?:boolean}
// Counter-moment locations are search hints. Full reactions, contact area and strength are rechecked.
export function balancedOrigins(size:Dimensions,placed:Placement[],weight:number):Vec3[]{
 const assessments=stability(placed).supports,result:Vec3[]=[];
 for(const b of placed){if(size.w>b.size.w||size.d>b.size.d)continue;const s=assessments.find(s=>s.id===b.id)!;
  const targets=[{x:b.position.x+b.size.w/2,y:b.position.y+b.size.d/2},{x:(s.supportCenter.x*(s.mass+weight)-s.center.x*s.mass)/weight,y:(s.supportCenter.y*(s.mass+weight)-s.center.y*s.mass)/weight}];
  for(const target of targets){const x=Math.max(b.position.x,Math.min(b.position.x+b.size.w-size.w,target.x-size.w/2)),y=Math.max(b.position.y,Math.min(b.position.y+b.size.d-size.d,target.y-size.d/2));result.push({x,y,z:landingHeight(x,y,size,placed)});}
 }return result;
}
// Edge projections across different boxes recover corners absent from same-box alignment.
// A project-specific top-down variant, not a reproduction of the published 3D EP algorithm.
export function frontierOrigins(p:Pallet,size:Dimensions,placed:Placement[],gap:number):Vec3[]{
 const result=sparseOrigins(p,size,placed,gap),keys=new Set(result.map(v=>`${v.x.toFixed(4)}:${v.y.toFixed(4)}`));
 const xs=new Set([0,p.width-size.w]),ys=new Set([0,p.depth-size.d]);
 for(const b of placed){for(const x of [b.position.x,b.position.x+b.size.w+gap,b.position.x-size.w-gap,b.position.x+b.size.w-size.w])if(x>=-EPS&&x+size.w<=p.width+EPS)xs.add(x);for(const y of [b.position.y,b.position.y+b.size.d+gap,b.position.y-size.d-gap,b.position.y+b.size.d-size.d])if(y>=-EPS&&y+size.d<=p.depth+EPS)ys.add(y);}
 for(const x of xs)for(const y of ys){const key=`${x.toFixed(4)}:${y.toFixed(4)}`;if(!keys.has(key)){keys.add(key);result.push({x,y,z:landingHeight(x,y,size,placed)});}}
 return result;
}
const order=(a:RawCandidate,b:RawCandidate)=>a.position.z-b.position.z||Number(!!b.balanceTarget)-Number(!!a.balanceTarget)||a.position.y-b.position.y||a.position.x-b.position.x||orientationRank(a.orientation)-orientationRank(b.orientation);
export function geometricFeasible(r:RawCandidate,placed:Placement[],p:Pallet,c:Constraints){
 const {position:v,size:s}=r;if(v.x< -EPS||v.y< -EPS||v.x+s.w>p.width+EPS||v.y+s.d>p.depth+EPS||v.z+s.h>p.maxHeight+EPS)return false;
 if(placed.some(b=>intersects(r,b,c.horizontalGap)))return false;
 if(!standingHeight(r,placed,c).valid)return false;
 if(v.z===0)return true;
 const b={...r,id:'probe',typeId:'',weight:1,supports:[],supportRatio:0,loadAbove:0},contacts=contactsFor(b,placed,c.contactTolerance);
 return contacts.reduce((n,s)=>n+s.area,0)/(s.w*s.d)+EPS>=c.supportRatio&&centerSupported(b,contacts);
}
// Apply the detailed budget after cheap geometric rejection; preserve layers and floor quadrants.
export function diverseBudget(raw:RawCandidate[],placed:Placement[],p:Pallet,c:Constraints,limit:number,compact=false,interior=false){
 const rank=compact?(a:RawCandidate,b:RawCandidate)=>a.position.z-b.position.z||(interior?localSpan(a,placed)-localSpan(b,placed):0)||edgeContact(b,placed,p,!interior)-edgeContact(a,placed,p,!interior)||order(a,b):order;
 const feasible=raw.filter(r=>geometricFeasible(r,placed,p,c)).sort(rank),groups=new Map<string,RawCandidate[]>();
 for(const r of feasible){const q=Number(r.position.x+r.size.w/2>=p.width/2)+2*Number(r.position.y+r.size.d/2>=p.depth/2),key=`${r.position.z}:${r.orientation}:${q}`;groups.set(key,[...(groups.get(key)||[]),r]);}
 const chosen:RawCandidate[]=[],lists=[...groups.values()];for(let i=0;chosen.length<limit;i++){let any=false;for(const list of lists)if(list[i]&&chosen.length<limit){chosen.push(list[i]);any=true;}if(!any)break;}
 // When nothing fits, diagnose actual on-pallet attempts before irrelevant negative/outside origins.
 // Do not include height here: over-height attempts are essential evidence for a height blockage.
 const onPallet=(r:RawCandidate)=>r.position.x>=-EPS&&r.position.y>=-EPS&&r.position.x+r.size.w<=p.width+EPS&&r.position.y+r.size.d<=p.depth+EPS;
 const rejectedOrder=(a:RawCandidate,b:RawCandidate)=>Number(onPallet(b))-Number(onPallet(a))||order(a,b);
 const selected=new Set(chosen);for(const r of [...raw].sort(rejectedOrder))if(chosen.length<limit&&!selected.has(r)&&!geometricFeasible(r,placed,p,c)){chosen.push(r);selected.add(r);}
 return chosen.sort(order);
}
