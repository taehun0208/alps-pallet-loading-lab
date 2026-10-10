/** Physical face contacts. Projection overlap through air is deliberately excluded. */
export interface ClusterBox {id:string;typeId:string;position:{x:number;y:number;z:number};size:{w:number;d:number;h:number}}
export const department=(typeId:string)=>Math.floor((Number(typeId.replace(/\D/g,''))-1)/2);
const eps=1e-5;
const overlap=(a:number,al:number,b:number,bl:number)=>Math.max(0,Math.min(a+al,b+bl)-Math.max(a,b));
export function contact(a:ClusterBox,b:ClusterBox){
 const x=overlap(a.position.x,a.size.w,b.position.x,b.size.w),y=overlap(a.position.y,a.size.d,b.position.y,b.size.d),z=overlap(a.position.z,a.size.h,b.position.z,b.size.h);
 const touching=(axis:'x'|'y'|'z',size:'w'|'d'|'h')=>Math.abs(a.position[axis]+a.size[size]-b.position[axis])<eps||Math.abs(b.position[axis]+b.size[size]-a.position[axis])<eps;
 const vertical=touching('z','h')?x*y:0;
 return {vertical,area:vertical+(touching('x','w')?y*z:0)+(touching('y','d')?x*z:0)};
}
export function clusteringMetrics(boxes:readonly ClusterBox[]){
 let total=0,same=0,zone=0,vertical=0,sameVertical=0;
 const edges=new Map(boxes.map(b=>[b.id,[] as string[]]));
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j],c=contact(a,b);total+=c.area;vertical+=c.vertical;
  if(department(a.typeId)===department(b.typeId))zone+=c.area;
  if(a.typeId===b.typeId){same+=c.area;sameVertical+=c.vertical;if(c.area>eps){edges.get(a.id)!.push(b.id);edges.get(b.id)!.push(a.id);}}
 }
 const seen=new Set<string>(),largest:Record<string,number>={};let components=0;
 for(const box of boxes){if(seen.has(box.id))continue;components++;const queue=[box.id];seen.add(box.id);let size=0;
  for(let q=0;q<queue.length;q++){size++;for(const id of edges.get(queue[q])!)if(!seen.has(id)){seen.add(id);queue.push(id);}}
  largest[box.typeId]=Math.max(largest[box.typeId]??0,size);
 }
 return {contactAreaMm2:total,sameSkuContactAreaMm2:same,sameSkuContact:total?same/total:null,sameDepartmentContact:total?zone/total:null,
  verticalContactAreaMm2:vertical,sameSkuVertical:vertical?sameVertical/vertical:null,
  largestComponentShare:boxes.length?Object.values(largest).reduce((a,b)=>a+b,0)/boxes.length:null,components};
}
export const CLUSTER_DEFINITIONS={
 sameSkuContact:'Sum of shared face area between identical SKUs / all box-to-box shared face area. Each pair counted once; pallet boundary excluded. Null with no contacts.',
 sameSkuVertical:'Same-SKU touching horizontal face area / all touching horizontal face area. Non-touching XY projections are excluded; null when no vertical contact.',
 sameDepartmentContact:'Shared face area within S1/S2, S3/S4, or S5/S6 / all shared face area. Distinct from exact SKU similarity.',
 largestComponentShare:'Sum of largest face-connected component sizes per SKU / placed count. Reported with count and contact purity to avoid singleton inflation.',
};
