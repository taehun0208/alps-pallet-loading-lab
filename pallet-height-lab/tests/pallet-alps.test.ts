import { describe,it,expect } from 'vitest';
import { runAlpsTrial,defaultAlpsConfig,categoryMap,shortlistAlps,pairedRoutingEffect } from '../src/pallet/alps/experiment';
import { candidateSet } from '../src/pallet/candidates';
import { inspectConstraints } from '../src/pallet/constraints';
import { distribution } from '../src/pallet/benchmark/statistics';
import type { AlgorithmEntry } from '../src/pallet/benchmark/model';

function fixture(){const c=defaultAlpsConfig();c.scenario.types=[{id:'A',name:'A',size:{w:400,d:400,h:200},weight:3,quantity:8,color:'#6abbaa',orientations:[0],maxLoadKg:100}];c.scenario.pallet={width:400,depth:400,maxHeight:800};c.scenario.constraints.stability={maxSlenderness:10,minMarginRatio:0,lateralAccelerationG:0,loadSafetyFactor:1};c.scenario.constraints.horizontalGap=0;c.settings.maxCandidates=8;c.trialMs=30000;return c;}
describe('ALPS same-capacity causal experiment',()=>{
 it('uses identical actual arrivals and fingerprint, independently of classification and algorithm',()=>{
  const c=fixture(),a=runAlpsTrial(c,'blb','pooled',42,'discovery'),b=runAlpsTrial(c,'blb','dedicated',42,'discovery');
  expect(a.arrivals).toEqual(b.arrivals);expect(a.fingerprint).toBe(b.fingerprint);expect(a.placed).toBe(8);expect(b.placed).toBe(8);
  expect(c.scenario.types[0].quantity).toBe(8);expect(c.scenario.pallet.maxHeight).toBe(800);
  for(const row of [a,b])for(const step of row.trace)for(const stack of [...step.source,...step.destination])for(let i=0;i<stack.length;i++){
   const p=stack[i];const o={id:p.id,typeId:p.typeId,size:c.scenario.types[0].size,weight:p.weight,status:'normal' as const,orientationAllowed:[0 as const],maxLoadKg:100};
   expect(inspectConstraints(p,o,stack.slice(0,i),c.scenario.pallet,c.scenario.constraints).reasons).toEqual([]);
  }
 });
 it('keeps category independent of physical properties and deterministically handles skewed demand',()=>{
  const c=fixture(),map=categoryMap(c.scenario,42,.75);expect(Object.values(map).filter(g=>g==='apparel')).toHaveLength(6);
  const b=runAlpsTrial(c,'blb','dedicated',42,'discovery'),d=runAlpsTrial({...c,apparelShare:.75},'blb','dedicated',42,'discovery'),fallback=runAlpsTrial({...c,apparelShare:.75},'blb','overflow',42,'discovery');
  expect(b.placed).toBe(8);expect(d.placed).toBe(6);expect(fallback.placed).toBe(8);expect(fallback.mixed).toBe(2);
 });
 it('passes only arrived current box, per-pallet placements, counts and public physical settings',()=>{
  const c=fixture(),seen:string[]=[];const spy:AlgorithmEntry={id:'spy',name:'spy',scope:'online',family:'test',description:'',plan:input=>{
   expect(input).not.toHaveProperty('arrivals');expect(input).not.toHaveProperty('groups');expect(input).not.toHaveProperty('scenario');expect(input.available).toBeUndefined();
   seen.push(input.current.id);return {...candidateSet(input),runId:input.runId,stepId:input.stepId,selectedId:null,nodes:0,rolloutCalls:0,milliseconds:0,explanation:[],virtualSequences:[],rejections:{}};
  }};
  const r=runAlpsTrial(c,'spy','dedicated',42,'discovery',spy);expect(new Set(seen).size).toBe(8);expect(r.placed).toBe(0);expect(r.trace).toHaveLength(8);
 });
 it('records hostile proposals as hard violations, never commits or recommends them',()=>{
  const c=fixture(),malicious:AlgorithmEntry={id:'hostile',name:'hostile',scope:'online',family:'test',description:'',plan:input=>{
   const a=candidateSet(input),can=a.candidates.find(c=>c.valid)!;can.placement.position.x=-900;
   return {...a,runId:input.runId,stepId:input.stepId,selectedId:can.id,nodes:a.candidates.length,rolloutCalls:0,milliseconds:0,explanation:[],virtualSequences:[],rejections:{}};
  }};
  const r=runAlpsTrial(c,'hostile','dedicated',42,'discovery',malicious);expect(r.placed).toBe(0);expect(r.rejected).toBeGreaterThan(0);expect(shortlistAlps([r])).toEqual([]);
 });
 it('temporary moves are caused by blocked priority shipping, never invented for simultaneous shipping',()=>{
  const c=fixture();const priority=runAlpsTrial(c,'blb','pooled',42,'discovery'),simultaneous=runAlpsTrial({...c,shipment:'simultaneous'},'blb','pooled',42,'discovery');
  expect(simultaneous.redistributed).toBe(8);expect(simultaneous.rehandles).toBe(0);expect(simultaneous.moves).toBe(8);
  expect(priority.rehandles).toBeGreaterThan(0);expect(priority.moves).toBe(priority.redistributed+priority.rehandles);
  const blocked=runAlpsTrial({...c,bufferCapacity:0},'blb','pooled',42,'discovery');expect(blocked.redistributed).toBeLessThan(8);expect(blocked.trace.length).toBeLessThanOrEqual(16);expect(blocked.failures['임시 버퍼 용량 부족']).toBe(1);
  for(const step of priority.trace.filter(t=>t.phase==='redistribution')){const ids=[...step.source.flat().map(p=>p.id),...step.destination.flat().map(p=>p.id),...step.held];expect(new Set(ids).size).toBe(ids.length);expect(ids).toHaveLength(priority.placed);expect(step.held.length).toBeLessThanOrEqual(c.bufferCapacity);}
 });
 it('seed reproduces decisions; shortlist uses discovery only and paired deltas need matched seeds',()=>{
  const c=fixture(),a=runAlpsTrial(c,'random','pooled',42,'discovery'),b=runAlpsTrial(c,'random','pooled',42,'discovery');
  const positions=(r:typeof a)=>r.trace.map(t=>t.source.map(ps=>ps.map(p=>[p.id,p.position,p.orientation])));expect(positions(a)).toEqual(positions(b));
  const d=runAlpsTrial(c,'blb','dedicated',42,'discovery');const held={...d,id:'hold',split:'holdout' as const,algorithm:'random',redistributed:99};expect(shortlistAlps([d,held]).map(r=>r.algorithm)).toEqual(['blb']);
  expect(pairedRoutingEffect([d,a],'dedicated','discovery').every(r=>r.completion.n===0)).toBe(true);expect(distribution([1,1]).ci95).toEqual([1,1]);
 });
 it('does not hide unknown robot validation or accept offline-information adapters',()=>{
  const c=fixture();expect(c.scenario.constraints.robotMode).toBe('ideal');
  expect(()=>runAlpsTrial(c,'offline-stock','pooled',42,'discovery')).toThrow(/오프라인/);
  const r=runAlpsTrial({...c,trialMs:-1},'blb','dedicated',42,'discovery');expect(r.status).toBe('timeout');expect(shortlistAlps([r])).toEqual([]);
 });
});
