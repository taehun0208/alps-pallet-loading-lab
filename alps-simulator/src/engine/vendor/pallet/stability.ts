import { convexHull,top,EPS } from './geometry';
import { equilibrium } from './equilibrium';
import { DEFAULT_STABILITY } from './types';
import type { Placement,Vec3,StabilitySettings,SupportBalance } from './types';
type Point={x:number;y:number};
const corners=(r:{x:number;y:number;w:number;d:number}):Point[]=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.d},{x:r.x,y:r.y+r.d}];
function edgeMargin(hull:Point[],p:Vec3){
 if(hull.length<3)return -Infinity;
 return Math.min(...hull.map((a,i)=>{const b=hull[(i+1)%hull.length];return ((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/Math.max(EPS,Math.hypot(b.x-a.x,b.y-a.y));}));
}
function centroid(hull:Point[]):Point{
 let area=0,x=0,y=0;for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],cross=a.x*b.y-b.x*a.y;area+=cross;x+=(a.x+b.x)*cross;y+=(a.y+b.y)*cross;}
 return Math.abs(area)>EPS?{x:x/(3*area),y:y/(3*area)}:{x:hull.reduce((s,p)=>s+p.x,0)/hull.length,y:hull.reduce((s,p)=>s+p.y,0)/hull.length};
}
export function transmittedMass(placed:Placement[]){return equilibrium(placed).moments;}
export function stability(placed:Placement[],cfg:StabilitySettings=DEFAULT_STABILITY,solution?:ReturnType<typeof equilibrium>){
 const result=solution??equilibrium(placed),violations:string[]=[...result.violations],moments=result.moments,supports:SupportBalance[]=[];placed=result.placements;let minReserve=Infinity;
 // Inspect every contact plane using the resultant of its own weight and all transmitted upper loads.
 for(const b of placed){const m=moments.get(b.id)!,center={x:m.mx/m.mass,y:m.my/m.mass,z:m.mz/m.mass};
  const rects=b.supports.length?b.supports.map(s=>s.rect):b.position.z===0?[{x:b.position.x,y:b.position.y,w:b.size.w,d:b.size.d}]:[];
  if(!rects.length)continue;const hull=convexHull(rects.flatMap(corners)),xs=hull.map(p=>p.x),ys=hull.map(p=>p.y),width=Math.max(...xs)-Math.min(...xs),depth=Math.max(...ys)-Math.min(...ys);
  const margin=edgeMargin(hull,center),required=Math.max(Math.min(width,depth)*cfg.minMarginRatio,Math.max(0,center.z-b.position.z)*cfg.lateralAccelerationG),reserve=margin-required;minReserve=Math.min(minReserve,reserve);
  const anchor=centroid(hull),supportCenter={...anchor,z:b.position.z},offsetMm=Math.hypot(center.x-anchor.x,center.y-anchor.y),offsetRatio=Math.max(Math.abs(center.x-anchor.x)/Math.max(EPS,width/2),Math.abs(center.y-anchor.y)/Math.max(EPS,depth/2));
  supports.push({id:b.id,isBase:b.position.z===0,planeZ:b.position.z,mass:m.mass,loadAbove:b.loadAbove,center,supportCenter,offsetMm,offsetRatio,margin,required,reserve});
  if(reserve< -EPS)violations.push(`누적 무게중심 여유 부족 · ${b.id} (${margin.toFixed(1)} / 필요 ${required.toFixed(1)} mm)`);
 }
 // Support connectivity only: touching side faces do not act like straps or structural ties.
 const parent=new Map(placed.map(b=>[b.id,b.id]));const find=(id:string):string=>{let p=parent.get(id)!;while(p!==parent.get(p))p=parent.get(p)!;return p;};
 for(const b of placed)for(const s of b.supports)if(parent.has(s.id))parent.set(find(b.id),find(s.id));
 const groups=new Map<string,Placement[]>();for(const b of placed){const id=find(b.id);groups.set(id,[...(groups.get(id)||[]),b]);}
 const components=[...groups.values()].map(boxes=>{const bases=boxes.filter(b=>b.position.z===0);if(!bases.length)return {ids:boxes.map(b=>b.id),height:0,width:0,depth:0,slenderness:0};
  const x0=Math.min(...bases.map(b=>b.position.x)),y0=Math.min(...bases.map(b=>b.position.y)),width=Math.max(...bases.map(b=>b.position.x+b.size.w))-x0,depth=Math.max(...bases.map(b=>b.position.y+b.size.d))-y0,height=Math.max(...boxes.map(top)),slenderness=height/Math.min(width,depth);
  if(cfg.slendernessMode!=='score'&&slenderness>cfg.maxSlenderness+EPS)violations.push(`독립 기둥 높이 / 받침 폭 초과 · ${boxes[0].id} (${slenderness.toFixed(2)} > ${cfg.maxSlenderness.toFixed(2)})`);
  return {ids:boxes.map(b=>b.id),height,width,depth,slenderness};
 });
 const loaded=supports.filter(s=>s.loadAbove>EPS),mass=loaded.reduce((sum,s)=>sum+s.mass,0),lowerBalance=loaded.length?.75*Math.max(...loaded.map(s=>s.offsetRatio))+.25*loaded.reduce((sum,s)=>sum+s.mass*s.offsetRatio,0)/mass:0;
 return {components,supports,lowerBalance,slenderness:Math.max(0,...components.map(c=>c.slenderness)),minReserve:Number.isFinite(minReserve)?minReserve:0,violations};
}
