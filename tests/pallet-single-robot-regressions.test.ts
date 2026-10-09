// Regression tests for the 2026-10-09 review of the single-robot comparison harness.
// Each test reproduces one reported defect; they were confirmed failing before the fix.
import { describe,it,expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transportMargin } from '../src/pallet/palletCom';
import { runSingleRobot } from '../src/pallet/singleRobot/compare';
import { SITUATIONS,PHASE_SEEDS,sourceOrders,strategyPolicy,compactPolicy,buildCase } from '../src/pallet/singleRobot/situations';
import { caseSeeds } from '../src/pallet/singleRobot/config';
import type { PlanningInput } from '../src/pallet/types';


describe('P1 data split',()=>{
 it('never uses the same BED-BPP source order in development and evaluation',()=>{
  for(const s of SITUATIONS.filter(s=>s.id.startsWith('bed-bpp'))){
   const dev=new Set(PHASE_SEEDS.dev.flatMap(seed=>sourceOrders(s.build('dev',caseSeeds(seed))))),evaluation=PHASE_SEEDS.eval.flatMap(seed=>sourceOrders(s.build('eval',caseSeeds(seed))));
   expect(dev.size).toBeGreaterThan(0);expect(evaluation.length).toBeGreaterThan(0);
   expect(evaluation.filter(id=>dev.has(id)),s.id).toEqual([]);
  }
 });
});

describe('P1 transport tipping support area',()=>{
 it('uses the cargo contact area, not the pallet outline (200x200x1000 box, centre of 1000x800, 0.3 g)',()=>{
  const box={id:'a',typeId:'a',size:{w:200,d:200,h:1000},weight:10,position:{x:400,y:300,z:0},orientation:0 as const,supports:[],supportRatio:1,loadAbove:0};
  const t=transportMargin([box],{width:1000,depth:800,maxHeight:1500},.3) as Record<string,unknown>;
  // Own footprint half-width 100 mm minus CoG height 500 mm x 0.3 = -50 mm.
  expect(t.looseMarginMm).toBeCloseTo(-50);
  expect(t.wrappedMarginMm).toBeCloseTo(-50);
  expect(t.marginMm).toBeUndefined();
 });
});

describe('P2 run records',()=>{
 it('stores the applied policy settings, including the CoG weight',()=>{
  const r=runSingleRobot(buildCase('mixed-small','dev',3),strategyPolicy('strategy-greedy',1.5)) as unknown as {config?:{policy:{settings:{strategy:{weights:{com:number}}}}}};
  expect(r.config?.policy.settings.strategy.weights.com).toBe(1.5);
 });
 it('records search effort and separates placement path time from unpriced process time',()=>{
  const r=runSingleRobot(buildCase('mixed-small','dev',3),compactPolicy()) as unknown as {effort?:{plannerCalls:number;constraintChecks:number};robot?:{placementSeconds:number;bufferHandlingSeconds:number|null;palletExchangeSeconds:number|null;excluded:string[]}};
  expect(r.effort?.plannerCalls).toBeGreaterThan(0);expect(r.effort?.constraintChecks).toBeGreaterThan(0);
  expect(r.robot?.placementSeconds).toBeGreaterThan(0);
  expect(r.robot?.bufferHandlingSeconds).toBeNull();expect(r.robot?.palletExchangeSeconds).toBeNull();
  expect(r.robot?.excluded).toEqual(expect.arrayContaining(['buffer-handling','pallet-exchange']));
 });
});

describe('P2 planner information boundary',()=>{
 it('counts boxes waiting in the buffer as known future demand, without double counting the current box',()=>{
  let buffered=0;
  // Iterate development datasets until the buffer is actually used; the invariant must hold throughout.
  for(let d=1;d<=12&&!buffered;d++)runSingleRobot(buildCase('mixed-48','dev',d),compactPolicy(),{audit:(input,state)=>{
   if(state.buffered.length)buffered++;
   const demand=Object.values(input.remaining).reduce((a,b)=>a+b,0);
   expect(demand+1+state.placedTotal+state.unplaceable).toBe(state.total);
   const split=input.pending!;expect(Object.values(split.buffered).reduce((a,b)=>a+b,0)).toBe(state.buffered.length);
  }});
  expect(buffered).toBeGreaterThan(0);
 });
 it('gives planners an order-free catalogue: canonical type order and opaque IDs',()=>{
  const inputs:PlanningInput[]=[];
  runSingleRobot(buildCase('bed-bpp-order','eval',PHASE_SEEDS.eval[0]),compactPolicy(),{audit:input=>{if(inputs.length<3)inputs.push(structuredClone(input));}});
  for(const input of inputs){
   const key=(t:PlanningInput['types'][number])=>JSON.stringify([t.size.w,t.size.d,t.size.h,t.weight,t.id]);
   expect(input.types.map(t=>t.id)).toEqual([...input.types].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0).map(t=>t.id));
   expect(input.types.some(t=>/BED-\d+-\d{3}/.test(t.id)||/BED-\d+-\d{3}/.test(t.name))).toBe(false);
   expect(/BED-\d+-\d{3}/.test(input.current.id)).toBe(false);
  }
 });
});

