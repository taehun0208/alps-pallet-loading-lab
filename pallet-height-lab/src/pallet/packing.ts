import { overlapRect,footprint,volume,top,EPS,calculateLoads,oriented } from './geometry';
import { materialInfo } from './materials';
import { allowedOrientations } from './orientations';
import type { Placement,PlanningInput,BoxType } from './types';
const fits=(type:BoxType,w:number,d:number,h:number)=>allowedOrientations(type.size,type.orientations,type.handling,type.maxLoadByAxis).some(r=>{const v=oriented(type.size,r);return v.w<=w+EPS&&v.d<=d+EPS&&v.h<=h+EPS;});
// Side contact measures actual overlapping face area; unequal box heights are allowed.
// This is a compactness reward, never a structural tie or an extra support surface.
export function packingQuality(b:Placement,input:PlanningInput){
 const p=b.position,s=b.size,t=top(b);let area=0;
 for(const other of input.placements){const o=other.position,height=Math.max(0,Math.min(t,top(other))-Math.max(p.z,o.z));if(!height)continue;
  if(Math.abs(p.x+s.w-o.x)<=EPS||Math.abs(o.x+other.size.w-p.x)<=EPS)area+=height*Math.max(0,Math.min(p.y+s.d,o.y+other.size.d)-Math.max(p.y,o.y));
  if(Math.abs(p.y+s.d-o.y)<=EPS||Math.abs(o.y+other.size.d-p.y)<=EPS)area+=height*Math.max(0,Math.min(p.x+s.w,o.x+other.size.w)-Math.max(p.x,o.x));
 }
 const demand=input.types.reduce((n,t)=>n+(input.remaining[t.id]||0)*volume(t.size),0);const loads=calculateLoads(input.placements);let lostDemand=0;
 for(const type of input.types){const q=input.remaining[type.id]||0;if(!q||type.size.w*type.size.d<=s.w*s.d*1.1)continue;
  const destroyed=b.supports.some(contact=>{const base=input.placements.find(p=>p.id===contact.id)!;const capacity=materialInfo(base,input.constraints.stability).capacity,headroom=input.pallet.maxHeight-top(base);if(!fits(type,base.size.w,base.size.d,headroom)||capacity!==null&&loads[base.id]+type.weight>capacity)return false;
   const cut=overlapRect(footprint(base),footprint(b));if(!cut)return false;const x=base.position.x,y=base.position.y,w=base.size.w,d=base.size.d;
   return ![[cut.x-x,d],[x+w-cut.x-cut.w,d],[w,cut.y-y],[w,y+d-cut.y-cut.d]].some(([w,d])=>fits(type,w,d,headroom));
  });if(destroyed)lostDemand+=q*volume(type.size);
 }
 return {contactRatio:Math.min(1,area/(2*s.h*(s.w+s.d))),futureSurfacePenalty:demand?lostDemand/demand:0};
}
