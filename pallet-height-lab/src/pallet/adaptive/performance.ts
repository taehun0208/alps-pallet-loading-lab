import {convexHull} from '../geometry';
import type {Vec3} from '../types';
import type {Box,Config,Frame,Rect} from './types';
import {area,bounds,transformPoint,volumes,worldParts} from './shape';
import {assess} from './mechanics';
export type Point={x:number;y:number};
export type Topic='fitness'|'space'|'stability'|'robot'|'compute'|'robustness'|'comparison';
export const topics:Record<Topic,string>={fitness:'적재 적합성',space:'공간 활용',stability:'안정성',robot:'로봇 동작',compute:'계산 성능',robustness:'강건성',comparison:'알고리즘 비교'};
export function supportHull(rects:Rect[]){return convexHull(rects.flatMap(r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.d},{x:r.x,y:r.y+r.d}]));}
export function margin(hull:Point[],point:Point):number|null {
 if(hull.length<3)return null;
 return Math.min(...hull.map((a,i)=>{const b=hull[(i+1)%hull.length];return((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y);}));
}
// Ray of inertial resultant displacement. Acceleration of the platform is opposite.
export function directionalLimits(hull:Point[],center:Vec3|null){
 if(!center||center.z<=0||margin(hull,center)===null)return [];
 return Array.from({length:8},(_,i)=>{const angle=i*Math.PI/4,dx=Math.cos(angle),dy=Math.sin(angle);let distance=Infinity;
  hull.forEach((a,k)=>{const b=hull[(k+1)%hull.length],length=Math.hypot(b.x-a.x,b.y-a.y),nx=(b.y-a.y)/length,ny=-(b.x-a.x)/length,dot=nx*dx+ny*dy;
   if(dot>1e-9)distance=Math.min(distance,((a.x-center.x)*nx+(a.y-center.y)*ny)/dot);
  });return {angle:i*45,g:Math.max(0,distance)/center.z};
 });
}
export function percentile(values:number[],p:number):number|null {const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]:null;}
export function analyzeFrame(f:Frame,c:Config,total:number){
 const check=assess(f.placed,c),mass=f.placed.reduce((n,p)=>n+p.box.mass,0);
 const center:Vec3|null=mass?f.placed.reduce((v,p)=>{const q=transformPoint(p.box.com,p.box,p),w=p.box.mass/mass;return{x:v.x+q.x*w,y:v.y+q.y*w,z:v.z+q.z*w};},{x:0,y:0,z:0}):null;
 const floor=Object.values(check.loads).flatMap(l=>l.contacts.filter(k=>k.id==='@floor').map(k=>k.rect)),hull=supportHull(floor),globalMargin=center?margin(hull,center):null;
 const boxes=f.placed.map(p=>{const load=check.loads[p.box.id],boxHull=supportHull(load.contacts.map(k=>k.rect)),support=area(load.contacts.map(k=>k.rect))/Math.max(1,area(worldParts(p))),localMargin=margin(boxHull,load.resultant);
  return{id:p.box.id,support,marginMm:localMargin,hull:boxHull,resultant:load.resultant,aboveKg:load.aboveKg,capacityKg:load.capacityKg,loadRatio:load.capacityKg===null||load.capacityKg===0?null:load.aboveKg/load.capacityKg,strengthSource:p.box.strength.source,
   reasons:[...(support<c.supportRatio-1e-6?['support']:[]),...(localMargin===null||localMargin<c.edgeMarginMm-1e-6?['tipping']:[]),...(load.capacityKg!==null&&load.aboveKg>load.capacityKg+1e-6?['load']:[]),...(load.aboveKg>1e-6&&load.capacityKg===null?['strength']:[])]};
 });
 const occupied=f.placed.reduce((n,p)=>n+volumes(p.box).occupiedVolume,0),nominal=f.placed.reduce((n,p)=>n+volumes(p.box).nominalVolume,0);
 return{center,mass,hull,globalMarginMm:globalMargin,tippingG:center&&center.z>0&&globalMargin!==null?Math.max(0,globalMargin)/center.z:null,directions:directionalLimits(hull,center),boxes,
  minSupport:boxes.length?Math.min(...boxes.map(b=>b.support)):null,minMarginMm:boxes.length&&boxes.every(b=>b.marginMm!==null)?Math.min(...boxes.map(b=>b.marginMm!)):null,
  reasons:check.reasons,geometryStatus:!f.placed.length?'미검증':check.reasons.length?'실패':'통과',overallStatus:check.reasons.length?'실패':'미검증',
  occupiedVolumeMm3:occupied,nominalVolumeMm3:nominal,utilization:occupied/(c.pallet.width*c.pallet.depth*c.pallet.maxHeight),completion:total?f.placed.length/total:0,
  heightMm:Math.max(0,...f.placed.map(p=>{const r=bounds(worldParts(p));return r.z+r.h;})),unknownStrength:boxes.filter(b=>b.capacityKg===null).length};
}
export interface TraceRecord {frame:Frame;analysis:ReturnType<typeof analyzeFrame>;planMs:number;pathMm:number|null;workSeconds:number;placedId:string|null;candidateCount:number;validCandidates:number}
export function captureRecord(frame:Frame,previous:TraceRecord|undefined,c:Config,total:number):TraceRecord {
 const added=frame.placed.find(p=>!previous?.frame.placed.some(q=>q.box.id===p.box.id)),path=frame.selected?.path;
 return {frame:structuredClone({...frame,candidates:[]}),analysis:analyzeFrame(frame,c,total),planMs:Math.max(0,frame.planningMs-(previous?.frame.planningMs||0)),
  pathMm:added&&path?.length?path.slice(1).reduce((n,v,i)=>n+Math.hypot(v.x-path[i].x,v.y-path[i].y,v.z-path[i].z),0):null,
  workSeconds:Math.max(0,frame.executionSeconds-(previous?.frame.executionSeconds||0)),placedId:added?.box.id||null,candidateCount:frame.candidates.length,validCandidates:frame.candidates.filter(v=>!v.reasons.length).length};
}
export function latency(records:TraceRecord[],deadline:number){const steps=records.filter(r=>r.frame.tick>0),times=steps.map(r=>r.planMs);return {count:steps.length,p50:percentile(times,.5),p95:percentile(times,.95),p99:percentile(times,.99),max:percentile(times,1),validOnTime:steps.length?steps.filter(r=>r.planMs<=deadline&&r.validCandidates>0).length/steps.length:null,onTime:steps.length?steps.filter(r=>r.planMs<=deadline).length/steps.length:null};}
export interface Trial {config:Config;boxes:Box[];frame:Frame;history?:TraceRecord[]}
function stable(value:unknown):unknown {return value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;}
export function conditionKey(row:Trial){const {mode:_,...config}=row.config;return JSON.stringify(stable({config,boxes:row.boxes}));}
export function pairedBaseline(row:Trial,rows:Trial[]){return rows.find(b=>b.config.mode==='A'&&conditionKey(row)===conditionKey(b));}
export function robustness(rows:Trial[],mode:Config['mode']){const selected=rows.filter(r=>r.config.mode===mode&&r.frame.done);return{count:selected.length,success:selected.length?selected.filter(r=>r.frame.placed.length===r.boxes.length&&!assess(r.frame.placed,r.config).reasons.length).length/selected.length:null,worst:selected.length?Math.min(...selected.map(r=>r.frame.placed.length/r.boxes.length)):null,p05:percentile(selected.map(r=>r.frame.placed.length/r.boxes.length),.05)};}
export function diagnostics(records:TraceRecord[],c:Config){
 const items:{topic:Topic;tick:number;id:string;label:string;value:string;priority:number}[]=[];
 for(const r of records){
  for(const b of r.analysis.boxes)if(b.reasons.length)items.push({topic:'stability',tick:r.frame.tick,id:b.id,label:'하드 제약 위반',value:b.reasons.join(' / '),priority:0});
 }
 const margins=records.flatMap(r=>r.analysis.boxes.filter(b=>b.marginMm!==null).map(b=>({r,b}))).sort((a,b)=>a.b.marginMm!-b.b.marginMm!);
 if(margins[0]){const {r,b}=margins[0];items.push({topic:'stability',tick:r.frame.tick,id:b.id,label:'국부 합력 지지 여유 최저',value:b.marginMm!.toFixed(1)+' mm',priority:1});}
 const tipping=records.filter(r=>r.analysis.tippingG!==null).sort((a,b)=>a.analysis.tippingG!-b.analysis.tippingG!)[0];
 if(tipping)items.push({topic:'stability',tick:tipping.frame.tick,id:tipping.placedId||'',label:'전체 정적 전도한계 최저',value:tipping.analysis.tippingG!.toFixed(3)+' g · 근사',priority:2});
 const slow=records.filter(r=>r.frame.tick>0).sort((a,b)=>b.planMs-a.planMs)[0];
 if(slow)items.push({topic:'compute',tick:slow.frame.tick,id:slow.frame.selected?.boxId||'',label:'계산 지연 최대',value:slow.planMs.toFixed(1)+' ms',priority:slow.planMs>c.timeBudgetMs?1:3});
 const failed=records.find(r=>r.frame.events.some(e=>e.tick===r.frame.tick&&e.reasons.length));
 if(failed){const event=failed.frame.events.find(e=>e.tick===failed.frame.tick&&e.reasons.length)!;items.push({topic:'fitness',tick:failed.frame.tick,id:event.id,label:'실행 거절 · 적재물 위반과 구분',value:event.reasons.join(' / '),priority:4});}
 return items.sort((a,b)=>a.priority-b.priority||a.tick-b.tick).slice(0,6);
}
