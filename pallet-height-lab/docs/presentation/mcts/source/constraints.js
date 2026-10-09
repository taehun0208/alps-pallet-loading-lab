import {EPS, top, overlap1, supportOf, hull, loadReport, unloading, volume, clamp} from './core.js';

export const TRANSPORT_DEFAULTS = {accelG:.08, tiltDeg:2, friction:.45, palletFriction:.4, safetyFactor:1.2, edgeMargin:.005};

function polygonMargin(poly,x,z) {
  if(poly.length<3)return -Infinity;
  return Math.min(...poly.map((a,i)=>{const b=poly[(i+1)%poly.length];return ((b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]))/Math.max(EPS,Math.hypot(b[0]-a[0],b[1]-a[1]));}));
}
function contactPolygon(b,boxes) {
  if(b.y<EPS)return [[b.x,b.z],[b.x+b.w,b.z],[b.x+b.w,b.z+b.d],[b.x,b.z+b.d]];
  const points=[];
  for(const q of boxes){if(Math.abs(top(q)-b.y)>.001)continue;const w=overlap1(b.x,b.w,q.x,q.w),d=overlap1(b.z,b.d,q.z,q.d);if(w*d<EPS)continue;
    const x=Math.max(b.x,q.x),z=Math.max(b.z,q.z);points.push([x,z],[x+w,z],[x+w,z+d],[x,z+d]);}
  return hull(points);
}

// Quasi-static screening only. Loads and their first moments are split by contact
// area; this is not a contact-force equilibrium solver or a deformation model.
export function transportReport(boxes,p,c) {
  const t={...TRANSPORT_DEFAULTS,...c.transport};
  const theta=t.tiltDeg*Math.PI/180;
  const demand=t.safetyFactor*(t.accelG+Math.sin(theta))/Math.cos(theta);
  const sums=new Map(boxes.map(b=>[b.id,{m:b.kg,x:b.kg*(b.x+b.w/2),y:b.kg*(b.y+b.h/2),z:b.kg*(b.z+b.d/2)}]));
  const details=[];let minTip=Infinity,minSlip=Infinity;
  for(const b of [...boxes].sort((a,b)=>b.y-a.y)) {
    const s=sums.get(b.id),cg={x:s.x/s.m,y:s.y/s.m,z:s.z/s.m};
    const poly=contactPolygon(b,boxes.filter(q=>q.id!==b.id));
    // All horizontal directions: the worst projection is a disk of radius h*a/g.
    const tipMargin=polygonMargin(poly,cg.x,cg.z)-(cg.y-b.y)*demand-t.edgeMargin;
    const mu=b.y<EPS?t.palletFriction:Math.min(b.friction??t.friction,...supportOf(b,boxes).contacts.map(q=>boxes.find(x=>x.id===q.id)?.friction??t.friction));
    const slipMargin=mu-demand;
    minTip=Math.min(minTip,tipMargin);minSlip=Math.min(minSlip,slipMargin);
    details.push({id:b.id,tipMargin,slipMargin,carriedKg:s.m,cg});
    for(const q of supportOf(b,boxes.filter(q=>q.id!==b.id)).contacts){const target=sums.get(q.id);for(const k of ['m','x','y','z'])target[k]+=s[k]*q.share;}
  }
  let globalMargin=Infinity;
  if(boxes.length){const mass=boxes.reduce((n,b)=>n+b.kg,0),cg={x:0,y:0,z:0};
    for(const b of boxes){cg.x+=b.kg*(b.x+b.w/2)/mass;cg.y+=b.kg*(b.y+b.h/2)/mass;cg.z+=b.kg*(b.z+b.d/2)/mass;}
    globalMargin=Math.min(cg.x,p.w-cg.x,cg.z,p.d-cg.z)-cg.y*demand-t.edgeMargin;minTip=Math.min(minTip,globalMargin);}
  const worst=details.slice().sort((a,b)=>a.tipMargin-b.tipMargin)[0];
  return {ok:minTip>=-EPS&&minSlip>=-EPS,minTip:Number.isFinite(minTip)?minTip:null,minSlip:Number.isFinite(minSlip)?minSlip:null,globalMargin:Number.isFinite(globalMargin)?globalMargin:null,demand,worstId:worst?.id,details,
    reason:minSlip< -EPS?'운반 가정에서 미끄럼 여유 부족':minTip< -EPS?'운반 가정에서 전도 여유 부족':null,
    model:'접촉면적 하중 분배·준정적 선별',certified:false,wrappingCredit:false};
}

