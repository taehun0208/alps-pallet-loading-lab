import { top } from './geometry';
import type { Placement,Pallet } from './types';
export const NX=12,NY=10;
export function surface(placed:Placement[],pallet:Pallet){
 const heights:number[]=[],owners:(Placement|null)[]=[];
 for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){
  const px=(x+.5)*pallet.width/NX,py=(y+.5)*pallet.depth/NY;let height=0,owner:Placement|null=null;
  for(const b of placed)if(px>=b.position.x&&px<b.position.x+b.size.w&&py>=b.position.y&&py<b.position.y+b.size.d&&top(b)>height){height=top(b);owner=b;}
  heights.push(height);owners.push(owner);
 }
 return {heights,owners};
}
export function placeOnSurface(base:ReturnType<typeof surface>,b:Placement,pallet:Pallet){
 const heights=[...base.heights],owners=[...base.owners],height=top(b);
 for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){const i=y*NX+x,px=(x+.5)*pallet.width/NX,py=(y+.5)*pallet.depth/NY;if(px>=b.position.x&&px<b.position.x+b.size.w&&py>=b.position.y&&py<b.position.y+b.size.d&&height>heights[i]){heights[i]=height;owners[i]=b;}}
 return {heights,owners};
}
