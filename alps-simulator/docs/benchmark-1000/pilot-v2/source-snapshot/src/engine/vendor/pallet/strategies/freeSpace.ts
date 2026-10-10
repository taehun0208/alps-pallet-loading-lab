import { footprint,overlapRect,top } from '../geometry';
import type { Pallet,Placement } from '../types';

// MACS-inspired conservative approximation, NOT a reproduction of TAP-Net's convex algorithm.
// Boxes have axis-aligned faces, so search top-open rectangular cuboids on a compressed skyline.
// Each cell takes the MAX actual box height intersecting it. Coarsening may miss opportunities
// but never counts a blocked column as free. Hidden cavities are inaccessible from above.
// At most 16 intervals per axis, O(N*G^2 + G^4); no millimetre voxel scan.
export function accessibleSpace(stack:Placement[],p:Pallet){
  const edges=(axis:'x'|'y',length:number)=>{
    const all=[...new Set([0,length,...stack.flatMap(b=>[b.position[axis],b.position[axis]+(axis==='x'?b.size.w:b.size.d)])])].filter(n=>n>=0&&n<=length).sort((a,b)=>a-b);
    if(all.length<=17)return all;
    return [...new Set(Array.from({length:17},(_,i)=>all[Math.round(i*(all.length-1)/16)]))];
  };
  const xs=edges('x',p.width),ys=edges('y',p.depth),nx=xs.length-1,ny=ys.length-1;
  const heights=Array.from({length:ny},(_,y)=>Array.from({length:nx},(_,x)=>Math.max(0,...stack.filter(b=>overlapRect(footprint(b),{x:xs[x],y:ys[y],w:xs[x+1]-xs[x],d:ys[y+1]-ys[y]})).map(top))));
  let largest=0,accessible=0;
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)accessible+=(xs[x+1]-xs[x])*(ys[y+1]-ys[y])*Math.max(0,p.maxHeight-heights[y][x]);
  for(let y0=0;y0<ny;y0++){
    const column=new Array(nx).fill(0);
    for(let y1=y0;y1<ny;y1++){
      for(let x=0;x<nx;x++)column[x]=Math.max(column[x],heights[y1][x]);
      for(let x0=0;x0<nx;x0++){let z=0;for(let x1=x0;x1<nx;x1++){z=Math.max(z,column[x1]);largest=Math.max(largest,(xs[x1+1]-xs[x0])*(ys[y1+1]-ys[y0])*Math.max(0,p.maxHeight-z));}}
    }
  }
  return {largest,accessible,score:largest/(p.width*p.depth*p.maxHeight),fragmentation:accessible?1-largest/accessible:0};
}