describe('P1 aggregation integrity (summarize.py)',()=>{
 const script='docs/benchmarks/single-robot/summarize.py';
 const run=(over:Record<string,unknown>={})=>({schema:'single-robot-run/2',runId:'t',key:'s|eval|1|1|0|p',configHash:'c1',situation:'s',policy:'p',phase:'eval',
  seeds:{dataset:1,arrival:1,event:0,planner:2026},fitness:{status:'pass',violations:{},checked:['geometry']},
  performance:{total:10,completed:10,demand:10,completionRate:1,unplaceable:0,pallets:1,utilization:.2,closedFillMean:null,closeReasons:{'order-complete':1}},
  stability:{minSupportRatio:1,minLocalReserveMm:30,meanComOffset:.1,worstComOffset:.1,maxComHeightMm:200,transport:{loose:{'0.3':10}}},
  robot:{placementSeconds:50,bufferHandlingSeconds:null,palletExchangeSeconds:null,excluded:['buffer-handling','pallet-exchange'],rehandles:0},
  compute:{samplesMs:[1,2,3],concurrency:1},robustness:{events:0,outcomes:{},records:[],success:true},...over});
 const summarize=(runs:object[],expected:{key:string;configHash:string}[])=>{
  const dir=mkdtempSync(join(tmpdir(),'single-robot-'));
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({runId:'t',expected}));
  writeFileSync(join(dir,'runs-0.jsonl'),runs.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const p=spawnSync('python3',[script,dir,join(dir,'out')],{encoding:'utf8'});
  return {code:p.status,stderr:p.stderr,summary:p.status===0?JSON.parse(readFileSync(join(dir,'out','summary.json'),'utf8')):null};
 };
 it('stops on duplicate run keys',()=>{const r=summarize([run(),run()],[{key:'s|eval|1|1|0|p',configHash:'c1'}]);expect(r.code).toBe(2);expect(r.stderr).toMatch(/DUPLICATE/);});
 it('stops on a run whose configuration differs from the plan',()=>{const r=summarize([run({configHash:'c2'})],[{key:'s|eval|1|1|0|p',configHash:'c1'}]);expect(r.code).toBe(2);expect(r.stderr).toMatch(/CONFIG MISMATCH/);});
 it('stops when a planned run is missing',()=>{const r=summarize([run()],[{key:'s|eval|1|1|0|p',configHash:'c1'},{key:'s|eval|2|2|0|p',configHash:'c1'}]);expect(r.code).toBe(2);expect(r.stderr).toMatch(/MISSING/);});
 it('pools decision samples for percentiles and keeps unmeasured values null',()=>{
  const samples=Array.from({length:100},(_,i)=>i+1);
  const r=summarize([run({compute:{samplesMs:samples,concurrency:1}}),run({key:'s|eval|2|2|0|p',seeds:{dataset:2,arrival:2,event:0,planner:2026},compute:{samplesMs:[1000],concurrency:1}})],
   [{key:'s|eval|1|1|0|p',configHash:'c1'},{key:'s|eval|2|2|0|p',configHash:'c1'}]);
  expect(r.code,r.stderr).toBe(0);const row=r.summary.table.s.p;
  expect(row.compute.samples).toBe(101);expect(row.compute.p95Ms).toBe(96);expect(row.performance.closedFillMean).toBeNull();
 });
 it('does not rank a policy with stability failures or unverified checks as the stability winner',()=>{
  const plan=['a','b'].map(p=>({key:`s|eval|1|1|0|${p}`,configHash:'c1'}));
  const a=run({key:plan[0].key,policy:'a',fitness:{status:'fail',violations:{'local-tipping':2},checked:['geometry']},stability:{minSupportRatio:1,minLocalReserveMm:-5,meanComOffset:0,worstComOffset:0,maxComHeightMm:100,transport:{loose:{'0.3':-20}}}});
  const b=run({key:plan[1].key,policy:'b',stability:{minSupportRatio:1,minLocalReserveMm:30,meanComOffset:.2,worstComOffset:.3,maxComHeightMm:200,transport:{loose:{'0.3':10}}}});
  const r=summarize([a,b],plan);expect(r.code,r.stderr).toBe(0);
  expect(r.summary.rankings.s.stability[0]).toBe('b');
 });
});

