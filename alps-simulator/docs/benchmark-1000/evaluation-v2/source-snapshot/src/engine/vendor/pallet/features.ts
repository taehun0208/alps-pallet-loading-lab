import { massCenter } from './packaging/spec';
import { top,volume,footprint,overlapRect,calculateLoads } from './geometry';
import { surface,placeOnSurface,NX,NY } from './surface';
import { assessInventory,emptyInventory } from './inventory';
import { stability } from './stability';
import { packingQuality } from './packing';
import { materialInfo } from './materials';
import { DEFAULT_STABILITY } from './types';
import type { Placement,Pallet,Features,Terms,Weights,PlanningInput,StabilitySettings } from './types';
export function balance(placed:Placement[],p:Pallet){
 const weight=placed.reduce((s,b)=>s+b.weight,0),center={x:0,y:0,z:0};
 for(const b of placed){center.x+=massCenter(b).x*b.weight;center.y+=massCenter(b).y*b.weight;center.z+=massCenter(b).z*b.weight;}if(weight)for(const k of ['x','y','z'] as const)center[k]/=weight;
 const roots:Record<string,number>={};const route=(b:Placement,load:number)=>{if(!b.supports.length){roots[b.id]=(roots[b.id]||0)+load;return;}for(const s of b.supports){const parent=placed.find(v=>v.id===s.id);if(parent)route(parent,load*s.share);}};
 placed.forEach(b=>route(b,b.weight));const quadrants=[0,0,0,0];for(const [id,load] of Object.entries(roots)){const b=placed.find(v=>v.id===id)!;for(let i=0;i<4;i++){const r={x:i%2*p.width/2,y:Math.floor(i/2)*p.depth/2,w:p.width/2,d:p.depth/2};const a=overlapRect(footprint(b),r);if(a)quadrants[i]+=load*a.w*a.d/(b.size.w*b.size.d);}}
 return {center,quadrants,imbalance:weight?(Math.max(...quadrants)-Math.min(...quadrants))/weight:0};
}
export function loadSummary(placed:Placement[],cfg:StabilitySettings=DEFAULT_STABILITY){const loads=calculateLoads(placed);let loadUtilization=0,unknownCapacity=0;for(const b of placed){const capacity=materialInfo(b,cfg).capacity;if(capacity===null)unknownCapacity++;else loadUtilization=Math.max(loadUtilization,capacity?loads[b.id]/capacity:loads[b.id]>0?10:0);}return {loadUtilization,unknownCapacity};}
export function features(placed:Placement[],p:Pallet,workSeconds:number,input?:PlanningInput,base?:ReturnType<typeof surface>):Features{
 const map=base?placeOnSurface(base,placed.at(-1)!,p):surface(placed,p),heights=map.heights;let diff=0,edges=0,flat=0;
 for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){const i=y*NX+x;for(const j of [x<NX-1?i+1:-1,y<NY-1?i+NX:-1])if(j>=0){diff+=Math.abs(heights[i]-heights[j]);edges++;if(Math.abs(heights[i]-heights[j])<.5)flat++;}}
 const meanHeight=heights.reduce((a,b)=>a+b,0)/heights.length,total=placed.reduce((a,b)=>a+volume(b.size),0),cfg=input?.constraints.stability||DEFAULT_STABILITY,stable=stability(placed,cfg);
 return {...(input?packingQuality(placed.at(-1)!,input):{}),maxHeight:Math.max(0,...placed.map(top)),meanHeight,roughness:diff/edges,blockedVolume:Math.max(0,meanHeight*p.width*p.depth-total),flatRatio:flat/edges,imbalance:balance(placed,p).imbalance,workSeconds,slenderness:stable.slenderness,lowerBalance:stable.lowerBalance,loadUtilization:loadSummary(placed,cfg).loadUtilization,inventory:input?assessInventory(input,placed,map,placed.at(-1)!):emptyInventory()};
}
export function terms(f:Features,p:Pallet,w:Weights,cfg:StabilitySettings=DEFAULT_STABILITY):Terms{return {maximum:-w.maximum*f.maxHeight/p.maxHeight,mean:-w.mean*f.meanHeight/p.maxHeight,roughness:-w.roughness*f.roughness/p.maxHeight,void:-w.void*f.blockedVolume/(p.width*p.depth*p.maxHeight),flat:w.flat*f.flatRatio,balance:-w.balance*f.imbalance,time:-w.time*f.workSeconds/30,stability:-w.stability*f.slenderness/cfg.maxSlenderness,inventory:w.inventory*f.inventory.opportunity,foundation:-w.foundation*f.inventory.foundationPenalty,load:-w.load*f.loadUtilization,contact:(w.contact??0)*(f.contactRatio??0),futureSurface:-(w.futureSurface??0)*(f.futureSurfacePenalty??0)};}
