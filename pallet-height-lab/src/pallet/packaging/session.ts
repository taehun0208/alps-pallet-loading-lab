import { rng, shuffled } from '../rng';
import { virtualObservation } from '../remainingSites';
import { balance } from '../features';
import { calculateLoads, top, volume, withLoads } from '../geometry';
import type { Observation, Placement, Scenario } from '../types';
import { boxType, validateSpec } from './spec';
import { inspectConstraints } from '../constraints';
import { METHODS, planPackaging, type Method, type PackagePlan, type PackageSettings } from './planner';
export type PackageEvent={kind:'damaged'}|{kind:'missing'}|{kind:'dimensions';length:number;width:number;height:number}|{kind:'weight';weight:number}|{kind:'type';typeId:string};
export interface PackageRecord {id:string;typeId:string;status:'placed'|'failed'|'damaged'|'missing';reason:string;plan:PackagePlan;placements:Placement[]}
export interface PackageSession {scenario:Scenario;items:Observation[];cursor:number;placements:Placement[];records:PackageRecord[];replanCount:number;events:{step:number;event:PackageEvent}[]}
export function newSession(scenario:Scenario,seed=scenario.arrival.seed):PackageSession{
 const items=shuffled(scenario.types.flatMap(t=>Array.from({length:t.quantity},(_,i)=>virtualObservation(t,`${t.id}-${i+1}`))),rng(seed));
 return {scenario:structuredClone(scenario),items,cursor:0,placements:[],records:[],replanCount:0,events:[]};
}
export function remainingInventory(s:PackageSession){const counts:Record<string,number>={};for(const b of s.items.slice(s.cursor+1))if(b.status!=='damaged'&&b.status!=='missing')counts[b.typeId]=(counts[b.typeId]??0)+1;return counts;}
const signature=(s:PackageSession)=>JSON.stringify([s.cursor,s.items[s.cursor],s.placements,s.scenario.constraints,s.scenario.pallet,s.replanCount]);
export function preview(s:PackageSession,method:Method,settings:PackageSettings):PackagePlan{
 const contextSignature=signature(s),current=s.items[s.cursor];if(!current||current.status==='damaged'||current.status==='missing')return {contextSignature,candidates:[],selectedId:null,generated:0,checked:0,valid:0,orientationRejected:0,orientationOptions:6,rejected:{},milliseconds:0,futureChecks:0,cacheHits:0,sequences:[],capped:false};
 return {...planPackaging({scenario:{pallet:s.scenario.pallet,types:s.scenario.types,constraints:s.scenario.constraints},placements:s.placements,current,remaining:remainingInventory(s),method,settings,step:s.cursor}),contextSignature};
}
export function commit(s:PackageSession,plan:PackagePlan):PackageSession{
 const current=s.items[s.cursor];if(!current||plan.contextSignature!==signature(s))return s;const proposed=plan.candidates.find(c=>c.id===plan.selectedId&&c.valid&&c.placement.id===current.id),check=proposed?inspectConstraints(proposed.placement,current,s.placements,s.scenario.pallet,s.scenario.constraints):null,chosen=check&&!check.reasons.length?proposed:undefined,status=current.status==='damaged'?'damaged':current.status==='missing'?'missing':chosen?'placed':'failed',placements=chosen?withLoads(check!.stack):s.placements;
 return {...s,cursor:s.cursor+1,placements,records:[...s.records,{id:current.id,typeId:current.typeId,status,reason:chosen?'모든 하드 제약 통과':current.status==='damaged'?'파손 격리':current.status==='missing'?'누락 수량 차감':[...new Set(plan.candidates.flatMap(c=>c.reasons))].slice(0,4).join(' / ')||'유효 후보 없음',plan,placements}]};
}
export function applyEvent(s:PackageSession,event:PackageEvent):PackageSession{
 const current=s.items[s.cursor];if(!current)throw Error('현재 입고 박스가 없습니다.');let updated=structuredClone(current);
 if(event.kind==='damaged'||event.kind==='missing')updated.status=event.kind;
 else if(event.kind==='type'){const type=s.scenario.types.find(t=>t.id===event.typeId);if(!type)throw Error('알 수 없는 박스 종류');updated=virtualObservation(type,current.id);}
 else {const spec=updated.packaging;if(!spec)throw Error('포장 정보 없음');if(event.kind==='dimensions'){
  const scale={x:event.length/spec.length,y:event.width/spec.width,z:event.height/spec.height};spec.centerOfGravity={x:spec.centerOfGravity.x*scale.x,y:spec.centerOfGravity.y*scale.y,z:spec.centerOfGravity.z*scale.z};spec.length=event.length;spec.width=event.width;spec.height=event.height;
 }else spec.grossWeight=event.weight;
 validateSpec(spec);const t=boxType(spec);updated={...virtualObservation(t,current.id),status:'resized'};}
 const items=[...s.items];items[s.cursor]=updated;
 return {...s,items,replanCount:s.replanCount+1,events:[...s.events,{step:s.cursor,event}]};
}
export function summary(s:PackageSession){const p=s.scenario.pallet,loads=calculateLoads(s.placements),center=balance(s.placements,p).center,placed=s.placements.length;return {utilization:s.placements.reduce((n,b)=>n+volume(b.size),0)/(p.width*p.depth*p.maxHeight),packed:placed,failed:s.records.filter(r=>r.status==='failed').length,excluded:s.records.filter(r=>r.status==='damaged'||r.status==='missing').length,support:placed?s.placements.reduce((n,b)=>n+b.supportRatio,0)/placed:0,maxLoad:Math.max(0,...s.placements.map(b=>{const cap=b.packaging?.maxTopLoad??b.maxLoadKg??100;return cap?loads[b.id]/cap:0;})),cogDeviation:placed?Math.hypot(center.x-p.width/2,center.y-p.depth/2):0,planningMs:s.records.reduce((n,r)=>n+r.plan.milliseconds,0)/Math.max(1,s.records.length),cycleSeconds:s.records.reduce((n,r)=>n+(r.plan.candidates.find(c=>c.id===r.plan.selectedId)?.path.seconds??0),0),replans:s.replanCount,height:Math.max(0,...s.placements.map(top))};}
export interface ComparisonRow {method:Method;metrics:ReturnType<typeof summary>;placements:Placement[];sequence:string[];cappedSteps:number}
export function compareMethods(source:PackageSession,settings:PackageSettings,onProgress?:(method:Method,step:number,total:number)=>void):ComparisonRow[]{
 const sequence=source.items.map(b=>structuredClone(b));
 return (Object.keys(METHODS) as Method[]).map(method=>{let state:PackageSession={...newSession(source.scenario),items:structuredClone(sequence),events:source.events,replanCount:source.replanCount};while(state.cursor<state.items.length){state=commit(state,preview(state,method,settings));onProgress?.(method,state.cursor,state.items.length);}return {method,metrics:summary(state),placements:state.placements,sequence:sequence.map(b=>b.id),cappedSteps:state.records.filter(r=>r.plan.capped).length};});
}

