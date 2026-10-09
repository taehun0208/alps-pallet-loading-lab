import { massCenter } from './packaging/spec';
import { convexHull,EPS } from './geometry';
import type { Placement,Contact } from './types';
type Moment={mass:number;mx:number;my:number;mz:number};
type Node={x:number;y:number;owner:number;reference:number};
function solve3(matrix:number[][],rhs:number[]):number[]|null{
 const a=matrix.map((row,i)=>[...row,rhs[i]]);
 for(let i=0;i<3;i++){let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
  if(Math.abs(a[pivot][i])<1e-12)return null;[a[i],a[pivot]]=[a[pivot],a[i]];const divisor=a[i][i];for(let k=i;k<4;k++)a[i][k]/=divisor;
  for(let j=0;j<3;j++)if(j!==i){const factor=a[j][i];for(let k=i;k<4;k++)a[j][k]-=factor*a[i][k];}
 }return a.map(row=>row[3]);
}
function reactions(contacts:Contact[],x:number,y:number):Contact[]|null{
 const totalArea=contacts.reduce((n,c)=>n+c.area,0),nodes:Node[]=contacts.flatMap((c,owner)=>{const r=c.rect;return [[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.d],[r.x,r.y+r.d]].map(([x,y])=>({x,y,owner,reference:c.area/(totalArea*4)}));});
 if(!nodes.length)return null;
 const scale=Math.max(1,...nodes.map(n=>Math.max(Math.abs(n.x-x),Math.abs(n.y-y)))),vectors=nodes.map(n=>[1,(n.x-x)/scale,(n.y-y)/scale]),active=new Set(nodes.map((_,i)=>i));let weights:number[]|null=null;
 // Area-weighted minimum change from uniform contact pressure, subject to force and moment balance.
 for(let pass=0;pass<nodes.length;pass++){
  const m=Array.from({length:3},()=>[0,0,0]),rhs=[1,0,0];for(const i of active){const a=vectors[i],r=nodes[i].reference;for(let j=0;j<3;j++){rhs[j]-=r*a[j];for(let k=0;k<3;k++)m[j][k]+=r*a[j]*a[k];}}
  const lambda=solve3(m,rhs);if(!lambda)break;const trial=nodes.map((n,i)=>active.has(i)?n.reference*(1+vectors[i].reduce((s,v,j)=>s+v*lambda[j],0)):0);let worst=-1;
  for(const i of active)if(trial[i]<-1e-9&&(worst<0||trial[i]<trial[worst]))worst=i;
  if(worst<0){weights=trial.map(w=>Math.max(0,w));break;}active.delete(worst);
 }
 // Feasible triangle fallback when an active subset becomes singular. No tensile reaction is allowed.
 if(!weights){const hull=convexHull(nodes),a=hull[0];for(let k=1;k<hull.length-1&&!weights;k++){const b=hull[k],c=hull[k+1],den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<EPS)continue;
   const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,w=1-u-v;
   if(Math.min(u,v,w)>=-1e-9){weights=nodes.map(()=>0);for(const [point,value] of [[a,u],[b,v],[c,w]] as const)weights[nodes.findIndex(n=>n.x===point.x&&n.y===point.y)]+=Math.max(0,value);}
  }}
 if(!weights)return null;const sum=weights.reduce((a,b)=>a+b,0);weights=weights.map(w=>w/sum);
 const force=contacts.map((c,i)=>{let share=0,mx=0,my=0;for(let j=0;j<nodes.length;j++)if(nodes[j].owner===i){share+=weights![j];mx+=weights![j]*nodes[j].x;my+=weights![j]*nodes[j].y;}return {...c,share,forcePoint:share>EPS?{x:mx/share,y:my/share}:{x:c.rect.x+c.rect.w/2,y:c.rect.y+c.rect.d/2}};});
 const residual=Math.max(Math.abs(force.reduce((n,c)=>n+c.share*c.forcePoint.x,0)-x),Math.abs(force.reduce((n,c)=>n+c.share*c.forcePoint.y,0)-y));return residual<1e-5?force:null;
}
export function equilibrium(placements:Placement[]){
 const stack=placements.map(b=>({...b,supports:b.supports.map(c=>({...c,rect:{...c.rect}})),loadAbove:0})),moments=new Map<string,Moment>(stack.map(b=>[b.id,{mass:b.weight,mx:massCenter(b).x*b.weight,my:massCenter(b).y*b.weight,mz:massCenter(b).z*b.weight}])),violations:string[]=[];
 for(const b of [...stack].sort((a,b)=>b.position.z-a.position.z)){const m=moments.get(b.id)!;b.loadAbove=m.mass-b.weight;if(!b.supports.length)continue;
  const balanced=reactions(b.supports,m.mx/m.mass,m.my/m.mass);if(!balanced){violations.push(`누적 무게중심 정적 평형 불가 · ${b.id}`);continue;}b.supports=balanced;
  for(const s of balanced){const parent=moments.get(s.id);if(!parent)continue;const mass=m.mass*s.share;parent.mass+=mass;parent.mx+=mass*s.forcePoint!.x;parent.my+=mass*s.forcePoint!.y;parent.mz+=m.mz*s.share;}
 }
 return {placements:stack,moments,violations};
}

// Shared nonnegative force/moment solver; existing planner remains unchanged.
export const solveContactReactions = reactions;
