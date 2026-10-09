import { describe,it,expect } from 'vitest';
import { comparisonAlgorithms } from '../src/pallet/comparison';
import { STRATEGY_IDS } from '../src/pallet/strategies/PackingStrategy';
import { LEGACY_ALGORITHMS,DEFAULT_SEARCH,COMPACT_SEARCH,emptyFrame } from '../src/pallet/types';
import { scenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment,advance,runScenario } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { inspectConstraints } from '../src/pallet/constraints';
import type { PlanningInput,Scenario } from '../src/pallet/types';
const settings={...DEFAULT_SEARCH,maxCandidates:64};
function fixture():Scenario {const s=scenario('identical',42);s.types[0].quantity=8;s.types[0].maxLoadKg=100;s.types[0].orientations=[0,90];return s;}
const input=()=>new ArrivalEnvironment(fixture()).input(emptyFrame(),'random',settings,'run')!;
const signature=(i:PlanningInput)=>{const a=plan(i);return a.candidates.find(c=>c.id===a.selectedId)?.placement;};
describe('random valid-placement baseline',()=>{
 it('shares comparison inventory while preserving previous modes',()=>{
  expect(comparisonAlgorithms({})).toEqual([...STRATEGY_IDS,'random']);
  expect(comparisonAlgorithms({supplyMode:'stock-select'})).toEqual([...LEGACY_ALGORITHMS,'random']);
  expect(LEGACY_ALGORITHMS).toEqual(['bl','greedy','rollout']);
 });
 it('reproduces complete placements across run IDs without mutating its input',()=>{
  const i=input(),before=structuredClone(i);expect(signature(i)).toEqual(signature({...i,runId:'another'}));expect(i).toEqual(before);
  const a=runScenario(fixture(),'random',settings,'a'),b=runScenario(fixture(),'random',settings,'b');
  expect(a.frame.placements).toEqual(b.frame.placements);expect(a.frame.records.map(r=>r.disposition)).toEqual(b.frame.records.map(r=>r.disposition));
 });
 it('varies with seed and does not select by score, weights, or remaining inventory',()=>{
  const i=input(),choices=new Set<string>();let nonBest=0;
  for(let seed=0;seed<32;seed++){
   const j={...i,settings:{...settings,plannerSeed:seed}},a=plan(j),c=a.candidates.find(c=>c.id===a.selectedId)!;
   choices.add(a.selectedId!);if(c.score<Math.max(...a.candidates.filter(c=>c.valid).map(c=>c.score))-1e-6)nonBest++;
   const altered={...j,remaining:{A:999999},types:[],settings:{...j.settings,weights:Object.fromEntries(Object.keys(settings.weights).map(k=>[k,9999])) as typeof settings.weights}};
   expect(signature(altered)).toEqual(c.placement);expect(a.rolloutCalls).toBe(0);expect(a.virtualSequences).toEqual([]);
  }
  expect(choices.size).toBeGreaterThan(2);expect(nonBest).toBeGreaterThan(0);
 });
 it('uses only the arrived current box and the same causal arrival prefix',()=>{
  const s=fixture();s.arrival.pattern='random-draw';s.types.push({...s.types[0],id:'B',quantity:3,size:{w:200,d:200,h:100}});
  const env=new ArrivalEnvironment(s),i=env.input(emptyFrame(),'random',settings,'one')!,a=plan(i);
  expect(env.sampledCount).toBe(1);expect(a.candidates.every(c=>c.placement.id===i.current.id)).toBe(true);expect(a.selectedBoxId).toBeUndefined();
  const run=runScenario(s,'random',settings);expect(run.frame.records.map(r=>r.observation.id)).toEqual(run.frame.records.map((_,n)=>env.current(n)!.id));
 });
 it('rechecks all committed placements through existing physical constraints across seeds',()=>{
  for(const seed of [1,7,42]){const s=fixture(),r=runScenario(s,'random',{...settings,plannerSeed:seed});expect(r.metrics.count).toBeGreaterThan(1);
   for(const step of r.frame.records)if(step.disposition==='placed')expect(inspectConstraints(step.placement!,step.observation,step.before,s.pallet,s.constraints).reasons).toEqual([]);
   expect(new Set(r.frame.placements.map(b=>b.id)).size).toBe(r.metrics.count);
  }
 });
 it.each(['boundary','height','orientation','path'] as const)('does not bypass %s rejection when no candidate exists',reason=>{
  const i=input();if(reason==='boundary')i.current.size.w=i.current.size.d=100000;
  if(reason==='height')i.pallet.maxHeight=50;if(reason==='orientation')i.current.orientationAllowed=[];
  if(reason==='path'){i.constraints.robotMode='gripper';i.constraints.gripper.payload=.1;}
  const a=plan(i);expect(a.selectedId).toBeNull();expect(a.valid).toBe(0);expect(advance(emptyFrame(),i,a).blocked).toBe(true);
 });
 it('rejects loading on a lower box with no remaining capacity',()=>{
  const s=fixture();s.pallet={width:300,depth:250,maxHeight:600};s.types[0].orientations=[0];s.types[0].quantity=2;s.types[0].maxLoadKg=0;
  const r=runScenario(s,'random',settings);expect(r.metrics.count).toBe(1);expect(r.frame.blocked).toBe(true);expect(r.frame.records.at(-1)!.analysis!.valid).toBe(0);
 });
 it('random stock selection preserves IDs/counts and still tries a feasible box',()=>{
  const s=fixture();s.supplyMode='stock-select';s.types[0].quantity=3;s.types.unshift({...s.types[0],id:'huge',quantity:1,size:{w:10000,d:10000,h:200}});
  const r=runScenario(s,'random',settings),env=new ArrivalEnvironment(s);expect(r.metrics.count).toBe(3);expect(r.frame.blocked).toBe(true);
  expect(env.remaining(r.frame)).toEqual({huge:1,A:0});expect(new Set(r.frame.placements.map(b=>b.id)).size).toBe(3);
  for(const record of r.frame.records)if(record.disposition==='placed')expect(record.analysis!.selectedBoxId).toBe(record.observation.id);
 });
});

it('preserves an existing held box and safely releases it after switching to random',()=>{
 const s=scenario('buffer-demo'),env=new ArrivalEnvironment(s),first=env.input(emptyFrame(),'bl',COMPACT_SEARCH,'buffer')!;
 const frame=advance(emptyFrame(),first,plan(first));expect(frame.buffer).toHaveLength(1);
 const next=env.input(frame,'random',COMPACT_SEARCH,'random-buffer')!,a=plan(next),after=advance(frame,next,a);
 expect(after.blocked).toBe(false);expect(after.placements).toHaveLength(2);
 expect(after.buffer).toEqual([]);expect(a.bufferPlan?.releasedId).toBe('CAP-01');
 expect(env.available(after).map(o=>o.typeId)).toEqual(['MID']);
});