export function blocks(q,b) {
  return (q.y>=top(b)-EPS&&overlap1(q.x,q.w,b.x,b.w)>EPS&&overlap1(q.z,q.d,b.z,b.d)>EPS)||
    (q.z+q.d<=b.z+EPS&&overlap1(q.x,q.w,b.x,b.w)>EPS&&overlap1(q.y,q.h,b.y,b.h)>EPS);
}
function touches(a,b,gap=.03) {
  const dx=Math.max(0,a.x-b.x-b.w,b.x-a.x-a.w),dy=Math.max(0,a.y-b.y-b.h,b.y-a.y-a.h),dz=Math.max(0,a.z-b.z-b.d,b.z-a.z-a.d);
  return Math.hypot(dx,dy,dz)<=gap;
}
export function storeReport(boxes,p) {
  let violations=0,fragments=0;
  for(const b of boxes)for(const q of boxes)if(b.id!==q.id&&p.order.indexOf(q.zone)>p.order.indexOf(b.zone)&&blocks(q,b))violations++;
  for(const sku of new Set(boxes.map(b=>b.sku??b.id))){const group=boxes.filter(b=>(b.sku??b.id)===sku),unseen=new Set(group);let parts=0;
    while(unseen.size){parts++;const stack=[unseen.values().next().value];unseen.delete(stack[0]);while(stack.length){const b=stack.pop();for(const q of [...unseen])if(touches(b,q)){unseen.delete(q);stack.push(q);}}}fragments+=Math.max(0,parts-1);}
  return {violations,fragments,rehandles:unloading(boxes,p).rehandles};
}
export function physicalCheck(boxes,p,c) {
  const loads=loadReport(boxes);if(!loads.ok)return {ok:false,reason:'허용 상부하중 초과',loads};
  if(loads.unknown.length)return {ok:false,reason:'허용 상부하중 정보 없음',loads};
  const statics=transportReport(boxes,p,{...c,transport:{...c.transport,accelG:0,tiltDeg:0}});
  if(!statics.ok)return {ok:false,reason:'적재 중 정적 모멘트 여유 부족',loads,statics};
  const transport=transportReport(boxes,p,c);
  transport.enforced=c.transportMode==='unwrapped';
  transport.status=transport.enforced?(transport.ok?'래핑 전 운반 가정 통과':'래핑 전 운반 가정 미달'):'래핑 후 운반 판정 보류';
  if(transport.enforced&&!transport.ok)return {ok:false,reason:transport.reason,loads,transport,statics};
  const store=storeReport(boxes,p);if(c.storeStrict&&store.violations)return {ok:false,reason:'필수 진열 순서의 접근 차단',loads,transport,store};
  return {ok:true,loads,transport,store,statics};
}

// Volumetric demand, including quantities, gives flexible target bands.
export function categoryTarget(zone,p,boxes,remaining) {
  const demand=[0,0,0];for(const b of boxes)demand[b.zone]+=volume(b);for(const r of remaining.filter(r=>r.p===p.id))demand[r.zone]+=r.count*volume(r);
  const total=demand.reduce((a,b)=>a+b,0)||1;let before=0;
  for(const z of p.order){if(z===zone)return p.w*(before+demand[z]/2)/total;before+=demand[z];}return p.w/2;
}
export function placementQuality(b,local,p,c,remaining,physical,path) {
  const next=[...local,b],height=Math.max(...next.map(top)),space=next.reduce((s,q)=>s+volume(q),0)/(p.w*p.d*height);
  const same=local.filter(q=>q.sku===b.sku),near=same.length?Math.min(...same.map(q=>Math.hypot(q.x+q.w/2-b.x-b.w/2,q.z+q.d/2-b.z-b.d/2,q.y+q.h/2-b.y-b.h/2))):0;
  const grouping=clamp(1-Math.abs(b.x+b.w/2-categoryTarget(b.zone,p,next,remaining))/p.w,0,1);
  const store=clamp(.4*grouping+.3/(1+near)+.3/(1+physical.store.rehandles+physical.store.fragments),0,1);
  const motion=clamp(1-path.seconds/45,0,1),strength=clamp(1-physical.loads.maxRatio,0,1);
  const sw=c.policy==='store'?.55:c.policy==='density'?0:clamp(c.storeWeight/100,0,.65);
  const score=100*((1-sw)*(.80*space+.12*motion+.08*strength)+sw*store);
  return {score,space,store,motion,physical:supportOf(b,local).ratio*(.75+.25*strength)};
}
