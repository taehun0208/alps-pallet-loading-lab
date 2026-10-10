import { top,volume,overlapRect,footprint,EPS } from './geometry';
import type { Placement,Pallet,PlanningInput,Candidate } from './types';
import { interiorAfter,interiorSpace } from './interior';

// A geometric packing preference, not a claim that adjacent sides carry vertical load.
export function edgeContact(b:Pick<Placement,'position'|'size'>,placed:Placement[],p:Pallet,boundary=true){
 const a=b.position,s=b.size;let length=0;
 if(boundary&&(Math.abs(a.x)<EPS||Math.abs(a.x+s.w-p.width)<EPS))length+=s.d;
 if(boundary&&(Math.abs(a.y)<EPS||Math.abs(a.y+s.d-p.depth)<EPS))length+=s.w;
 for(const o of placed){if(top(o)<=a.z+EPS||o.position.z>=a.z+s.h-EPS)continue;
  if(Math.abs(a.x+s.w-o.position.x)<EPS||Math.abs(o.position.x+o.size.w-a.x)<EPS)length+=Math.max(0,Math.min(a.y+s.d,o.position.y+o.size.d)-Math.max(a.y,o.position.y));
  if(Math.abs(a.y+s.d-o.position.y)<EPS||Math.abs(o.position.y+o.size.d-a.y)<EPS)length+=Math.max(0,Math.min(a.x+s.w,o.position.x+o.size.w)-Math.max(a.x,o.position.x));
 }return Math.min(1,length/(2*(s.w+s.d)));
}

// Exact empty volume below this footprint. Boxes do not overlap, so clipped volumes add.
// Unlike a sampled heightmap, a narrow gap cannot disappear between grid samples.
export function trappedBelow(b:Pick<Placement,'position'|'size'>,placed:Placement[]){
 let occupied=0;for(const o of placed){const r=overlapRect({x:b.position.x,y:b.position.y,w:b.size.w,d:b.size.d},footprint(o));if(r)occupied+=r.w*r.d*Math.max(0,Math.min(b.position.z,top(o))-o.position.z);}
 return Math.max(0,b.size.w*b.size.d*b.position.z-occupied);
}

export function compactScore(c:Candidate,input:PlanningInput){
 const b=c.placement,area=input.pallet.width*input.pallet.depth,capacity=area*input.pallet.maxHeight;
 // Lower positions are compared first by the planner. Within that plane, trade off
 // useful volume, broad foundations, contact, and irreversible buried voids.
 let compact=100*b.size.w*b.size.d/area+60*volume(b.size)/capacity+32*edgeContact(b,input.placements,input.pallet,!input.settings.interiorPacking)-100*trappedBelow(b,input.placements)/capacity-120*(1-b.supportRatio);
 if(input.settings.interiorPacking){const before=interiorSpace(input.placements),after=interiorAfter(input.placements,b);c.features.interiorVoid=after.voidVolume;c.features.packingEnvelope=after.envelope;compact-=250*(after.voidVolume-before.voidVolume)/capacity;}
 c.terms.compact=compact;
 // Centre offset remains a soft preference. inspectConstraints already rejects tipping.
 c.terms.lowerBalance=-24*(c.features.lowerBalance??0);
 // Do not charge for reusing available floor or rewarding a single centred pedestal.
 c.terms.foundation=0;c.terms.stability*=.25;c.terms.balance*=.25;
 c.fastScore=Object.values(c.terms).reduce((a,b)=>a+b,0);c.score=c.fastScore;
}
