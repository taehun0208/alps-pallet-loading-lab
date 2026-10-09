// Staged verification of the single-robot harness: smoke -> boundary/regression -> normal ->
// single exception -> combined exception -> reproducibility and order-invariance.
import { describe,it,expect } from 'vitest';
import { runSingleRobot,catalogue,type SingleRobotRun } from '../src/pallet/singleRobot/compare';
import { buildCase,SITUATIONS,selectSituations,type CaseInput,type HarnessEvent } from '../src/pallet/singleRobot/situations';
import { compactPolicy,strategyPolicy,caseSeeds } from '../src/pallet/singleRobot/config';
import { inspectConstraints } from '../src/pallet/constraints';
import type { BoxType,PlanningInput } from '../src/pallet/types';

const base=buildCase('mixed-small','dev',1);
const type=(id:string,w:number,d:number,h:number,weight:number,quantity=1):BoxType=>({id,name:id,size:{w,d,h},weight,quantity,orientations:[0,90],color:'#999',material:'plastic',maxLoadKg:200,maxLoadSource:'synthetic',strengthFactor:1,friction:.6});
function makeCase(types:BoxType[],sequence:string[],o:{pallet?:{width:number;depth:number;maxHeight:number};bufferSize?:number;events?:HarnessEvent[]}={}):CaseInput{
 const scenario=structuredClone(base.scenario);scenario.types=types;if(o.pallet)scenario.pallet=o.pallet;
 return {...structuredClone(base),scenario,sequence,events:o.events??[],bufferSize:o.bufferSize??0};
}
/** Box conservation and no double loading, for any run. */
function conserved(r:SingleRobotRun){
 const p=r.performance;expect(p.completed+p.quarantinedBoxes+p.unplaceable+p.isolatedDamaged+p.missing).toBe(p.total);
 const placed=r.history.filter(h=>h.action==='place').map(h=>h.box);expect(new Set(placed).size).toBe(placed.length);
 expect(r.pallets.filter(x=>x.closedBy!=='quarantined').reduce((n,x)=>n+x.boxes,0)).toBe(p.completed);
}
const strip=(r:SingleRobotRun)=>JSON.parse(JSON.stringify(r,(k,v)=>k==='ms'||k==='samplesMs'||k==='plannerMs'?undefined:v));

describe('1 smoke',()=>{
 it('handles an empty order without inventing completion',()=>{
  const r=runSingleRobot(makeCase([],[]),compactPolicy());
  expect(r.performance.total).toBe(0);expect(r.performance.pallets).toBe(0);expect(r.performance.completionRate).toBeNull();
  expect(r.performance.utilization).toBeNull();expect(r.stability.minLocalReserveMm).toBeNull();expect(r.robustness.success).toBe(false);
 });
 it('places a single box, and a box that exactly fills the pallet volume',()=>{
  const one=runSingleRobot(makeCase([type('A',400,300,200,5)],['A']),compactPolicy());conserved(one);
  expect(one.performance.completed).toBe(1);expect(one.performance.pallets).toBe(1);expect(one.fitness.status).toBe('pass');
  const exact=runSingleRobot(makeCase([type('F',1000,800,600,20)],['F'],{pallet:{width:1000,depth:800,maxHeight:600}}),compactPolicy());conserved(exact);
  expect(exact.performance.completed).toBe(1);expect(exact.pallets[0].fill).toBeCloseTo(1);
 });
 it('isolates over-height and over-payload boxes that fit no empty pallet, and stops cleanly',()=>{
  const r=runSingleRobot(makeCase([type('T',400,300,2000,5),type('H',400,300,200,60),type('A',400,300,200,5)],['T','H','A'],{bufferSize:2}),compactPolicy());conserved(r);
  expect(r.performance.unplaceable).toBe(2);expect(r.performance.completed).toBe(1);expect(r.performance.completionRate).toBeCloseTo(1/3);expect(r.robustness.success).toBe(false);
  expect(r.history.filter(h=>h.action==='unplaceable')).toHaveLength(2);
 });
});

