import { EPS,top } from './geometry';
import type { Frame,Scenario } from './types';

export function heightSummary(frame:Frame,s:Scenario){
 // Height bands can differ between columns. Count actual support chains, not unique z values.
 const depth=new Map<string,number>();
 for(const b of [...frame.placements].sort((a,b)=>a.position.z-b.position.z)){
  depth.set(b.id,1+Math.max(0,...b.supports.map(c=>depth.get(c.id)??0)));
 }
 const height=Math.max(0,...frame.placements.map(top)),layers=Math.max(0,...depth.values());
 const record=frame.blocked?frame.records.at(-1):undefined;
 const candidates=record?.analysis?.candidates??[];
 const inside=candidates.filter(c=>{const {position:p,size:d}=c.placement;return p.x>=-EPS&&p.y>=-EPS&&p.x+d.w<=s.pallet.width+EPS&&p.y+d.d<=s.pallet.depth+EPS&&p.z+d.h<=s.pallet.maxHeight+EPS;});
 const upper=inside.filter(c=>c.placement.position.z>EPS);
 return {height,layers,headroom:Math.max(0,s.pallet.maxHeight-height),limit:s.pallet.maxHeight,
  blockedBox:record?.observation,inspected: candidates.length,generated:record?.analysis?.generated??0,
  upperInspected:upper.length,bestUpperSupport:upper.length?Math.max(...upper.map(c=>c.placement.supportRatio)):null,
  rejectionCounts:record?.analysis?.rejections??{}};
}
