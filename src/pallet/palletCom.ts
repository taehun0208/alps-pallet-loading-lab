import { massCenter } from './packaging/spec';
import { convexHull,EPS } from './geometry';
import { stability } from './stability';
import { DEFAULT_STABILITY } from './types';
import type { Pallet,Placement,Vec3,BoxType,StabilitySettings } from './types';

/** Whole-load centre of mass on the pallet. Box CoG offsets come from BoxSpec when present. */
export function loadCom(placed:readonly Pick<Placement,'position'|'size'|'orientation'|'packaging'|'weight'>[]):{mass:number;center:Vec3|null}{
 const mass=placed.reduce((n,b)=>n+b.weight,0);if(!(mass>0))return {mass:0,center:null};
 const c={x:0,y:0,z:0};for(const b of placed){const m=massCenter(b);c.x+=m.x*b.weight;c.y+=m.y*b.weight;c.z+=m.z*b.weight;}
 return {mass,center:{x:c.x/mass,y:c.y/mass,z:c.z/mass}};
}
/** Larger axis offset from the pallet centre, as a fraction of that half dimension (0 centre, 1 edge). */
export function comOffsetRatio(center:Vec3,p:Pallet){return Math.max(Math.abs(center.x-p.width/2)/(p.width/2),Math.abs(center.y-p.depth/2)/(p.depth/2));}
/** Mean known box mass. Uses declared types and quantities only, never the arrival order. */
export function meanTypeMass(types:readonly BoxType[]){const n=types.reduce((s,t)=>s+t.quantity,0);return n?types.reduce((s,t)=>s+t.weight*t.quantity,0)/n:0;}
/**
 * Soft whole-load balance cost after a placement: offset ratio x mass ramp.
 * The ramp M/(M+4m) keeps the first few light boxes from dominating the decision and
 * approaches 1 as the load grows (m = mean known box mass, or the placed mean when unknown).
 */
export function comCost(placed:readonly Placement[],p:Pallet,meanMass?:number){
 const {mass,center}=loadCom(placed);if(!center)return {offset:0,ramp:0,cost:0};
 const m=meanMass&&meanMass>0?meanMass:mass/placed.length,offset=comOffsetRatio(center,p),ramp=mass/(mass+4*m);
 return {offset,ramp,cost:offset*ramp};
}
/**
 * Transport tipping margins under a horizontal acceleration a (in g), two cargo models:
 * - loose: no wrapping. At every contact plane, the resultant of the box and all transmitted
 *   upper loads must stay inside that plane's support hull by h·a (h = resultant height above
 *   the plane). Uses the same equilibrium/stability model as placement checks.
 * - wrapped: the load moves as one rigid block on the hull of its floor contacts.
 * Neither model includes the pallet itself; see palletUnitMargin.
 */
export function transportMargin(placed:readonly Placement[],p:Pallet,accelerationG:number,base:StabilitySettings=DEFAULT_STABILITY){
 if(!placed.length)return {looseMarginMm:Infinity,wrappedMarginMm:Infinity};
 const loose=stability([...placed],{...base,minMarginRatio:0,lateralAccelerationG:accelerationG}).minReserve;
 const {center}=loadCom(placed),hull=convexHull(placed.filter(b=>Math.abs(b.position.z)<=EPS).flatMap(b=>corners(b)));
 if(!center||hull.length<3)throw Error('바닥 접촉이 없는 적재 상태: 운반 여유 계산 불가');
 const wrapped=edgeMargin(hull,center)-center.z*accelerationG;
 return {looseMarginMm:loose,wrappedMarginMm:wrapped};
}
/** Explicit coupling model for the loaded pallet as one unit on its own footprint. */
export interface PalletUnitModel { palletMassKg:number;deckHeightMm:number;source:string }
/**
 * Loaded-pallet tipping on the pallet footprint. Valid only when the cargo is coupled to the
 * pallet (e.g. wrapped to the deck): the caller must supply the pallet mass, deck height and the
 * source of that assumption. Returns null without a model so it is reported as unverified.
 */
export function palletUnitMargin(placed:readonly Placement[],p:Pallet,accelerationG:number,model?:PalletUnitModel){
 if(!model)return null;
 const {mass,center}=loadCom(placed),m=mass+model.palletMassKg;
 const cx=center?(center.x*mass+p.width/2*model.palletMassKg)/m:p.width/2,cy=center?(center.y*mass+p.depth/2*model.palletMassKg)/m:p.depth/2;
 const cz=((center?center.z+model.deckHeightMm:0)*mass+model.deckHeightMm/2*model.palletMassKg)/m;
 return Math.min(cx,p.width-cx,cy,p.depth-cy)-cz*accelerationG;
}
const corners=(b:Pick<Placement,'position'|'size'>)=>[{x:b.position.x,y:b.position.y},{x:b.position.x+b.size.w,y:b.position.y},{x:b.position.x+b.size.w,y:b.position.y+b.size.d},{x:b.position.x,y:b.position.y+b.size.d}];
function edgeMargin(hull:{x:number;y:number}[],c:Vec3){return Math.min(...hull.map((a,i)=>{const b=hull[(i+1)%hull.length];return ((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y);}));}
/** Boxes whose friction coefficient is below a/g would slide if the load is not wrapped. */
export function slidingRisk(placed:readonly Placement[],accelerationG:number,defaultFriction=.6){
 return placed.filter(b=>(b.friction??defaultFriction)<accelerationG).map(b=>b.id);
}