describe('2 boundary and regression',()=>{
 const pallet={width:2000,depth:2000,maxHeight:2000},s={...base.scenario,pallet,constraints:{...base.scenario.constraints,robotMode:'ideal' as const,heavyRule:'off' as const,standingHeight:{enabled:false,maxRiseMm:100}}};
 const obs=(id:string,w:number,d:number,h:number,weight:number)=>({id,typeId:id,size:{w,d,h},weight,status:'normal' as const,orientationAllowed:[0 as const],material:'plastic' as const,maxLoadKg:500});
 it('applies the support threshold exactly at the boundary (92%)',()=>{
  const lower=inspectConstraints({id:'L',typeId:'L',size:{w:1000,d:1000,h:200},weight:20,position:{x:0,y:0,z:0},orientation:0,supports:[],supportRatio:0,loadAbove:0,material:'plastic',maxLoadKg:500},obs('L',1000,1000,200,20),[],pallet,s.constraints).stack;
  const on=(dx:number)=>inspectConstraints({id:'U',typeId:'U',size:{w:1000,d:1000,h:200},weight:5,position:{x:dx,y:0,z:200},orientation:0,supports:[],supportRatio:0,loadAbove:0,material:'plastic',maxLoadKg:500},obs('U',1000,1000,200,5),lower,pallet,s.constraints).reasons;
  expect(on(70).some(r=>r.startsWith('SUPPORT'))).toBe(false);  // 93% supported
  expect(on(90).some(r=>r.startsWith('SUPPORT'))).toBe(true);   // 91% supported
 });
 it('retries a box on a fresh pallet after an exchange (no buffer)',()=>{
  const r=runSingleRobot(makeCase([type('A',1000,800,400,10),type('B',1000,800,200,5)],['A','B'],{pallet:{width:1000,depth:800,maxHeight:500},bufferSize:0}),compactPolicy());conserved(r);
  expect(r.performance.completed).toBe(2);expect(r.performance.pallets).toBe(2);expect(r.performance.closeReasons['candidate-exhaustion']).toBe(1);
 });
 it('enforces 0/2/4 buffer capacity and drains every waiting box at order end',()=>{
  for(const bufferSize of [0,2,4]){
   // Each box fills one pallet; this forces buffer overflow and final flushing.
   const c=makeCase([type('A',1000,800,400,10,7)],Array(7).fill('A'),{pallet:{width:1000,depth:800,maxHeight:400},bufferSize});
   const r=runSingleRobot(c,compactPolicy());conserved(r);expect(r.performance.completed).toBe(7);
   const waiting=new Set<string>();let peak=0;
   for(const h of r.history){if(h.action==='buffer'){expect(waiting.has(h.box!)).toBe(false);waiting.add(h.box!);}
    if(h.action==='unbuffer'||h.action==='unplaceable')waiting.delete(h.box!);
    peak=Math.max(peak,waiting.size);expect(waiting.size).toBeLessThanOrEqual(bufferSize);}
   expect(peak).toBe(bufferSize);expect(waiting.size).toBe(0);
  }
 });
 it('rejects invalid buffer capacities before planning',()=>{
  for(const bufferSize of [-1,.5,NaN])expect(()=>runSingleRobot(makeCase([],[],{bufferSize}),compactPolicy())).toThrow(/버퍼 용량/);
 });
 it('rejects duplicate catalogue IDs and inconsistent arrival sequences',()=>{
  expect(()=>catalogue([type('A',1,1,1,1),type('A',2,2,2,2)])).toThrow(/중복 상품 ID/);
  expect(()=>runSingleRobot(makeCase([type('A',400,300,200,5,2)],['A']),compactPolicy())).toThrow(/수량 불일치/);
 });
});

