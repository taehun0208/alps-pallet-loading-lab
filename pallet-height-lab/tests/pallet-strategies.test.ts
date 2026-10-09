import { expect,it } from 'vitest';
import { scenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment,advance,runScenario } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { inspectConstraints } from '../src/pallet/constraints';
import { intersects } from '../src/pallet/geometry';
import { DEFAULT_STRATEGY,STRATEGY_IDS,strategyConfig } from '../src/pallet/strategies/PackingStrategy';
import { criticalBoxes,Feasibility,futureLoss,approachClear } from '../src/pallet/strategies/feasibility';
import { accessibleSpace } from '../src/pallet/strategies/freeSpace';
import { slotKey } from '../src/pallet/candidates';
import { ONLINE_SEARCH,emptyFrame } from '../src/pallet/types';
import type { BoxType,Scenario,SearchSettings } from '../src/pallet/types';
import type { StrategyId } from '../src/pallet/strategies/PackingStrategy';

const type=(id:string,w:number,d:number,h:number,weight=2,quantity=1):BoxType=>({id,name:id,size:{w,d,h},weight,quantity,orientations:[0],color:'#65cbbb',maxLoadKg:300,material:'plastic'});
const settings:SearchSettings={...ONLINE_SEARCH,maxCandidates:32,strategy:{...DEFAULT_STRATEGY,futureCandidates:8,lookaheadDepth:2,lookaheadSamples:2,lookaheadCandidates:4}};
function fixture(types:BoxType[],height=100):Scenario {const s=scenario('online-task');delete s.generation;s.types=types;s.pallet={width:600,depth:400,maxHeight:height};s.arrival={seed:42,pattern:'ordered'};s.constraints.robotMode='ideal';s.constraints.horizontalGap=0;s.constraints.standingHeight={enabled:false,maxRiseMm:0};s.events=[];return s;}
function input(s:Scenario,algorithm:StrategyId='dynamic-reservation'){return new ArrivalEnvironment(s).input(emptyFrame(),algorithm,settings,'test')!;}
const chosen=(a:ReturnType<typeof plan>)=>a.candidates.find(c=>c.id===a.selectedId)!;

it.each(STRATEGY_IDS)('%s places equal boxes through shared constraints',algorithm=>{
  const s=fixture([type('A',200,200,100,2,12)],600),r=runScenario(s,algorithm,settings);
  expect(r.metrics.complete).toBe(true);
  for(const record of r.frame.records){expect(record.placement?.id).toBe(record.observation.id);expect(inspectConstraints(record.placement!,record.observation,record.before,s.pallet,s.constraints).reasons).toEqual([]);}
  for(const [i,a] of r.frame.placements.entries())for(const b of r.frame.placements.slice(i+1))expect(intersects(a,b)).toBe(false);
},20000);

it.each(['tetris-reserved','dynamic-reservation','future-hybrid'] as const)('%s protects a large future box and does not pre-place it',algorithm=>{
  const s=fixture([type('small',100,400,100,2,2),type('large',300,400,100,10)]),r=runScenario(s,algorithm,settings);
  expect(r.metrics.complete).toBe(true);expect(r.frame.records.map(r=>r.observation.typeId)).toEqual(['small','small','large']);
  expect(r.frame.records[0].analysis!.strategyDebug!.criticalBoxes.find(c=>c.typeId==='large')!.feasibleAfter).toBeGreaterThan(0);
  expect(r.frame.records[0].after.map(b=>b.typeId)).toEqual(['small']);
});

it('detects long thin shape difficulty and scarcity rather than sorting only by volume',()=>{
  const s=fixture([type('now',100,100,100),type('long',580,40,100),type('normal',150,150,100)],300),i=input(s),cfg=strategyConfig(settings.strategy),list=criticalBoxes(i,cfg,new Feasibility(i,cfg));
  const long=list.find(c=>c.typeId==='long')!,normal=list.find(c=>c.typeId==='normal')!;
  expect(long.shapeCritical).toBe(true);expect(long.factors.aspect).toBeGreaterThan(normal.factors.aspect);expect(long.criticality).toBeGreaterThan(normal.criticality);
});

it('preserves low sites when heavy arrivals cannot stand on the current light box',()=>{
  const s=fixture([type('light',100,400,100,2,2),type('heavy',300,400,100,20)],400),a=plan(input(s)),info=a.strategyDebug!.criticalBoxes.find(c=>c.typeId==='heavy')!;
  expect(info.weightCritical).toBe(true);expect(info.lowerAfter).toBeGreaterThan(0);
  const r=runScenario(s,'dynamic-reservation',settings);expect(r.frame.placements.find(b=>b.typeId==='heavy')!.position.z).toBe(0);
});