// Second round: defects found by the Claude API review of the corrected harness (output/claude-harness-v2-review.txt).
import { assertPhaseDatasets } from '../src/pallet/singleRobot/config';
import { constraintMeter } from '../src/pallet/constraints';
import type { CaseInput,HarnessEvent } from '../src/pallet/singleRobot/situations';
import type { BoxType } from '../src/pallet/types';
describe('review round 2',()=>{
 const base=buildCase('mixed-small','dev',1);
 const t=(id:string,w:number,d:number,h:number,weight:number,quantity=1):BoxType=>({id,name:id,size:{w,d,h},weight,quantity,orientations:[0],color:'#999',material:'plastic',maxLoadKg:500,maxLoadSource:'synthetic',strengthFactor:1,friction:.6});
 const make=(types:BoxType[],sequence:string[],events:HarnessEvent[],bufferSize:number):CaseInput=>({...structuredClone(base),scenario:{...structuredClone(base.scenario),types,pallet:{width:1000,depth:800,maxHeight:600},constraints:{...base.scenario.constraints,heavyRule:'off',standingHeight:{enabled:false,maxRiseMm:100}}},sequence,events,bufferSize});
 it('P1 does not isolate a box that fits an empty pallet while the buffer is down',()=>{
  const c=make([t('A',1000,800,300,20),t('B',1000,800,400,5,3)],['A','B','B','B'],[{kind:'buffer-down',at:3,duration:5}],2);
  const r=runSingleRobot(c,compactPolicy());expect(r.performance.unplaceable).toBe(0);expect(r.performance.completed).toBe(4);
 });
 it('P1 measures a mismeasured box when it is handled, even if no candidate fits the wrong size',()=>{
  const c=make([t('A',400,300,200,5)],['A'],[{kind:'mismeasure',at:0,size:{w:1200,d:900,h:300}}],2);
  const r=runSingleRobot(c,compactPolicy());expect(r.performance.unplaceable).toBe(0);expect(r.robustness.outcomes['remeasured-placed']).toBe(1);
 });
 it('P2 reports fitness as unverified when nothing was shipped',()=>{
  const c=make([t('T',400,300,900,5)],['T'],[],0);const r=runSingleRobot(c,compactPolicy());
  expect(r.performance.pallets).toBe(0);expect(r.fitness.status).toBe('unverified');
 });
 it('P2 rejects datasets outside the phase and keeps BED cases of one phase on disjoint orders',()=>{
  expect(()=>assertPhaseDatasets('eval',[1])).toThrow();expect(()=>assertPhaseDatasets('eval',PHASE_SEEDS.eval)).not.toThrow();
  for(const s of SITUATIONS.filter(s=>s.id.startsWith('bed-bpp'))){const ids=PHASE_SEEDS.eval.flatMap(d=>sourceOrders(s.build('eval',caseSeeds(d))));expect(new Set(ids).size,s.id).toBe(ids.length);}
 });
 it('P2 counts planner effort only, leaves unmeasured search effort null, and corrects visible quantities',()=>{
  const c=buildCase('event-missing','dev',1),before=constraintMeter.calls;let corrected=false;
  // After the first confirmed gap, planner-visible catalogue quantities sum to fewer than declared.
  const r=runSingleRobot(c,compactPolicy(),{audit:input=>{if(input.types.reduce((n,x)=>n+x.quantity,0)<c.sequence.length)corrected=true;}});
  expect(r.effort.constraintChecks).toBeLessThan(constraintMeter.calls-before);expect(r.effort.searchNodes).toBeNull();expect(corrected).toBe(true);
 });
});
describe('review round 2 · summarize.py',()=>{
 const script='docs/benchmarks/single-robot/summarize.py';
 const base={schema:'single-robot-run/2',runId:'t',phase:'eval',key:'s|eval|1|1|0|2026|p',configHash:'c1',inputHash:'i1',situation:'s',policy:'p',seeds:{dataset:1,arrival:1,event:0,planner:2026},
  fitness:{status:'pass',violations:{},checks:{}},performance:{total:1,completed:1,placedTotal:1,demand:1,completionRate:1,unplaceable:0,pallets:1,utilization:.1,closedFillMean:null,closeReasons:{}},
  stability:{minSupportRatio:1,minLocalReserveMm:1,meanComOffset:0,worstComOffset:0,maxComHeightMm:1,transport:{loose:{'0.3':1}}},robot:{placementSeconds:1,excluded:[],rehandles:0},
  compute:{samplesMs:[1],concurrency:1},robustness:{events:0,outcomes:{},records:[],success:true}};
 const run=(rec:object,expected:object)=>{const dir=mkdtempSync(join(tmpdir(),'sr2-'));writeFileSync(join(dir,'manifest.json'),JSON.stringify({runId:'t',phase:'eval',expected:[expected]}));writeFileSync(join(dir,'runs-0.jsonl'),JSON.stringify(rec)+'\n');return spawnSync('python3',[script,dir,join(dir,'o')],{encoding:'utf8'});};
 it('stops on a run from another run ID',()=>{const p=run({...base,runId:'other'},{key:base.key,configHash:'c1',inputHash:'i1'});expect(p.status).toBe(2);expect(p.stderr).toMatch(/RUN MISMATCH/);});
 it('stops on an input that differs from the plan',()=>{const p=run({...base,inputHash:'i2'},{key:base.key,configHash:'c1',inputHash:'i1'});expect(p.status).toBe(2);expect(p.stderr).toMatch(/INPUT MISMATCH/);});
});