describe('3 normal comparison inputs',()=>{
 it('separates ordinary, boundary and exception trials and rejects unknown selections',()=>{
  expect(selectSituations('core').every(s=>!s.events&&!['mixed-heavy-late','mixed-large-late','mixed-support-80'].includes(s.id))).toBe(true);
  // Buffer 0/4 and the standing-height rule are variants of the fixed main conditions, so they are boundary trials.
  expect(selectSituations('boundary').map(s=>s.id).sort()).toEqual(['mixed-buffer-4','mixed-heavy-late','mixed-large-late','mixed-no-buffer','mixed-standing-rule','mixed-support-80']);
  expect(selectSituations('events').every(s=>!!s.events)).toBe(true);
  expect(selectSituations('core',['event-missing']).map(s=>s.id)).toEqual(['event-missing']);
  expect(()=>selectSituations('typo')).toThrow();expect(()=>selectSituations('core',['typo'])).toThrow();
 });
 it('changes only buffer capacity across the paired 0/2/4 spot experiments',()=>{
  const cases=['mixed-no-buffer','mixed-48','mixed-buffer-4'].map(id=>buildCase(id,'eval',11));
  expect(cases.map(c=>c.bufferSize)).toEqual([0,2,4]);
  for(const c of cases){expect(c.scenario).toEqual(cases[0].scenario);expect(c.sequence).toEqual(cases[0].sequence);expect(c.events).toEqual([]);expect(c.seeds).toEqual(cases[0].seeds);}
 });
 it('keeps the same box multiset across arrival seeds and orders large boxes last when asked',()=>{
  const a=buildCase('mixed-48','eval',11),b=SITUATIONS.find(s=>s.id==='mixed-48')!.build('eval',{...caseSeeds(11),arrival:999});
  expect([...a.sequence].sort()).toEqual([...b.sequence].sort());expect(a.sequence).not.toEqual(b.sequence);
  const late=buildCase('mixed-large-late','eval',11),vol=new Map(late.scenario.types.map(t=>[t.id,t.size.w*t.size.d*t.size.h]));
  expect(late.sequence.every((id,i)=>i===0||vol.get(late.sequence[i-1])!<=vol.get(id)!)).toBe(true);
  const rep=buildCase('repeated-sku','eval',11);expect(rep.scenario.types.length).toBe(5);expect(rep.sequence).toHaveLength(60);
 });
});

describe('4 single exceptions',()=>{
 const types=[type('A',600,400,300,12,6),type('B',400,300,250,7,6)],seq=['A','B','A','B','A','B','A','B','A','B','A','B'];
 const run=(events:HarnessEvent[],audit?:(i:PlanningInput)=>void,bufferSize=2)=>runSingleRobot(makeCase(types,seq,{events,bufferSize}),compactPolicy(),{audit});
 it('missing: corrects the count only when the gap is observed',()=>{
  const seen:number[]=[];const r=run([{kind:'missing',at:4}],i=>seen.push(i.pending!.unarrived[i.types.find(t=>t.size.w===600)!.id]));conserved(r);
  expect(r.performance.missing).toBe(1);expect(r.performance.completed).toBe(11);expect(r.performance.completionRate).toBe(1);expect(r.robustness.outcomes['count-corrected']).toBe(1);
  // Inputs at arrivals 2 and 3 still count the A that will go missing (6 declared - 2 arrived = 4).
  // Arrival 4 has no planner input; from arrival 5 the count is 6 - 2 arrived - 1 missing = 3.
  expect(seen[2]).toBe(4);expect(seen[3]).toBe(4);expect(seen[4]).toBe(3);expect(seen).toHaveLength(11);
 });
 it('damaged: isolates without placing',()=>{
  const r=run([{kind:'damaged',at:3}]);conserved(r);expect(r.performance.isolatedDamaged).toBe(1);expect(r.performance.completed).toBe(11);
  const id=r.history.find(h=>h.action==='isolate-damaged')!.box;expect(r.history.some(h=>h.action==='place'&&h.box===id)).toBe(false);
 });
 it('resize: the planner sees the corrected size only from that arrival on',()=>{
  const sizes:string[]=[];const r=run([{kind:'resize',at:2,size:{w:640,d:410,h:320},weight:13}],i=>sizes.push(`${i.current.size.w}`));conserved(r);
  expect(sizes[2]).toBe('640');expect(sizes[0]).toBe('600');expect(r.robustness.outcomes.placed).toBe(1);
 });
 it('mismeasure: detects the true size at pick and replans before placing',()=>{
  const r=run([{kind:'mismeasure',at:1,size:{w:450,d:330,h:260}}]);conserved(r);
  const remeasure=r.history.find(h=>h.action==='remeasure');expect(remeasure).toBeDefined();
  const placed=r.history.find(h=>h.action==='place'&&h.box===remeasure!.box);expect(placed).toBeDefined();expect(r.robustness.outcomes['remeasured-placed']).toBe(1);
 });
 it('resize beyond any pallet: isolates instead of claiming completion',()=>{
  const r=run([{kind:'resize',at:5,size:{w:5000,d:400,h:250},weight:7}]);conserved(r);
  expect(r.robustness.outcomes['isolated-unplaceable']).toBe(1);expect(r.performance.completionRate).toBeLessThan(1);expect(r.robustness.success).toBe(false);
 });
 it('buffer-down: no box enters the buffer during the outage',()=>{
  const c=buildCase('mixed-48','dev',2),down={kind:'buffer-down' as const,at:5,duration:40},r=runSingleRobot({...c,events:[down]},compactPolicy());conserved(r);
  expect(r.history.some(h=>h.action==='buffer'&&h.arrival>=5&&h.arrival<45)).toBe(false);
 });
 it('disturb: quarantines an invalid pallet and keeps loading a valid one',()=>{
  const bad=run([{kind:'disturb',at:6,shiftMm:5000}]);conserved(bad);
  expect(bad.robustness.outcomes['pallet-quarantined']).toBe(1);expect(bad.performance.quarantinedBoxes).toBeGreaterThan(0);expect(bad.fitness.quarantinedPallets).toBe(1);
  expect(bad.performance.completionRate).toBeLessThan(1);
  const ok=run([{kind:'disturb',at:6,shiftMm:0}]);conserved(ok);expect(ok.robustness.outcomes['verified-continue']).toBe(1);
 });
});

