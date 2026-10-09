import { solveContactReactions } from '../equilibrium';
import { convexHull } from '../geometry';
import type {Contact} from '../types';
import type {Assessment,Config,Placed,Rect} from './types';
import {area,bounds,collides,EPS,overlap,transformPoint,wallSolids,worldParts} from './shape';
type Patch=Rect&{owner:string};
export function unionContacts(patches:Patch[]):Contact[]{
 const xs=[...new Set(patches.flatMap(r=>[r.x,r.x+r.w]))].sort((a,b)=>a-b),out:Contact[]=[];
 for(let i=1;i<xs.length;i++){const x=xs[i-1],w=xs[i]-x,rs=patches.filter(r=>r.x<x+w-EPS&&r.x+r.w>x+EPS),ys=[...new Set(rs.flatMap(r=>[r.y,r.y+r.d]))].sort((a,b)=>a-b);
  for(let j=1;j<ys.length;j++){const y=ys[j-1],d=ys[j]-y,owners=rs.filter(r=>r.y<=y+EPS&&r.y+r.d>=y+d-EPS).sort((a,b)=>a.owner.localeCompare(b.owner));if(owners.length)out.push({id:owners[0].owner,rect:{x,y,w,d},area:w*d,share:0});}
 }return out;
}
export function contacts(p:Placed,others:Placed[],c:Config):Contact[]{
 const patches:Patch[]=[];for(const part of worldParts(p)){
  if(Math.abs(part.z)<=c.contactMm)patches.push({...part,owner:'@floor'});
  for(const o of others)if(o.box.id!==p.box.id)for(const below of worldParts(o)){
   if(Math.abs(part.z-(below.z+below.h))>c.contactMm)continue;
   const r=overlap(part,below);if(r)patches.push({...r,owner:o.box.id});
  }
 }return unionContacts(patches);
}
function maxGap(rect:Rect,cs:Contact[]):number{
 let max=0;for(const swap of [false,true]){
  const rs=cs.map(c=>swap?{x:c.rect.y,y:c.rect.x,w:c.rect.d,d:c.rect.w}:c.rect),r=swap?{x:rect.y,y:rect.x,w:rect.d,d:rect.w}:rect;
  const ys=[r.y,r.y+r.d,...rs.flatMap(p=>[p.y,p.y+p.d])].filter(y=>y>=r.y&&y<=r.y+r.d).sort((a,b)=>a-b);
  for(let i=1;i<ys.length;i++){if(ys[i]-ys[i-1]<EPS)continue;const y=(ys[i]+ys[i-1])/2,spans=rs.filter(p=>p.y<=y&&p.y+p.d>=y).sort((a,b)=>a.x-b.x);let end=r.x;
   for(const p of spans){max=Math.max(max,p.x-end);end=Math.max(end,p.x+p.w);}max=Math.max(max,r.x+r.w-end);
  }
 }return max;
}
export function capacity(p:Placed){const s=p.box.strength;return s.topLoadKg===null?null:s.topLoadKg*s.residual;}
export function assess(stack:Placed[],c:Config,focusId=stack.at(-1)?.box.id):Assessment {
 const reasons=new Set<string>(),loads:Assessment['loads']={},byId=new Map(stack.map(p=>[p.box.id,p])),supportMap=new Map<string,Contact[]>();
 let floorReactionKg=0,floorMx=0,floorMy=0;
 const parts=stack.map(p=>worldParts(p)),envelopes=parts.map(bounds);
 for(let i=0;i<stack.length;i++){const p=stack[i],b=envelopes[i];
  if(!p.box.rotations.includes(p.rotation))reasons.add('rotation');
  if(b.x<-EPS||b.y<-EPS||b.z<-c.penetrationMm||b.x+b.w>c.pallet.width+EPS||b.y+b.d>c.pallet.depth+EPS||b.z+b.h>c.pallet.maxHeight+EPS)reasons.add('boundary');
  for(let j=0;j<i;j++)if(collides(b,envelopes[j],c.penetrationMm)&&parts[i].some(a=>parts[j].some(v=>collides(a,v,c.penetrationMm))))reasons.add('collision');
  if(parts[i].some(a=>wallSolids(c).some(w=>collides(a,w,c.penetrationMm))))reasons.add('collision');
  const cs=contacts(p,stack,c);supportMap.set(p.box.id,cs);
  if(area(cs.map(v=>v.rect))/Math.max(1,area(parts[i]))<c.supportRatio-EPS)reasons.add('support');
  if(maxGap(b,cs)>c.maxBridgeMm+EPS)reasons.add('bridge');
  const com=transformPoint(p.box.com,p.box,p);loads[p.box.id]={aboveKg:0,reactionKg:p.box.mass,capacityKg:capacity(p),resultant:com,contacts:cs};
 }
 // Reverse topological order of the actual support graph, not nominal layer numbering.
 const incoming=new Map(stack.map(p=>[p.box.id,0]));
 for(const cs of supportMap.values())for(const id of new Set(cs.map(v=>v.id)))if(incoming.has(id))incoming.set(id,incoming.get(id)!+1);
 const queue=stack.filter(p=>incoming.get(p.box.id)===0).map(p=>p.box.id);let visited=0;
 while(queue.length){const id=queue.shift()!,p=byId.get(id)!,load=loads[id],cs=supportMap.get(id)!;visited++;
  const total=p.box.mass+load.aboveKg;load.reactionKg=total;
  const hull=convexHull(cs.flatMap(s=>{const r=s.rect;return[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.d},{x:r.x,y:r.y+r.d}];}));
  let margin=Infinity;
  for(let k=0;k<hull.length;k++){const a=hull[k],b=hull[(k+1)%hull.length];margin=Math.min(margin,((b.x-a.x)*(load.resultant.y-a.y)-(b.y-a.y)*(load.resultant.x-a.x))/Math.max(EPS,Math.hypot(b.x-a.x,b.y-a.y)));}
  const solved=solveContactReactions(cs,load.resultant.x,load.resultant.y);
  if(!solved||hull.length<3||margin<c.edgeMarginMm-EPS)reasons.add('tipping');
  if(load.aboveKg>EPS&&(load.capacityKg===null))reasons.add('strength');
  if(load.capacityKg!==null&&load.aboveKg>load.capacityKg+EPS)reasons.add('load');
  load.contacts=solved||cs;
  for(const s of solved||[]){const m=total*s.share,point=s.forcePoint!;
   if(s.id==='@floor'){floorReactionKg+=m;floorMx+=m*point.x;floorMy+=m*point.y;continue;}
   const parent=loads[s.id],owner=byId.get(s.id);if(!parent||!owner)continue;const before=owner.box.mass+parent.aboveKg;
   parent.resultant={x:(parent.resultant.x*before+point.x*m)/(before+m),y:(parent.resultant.y*before+point.y*m)/(before+m),z:(parent.resultant.z*before+load.resultant.z*m)/(before+m)};parent.aboveKg+=m;
  }
  for(const parent of new Set(cs.map(v=>v.id)))if(incoming.has(parent)){incoming.set(parent,incoming.get(parent)!-1);if(incoming.get(parent)===0)queue.push(parent);}
 }
 if(visited!==stack.length)reasons.add('support');
 const total=stack.reduce((s,p)=>s+p.box.mass,0),mx=stack.reduce((s,p)=>s+p.box.mass*transformPoint(p.box.com,p.box,p).x,0),my=stack.reduce((s,p)=>s+p.box.mass*transformPoint(p.box.com,p.box,p).y,0),focus=stack.find(p=>p.box.id===focusId),cs=focus?supportMap.get(focusId!)!:[]; 
 return{reasons:[...reasons],contacts:loads[focusId||'']?.contacts||cs,supportRatio:focus?area(cs.map(v=>v.rect))/Math.max(1,area(worldParts(focus))):0,loads,floorReactionKg,forceResidualKg:Math.abs(total-floorReactionKg),momentResidualKgMm:Math.max(Math.abs(mx-floorMx),Math.abs(my-floorMy))};
}