// Fixed main conditions and the final evaluation set (decided before CoG weight selection).
import { MAIN_CONDITIONS,BED_SPLIT,assertDisjointSplit } from '../src/pallet/singleRobot/config';
import { selectSituations } from '../src/pallet/singleRobot/situations';
describe('fixed conditions and unseen final evaluation',()=>{
 it('keeps development, explored and final evaluation inputs disjoint',()=>{
  expect(()=>assertDisjointSplit()).not.toThrow();
  for(const id of ['00100012','00100022','00100025','00100029'])expect(BED_SPLIT.eval).not.toContain(id);
  for(const d of [11,12,13,14,15])expect(PHASE_SEEDS.eval).not.toContain(d);
  for(const s of SITUATIONS.filter(s=>s.id.startsWith('bed-bpp')))for(const d of PHASE_SEEDS.eval)for(const o of sourceOrders(s.build('eval',caseSeeds(d))))expect(BED_SPLIT.eval).toContain(o);
  // The explore phase reproduces the orders the buffer experiment already used for datasets 11-14.
  expect([11,12,13,14].map(d=>sourceOrders(buildCase('bed-bpp-order','explore',d))[0])).toEqual(['00100012','00100022','00100025','00100029']);
  expect(()=>buildCase('bed-bpp-order','eval',11)).toThrow(/eval 단계에 속하지 않은/);
 });
 it('applies the main conditions to every core case and keeps variants in other suites',()=>{
  for(const s of selectSituations('core')){const c=s.build('dev',caseSeeds(1));
   expect(c.bufferSize,s.id).toBe(MAIN_CONDITIONS.bufferSize);expect(c.scenario.constraints.standingHeight?.enabled,s.id).toBe(false);
   expect(c.scenario.constraints.supportRatio,s.id).toBe(MAIN_CONDITIONS.supportRatio);expect(c.scenario.constraints.heavyRule,s.id).toBe('each');expect(c.events,s.id).toEqual([]);}
  const boundary=selectSituations('boundary').map(s=>s.id);
  for(const id of ['mixed-no-buffer','mixed-buffer-4','mixed-standing-rule','mixed-support-80'])expect(boundary).toContain(id);
  expect(buildCase('mixed-standing-rule','dev',1).scenario.constraints.standingHeight?.enabled).toBe(true);
 });
});