it('tracks feasible losses and strongly penalizes destruction of the final future site',()=>{
  const s=fixture([type('small',100,400,100),type('large',300,400,100,10)]),i=input(s),a=plan(i);
  const blocked=a.candidates.find(c=>c.valid&&c.placement.position.x===250)!;
  expect(blocked.strategyDebug!.deadEnds).toBe(1);expect(blocked.strategyDebug!.criticalBoxes[0].feasibleBefore).toBeGreaterThan(0);expect(blocked.strategyDebug!.criticalBoxes[0].feasibleAfter).toBe(0);
  expect(chosen(a).score-blocked.score).toBeGreaterThan(20);
  expect(futureLoss(1,0,'normalized')).toBe(1);expect(futureLoss(5,4,'normalized')).toBe(.2);expect(futureLoss(4,3,'absolute')).toBe(1);
  expect(a.strategyDebug!.criticalBoxes[0].feasibleAfter).toBeGreaterThan(0);
});

it('keeps the static slot across decisions, then lets the arriving critical box consume it',()=>{
  const s=fixture([type('small',100,400,100,2,2),type('large',300,400,100,10)]),env=new ArrivalEnvironment(s);
  let f=emptyFrame(),i=env.input(f,'tetris-reserved',settings,'persist')!,a=plan(i);const reserved=a.strategyState!.slots[0];expect(reserved).toBeDefined();f=advance(f,i,a);
  i=env.input(f,'tetris-reserved',settings,'persist')!;expect(i.strategyState!.slots[0]).toEqual(reserved);a=plan(i);expect(slotKey(a.strategyState!.slots[0].placement)).toBe(slotKey(reserved.placement));f=advance(f,i,a);
  i=env.input(f,'tetris-reserved',settings,'persist')!;a=plan(i);expect(chosen(a).placement.typeId).toBe('large');expect(slotKey(chosen(a).placement)).toBe(slotKey(reserved.placement));
});

it('detects the actual one-site-to-zero transition even when every current choice destroys it',()=>{
  const s=fixture([type('small',100,400,100),type('only-site',600,400,100,20)]),a=plan(input(s));
  expect(a.strategyDebug!.criticalBoxes[0].feasibleBefore).toBe(1);
  expect(a.strategyDebug!.criticalBoxes[0].feasibleAfter).toBe(0);
  expect(a.strategyDebug!.deadEnds).toBe(1);expect(a.strategyDebug!.selectedScore).toBeLessThan(-20);
});

it('Greedy and MACS decisions are independent of future inventory',()=>{
  const s=fixture([type('small',100,400,100),type('large',300,400,100,10)]);
  for(const algorithm of ['strategy-greedy','macs'] as const){const i=input(s,algorithm),a=plan(i),b=plan({...i,types:[],remaining:{}});expect(chosen(a).placement).toEqual(chosen(b).placement);expect(a.strategyDebug).toEqual(b.strategyDebug);}
});

it('preserves actual arrival streams across all strategies and samples futures without replacement',()=>{
  const s=fixture([type('A',100,100,100,2,4),type('B',120,80,100,2,3)],600);s.arrival.pattern='random-draw';
  const traces=STRATEGY_IDS.map(algorithm=>runScenario(s,algorithm,settings).frame.records.map(r=>r.observation.id));
  traces.forEach(t=>expect(t).toEqual(traces[0]));
  const a=plan(input(s,'lookahead'));for(const seq of a.virtualSequences)for(const t of s.types)expect(seq.filter(id=>id===t.id).length).toBeLessThanOrEqual(input(s,'lookahead').remaining[t.id]);
  a.candidates.filter(c=>c.future).forEach(c=>expect(c.future!.sequences).toEqual(a.virtualSequences));
});

it('has a real current-only boundary, rejects stock mode, and never rescues invalid candidates',()=>{
  const s=fixture([type('too-wide',700,400,100)]);for(const algorithm of STRATEGY_IDS){const i=input(s,algorithm);expect(plan(i).selectedId).toBeNull();expect(()=>plan({...i,available:[i.current]})).toThrow('현재 도착');}
});

it('MACS excludes covered cavities and approach clearance detects a blocked vertical column',()=>{
  const s=fixture([type('box',600,400,100)],600),i=input(s,'strategy-greedy'),base=chosen(plan(i)).placement;
  expect(accessibleSpace([base],s.pallet).largest).toBe(600*400*500);
  const floating={...base,position:{x:0,y:0,z:300}};
  expect(accessibleSpace([floating],s.pallet).largest).toBe(600*400*200);
  expect(approachClear(base,[floating],{...DEFAULT_STRATEGY,approach:true,approachHeight:400})).toBe(false);
  expect(approachClear(base,[floating],DEFAULT_STRATEGY)).toBe(true);
});

it('validates budgets and deterministic worst-case lookahead',()=>{
  expect(()=>strategyConfig({...DEFAULT_STRATEGY,lookaheadDepth:100})).toThrow();
  const s=fixture([type('small',100,100,100,2,3),type('large',400,300,100,10)],400),i=input(s,'lookahead');i.settings={...settings,strategy:{...settings.strategy!,lookaheadMode:'worst'}};
  const a=plan(i),b=plan(i);expect(a.selectedId).toBe(b.selectedId);expect(a.virtualSequences).toEqual(b.virtualSequences);expect(a.virtualSequences).toHaveLength(2);
});