describe('5 combined exceptions',()=>{
 it('conserves boxes, resolves every event and never double-loads under combined events',()=>{
  for(const policy of [compactPolicy(),strategyPolicy('strategy-greedy',1.5)])for(const d of [1,2]){
   const c=buildCase('event-combined','dev',d);expect(c.events).toHaveLength(6);
   const r=runSingleRobot(c,policy);conserved(r);expect(r.robustness.outcomes.unresolved??0).toBe(0);expect(r.robustness.events).toBe(6);
  }
 },60000);
 it('applies identical events to every policy',()=>{
  const a=buildCase('event-combined','eval',11),b=buildCase('event-combined','eval',11);
  expect(runSingleRobot(a,compactPolicy()).events).toEqual(runSingleRobot(b,strategyPolicy('macs')).events);
 });
});

describe('6 reproducibility and order invariance',()=>{
 it('reproduces inputs, events and all non-timing results for the same seeds',()=>{
  const c1=buildCase('event-combined','dev',1),c2=buildCase('event-combined','dev',1);expect(c2).toEqual(c1);
  expect(strip(runSingleRobot(c1,strategyPolicy('tetris-reserved')))).toEqual(strip(runSingleRobot(c2,strategyPolicy('tetris-reserved'))));
 },120000);
 it('gives the same placements when only catalogue metadata order and names change',()=>{
  for(const id of ['bed-bpp-order','mixed-48']){
   const c=buildCase(id,'dev',1),rename=new Map(c.scenario.types.map((t,i)=>[t.id,`X${c.scenario.types.length-i}`]));
   const permuted:CaseInput={...structuredClone(c),scenario:{...structuredClone(c.scenario),types:[...c.scenario.types].reverse().map(t=>({...t,id:rename.get(t.id)!,name:`renamed-${t.name}`}))},sequence:c.sequence.map(x=>rename.get(x)!)};
   for(const p of [compactPolicy(),strategyPolicy('strategy-greedy')]){
    const placements=(r:SingleRobotRun)=>r.history.filter(h=>h.action==='place').map(h=>[h.box,h.pallet,h.position,h.orientation]);
    expect(placements(runSingleRobot(permuted,p))).toEqual(placements(runSingleRobot(c,p)));
   }
  }
 });
});
