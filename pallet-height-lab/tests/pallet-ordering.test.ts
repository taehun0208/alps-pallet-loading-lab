import {describe,it,expect} from 'vitest';
import frozen from './fixtures/ordering-v20.json';
import {DEFAULT_CONFIG,DEFAULT_ORDERING,type Box,type Config,type Placed} from '../src/pallet/adaptive/types';
import {shape,observe,bounds,worldParts} from '../src/pallet/adaptive/shape';
import {Session,metrics} from '../src/pallet/adaptive/runtime';
import {assess} from '../src/pallet/adaptive/mechanics';
import {emptySpaces,subtractSpace,planObserved} from '../src/pallet/adaptive/planner';
import {ancestors,buildGraph,compatible,emptyGraph,extendGraph,observationKey,physicalKey,PlanningMemory,verifyCoverage,type CDG} from '../src/pallet/adaptive/dependency';
const cfg=():Config=>({...structuredClone(DEFAULT_CONFIG),pallet:{width:600,depth:600,maxHeight:1000},maxCandidates:32,timeBudgetMs:30000,bufferSize:3,ordering:{...DEFAULT_ORDERING,enabled:true}});
const box=(id:string,w=200,d=200,h=100):Box=>({id,nominal:{w,d,h},parts:shape({w,d,h},'normal',0),mass:2,com:{x:w/2,y:d/2,z:h/2},rotations:[0,90],friction:.5,strength:{topLoadKg:100,residual:1,source:'assumption',note:'test'},damage:'normal',masks:[],arrival:0,color:'#aabbcc',suction:{seal:'unknown',maxMassKg:35,maxMomentNm:20}});
const at=(b:Box,x=0,y=0,z=0):Placed=>({box:b,position:{x,y,z},rotation:0});
const observed=(p:Placed,c:Config)=>observe(p,c,0);
describe('Wang/Hauser ordering adaptations',()=>{
 it('replays untouched v20 decisions with improvements absent or disabled',()=>{
  for(const row of frozen.rows)for(const off of [undefined,{...DEFAULT_ORDERING,enabled:false}]){const c={...row.config,ordering:off} as Config,f=new Session(c,row.boxes as Box[]).run();expect(f.placed).toEqual(row.placed);expect(f.rejected).toEqual(row.rejected);expect(f.events).toEqual(row.events);}
 });
 it('incremental EMS preserves every retained space, cap and candidate score',()=>{
  const c=cfg();c.maxEms=5;const stack=[at(box('a')),at(box('b',250,180,120),250,0),at(box('c',150,150,100),0,0,100)],last=stack.at(-1)!;
  expect(subtractSpace(emptySpaces(stack.slice(0,-1),c),bounds(worldParts(last)),c)).toEqual(emptySpaces(stack,c));
  const arrivals=[observed(at(box('new')),c)],obs=stack.map(p=>observed(p,c));c.ordering={...DEFAULT_ORDERING,enabled:false};const old=planObserved(arrivals,obs,{},c);
  c.ordering={...DEFAULT_ORDERING,enabled:true,cdg:false,dependencyWeight:0,prior:false,equivalence:false};const fresh=planObserved(arrivals,obs,{},c);
  expect(fresh.candidates.filter(p=>!p.reasons.length)).toEqual(old.candidates.filter(p=>!p.reasons.length));expect(fresh.selected).toEqual(old.selected);expect(fresh.stats!.spaceUpdates).toBeLessThan(old.stats!.spaceUpdates);
 });
 it('counts ancestors, not just direct supporters, and keeps forward access edges',()=>{
  const c=cfg(),stack=[at(box('base')),at(box('middle'),0,0,100),at(box('top'),0,0,200)],{graph}=buildGraph(stack,c);
  expect([...ancestors(graph,'top')].sort()).toEqual(['base','middle']);expect(compatible(graph,['top','middle','base'])).toBe(false);
  const first=at(box('old'),200,200),overhang=at(box('later'),200,200,400),g=extendGraph({ ...emptyGraph(),nodes:['old']},[first],overhang,c,new Map(),{remaining:0,checks:0});
  expect(g.edges).toContainEqual({from:'old',to:'later',kind:'access'});expect(g.scope).toBe('heuristic-only');
 });
 it('subtracts normalized dependency cost from the existing maximized score',()=>{
  const c=cfg();Object.assign(c.ordering!,{dependencyWeight:0,prior:false,equivalence:false,removalChecks:0});const obs=[observed(at(box('base')),c)],items=[observed(at(box('new')),c)],a=planObserved(items,obs,{},c);c.ordering!.dependencyWeight=.2;const b=planObserved(items,obs,{},c);
  const supported=b.candidates.filter(v=>!v.reasons.length&&v.terms.dependencyCount>0);expect(supported.length).toBeGreaterThan(0);
  for(const v of b.candidates.filter(v=>!v.reasons.length)){const old=a.candidates.find(p=>p.id===v.id)!;expect(v.score).toBeCloseTo(old.score-.2*v.terms.dependencyCost,12);expect(v.terms.dependencyCost).toBeLessThanOrEqual(1);}
 });
 it('reuses only revalidated poses and never relocates executed boxes',()=>{
  const c=cfg(),m=new PlanningMemory(),incoming=observed(at(box('new')),c);const a=planObserved([incoming],[],{},c,{},m);expect(a.selected).not.toBeNull();
  const b=planObserved([incoming],[],{},c,{},m);expect(b.stats!.priorHits).toBe(1);expect(b.selected!.position).toEqual(a.selected!.position);expect(b.stats!.checked).toBe(1);
  const obstacle=observed({...at(box('obstacle')),position:a.selected!.position},c),before=structuredClone(obstacle);const changed=planObserved([incoming],[obstacle],{},c,{},m);
  expect(changed.stats!.priorHits).toBe(0);expect(changed.candidates.find(p=>p.id.endsWith(':prior'))?.reasons).toContain('collision');expect(obstacle).toEqual(before);expect(changed.selected?.reasons).toEqual([]);
  const weak=structuredClone(incoming);weak.box.suction.maxMassKg=.1;expect(observationKey(weak)).not.toBe(observationKey(incoming));expect(planObserved([weak],[],{},c,{},m).selected).toBeNull();
 });
 it('groups only full physical and observed equivalents while keeping individual IDs',()=>{
  const c=cfg(),a=box('a'),b=box('b');expect(physicalKey(a)).toBe(physicalKey(b));
  for(const mutate of [(x:Box)=>x.mass++,(x:Box)=>x.com.x++,(x:Box)=>x.rotations=[0],(x:Box)=>x.strength.topLoadKg=2,(x:Box)=>x.masks=[{x:0,y:0,w:10,d:10}],(x:Box)=>x.friction=.3]){const other=structuredClone(b);mutate(other);expect(physicalKey(a)).not.toBe(physicalKey(other));}
  const items=[a,b].map(v=>observed(at(v),c));const chosen=planObserved(items,[],{b:2},c);expect(chosen.stats!.equivalentSkipped).toBe(1);expect(chosen.selected!.boxId).toBe('b');
  const f=new Session(c,[a,b]).run();expect(f.placed.map(p=>p.box.id).sort()).toEqual(['a','b']);
 });
 it('keeps QOP arrival information causal, respects k temporary slots, and terminates',()=>{
  for(const k of [0,1,2,3]){const c=cfg();c.bufferSize=k+1;const prefix=Array.from({length:k+1},(_,i)=>box('b'+i)),a=new Session(c,[...prefix,box('future',700,700)]),b=new Session(c,[...prefix,box('other',100,100)]);
   expect(a.step().placed).toEqual(b.step().placed);const f=a.run(),m=metrics(f,a.boxes,c);expect(f.done).toBe(true);expect(m.bufferPeak).toBeLessThanOrEqual(k);expect(f.tick).toBeLessThan(30);expect(m.finalViolations).toEqual([]);if(k===0)expect(m.additionalHandlingEstimate).toBe(0);
  }
 });
 it('reproduces noisy bounded execution and validates every successful prefix',()=>{
  const c=cfg();c.noise={dimensionMm:.2,positionMm:.1,surfaceMm:.1,yawDeg:.02};const boxes=Array.from({length:7},(_,i)=>box('n'+i)),a=new Session(c,boxes),b=new Session(c,boxes);
  const f=a.run(p=>expect(assess(p.placed,c).reasons).toEqual([])),g=b.run();expect(f.placed).toEqual(g.placed);expect(f.rejected).toEqual(g.rejected);expect(f.search?.capped).toBe(0);
 });
 it('bounded CDG coverage agrees with exhaustive small-order checks, without a physics claim',()=>{
  const nodes=['a','b','c'],orders=nodes.flatMap(a=>nodes.filter(b=>b!==a).map(b=>[a,b,nodes.find(c=>c!==a&&c!==b)!]));
  const graphs:CDG[]=orders.map(o=>({...emptyGraph(),nodes,edges:[{from:o[0],to:o[1],kind:'support'},{from:o[1],to:o[2],kind:'access'}]}));
  for(let n=0;n<=graphs.length;n++){const g=graphs.slice(0,n),r=verifyCoverage(nodes,g,1000,10000),covered=orders.every(o=>g.some(p=>compatible(p,o)));expect(r.status==='covered-graph').toBe(covered);expect(r.physicalVerified).toBe(false);if(r.order)expect(g.some(p=>compatible(p,r.order!))).toBe(false);}
  expect(verifyCoverage(nodes,graphs,0,10000).status).toBe('budget');
  expect(verifyCoverage(nodes,[{...emptyGraph(),nodes:['a','a','a']}]).status).toBe('counterexample');
  expect(verifyCoverage(nodes,[{...emptyGraph(),nodes,edges:[{from:'outside',to:'b',kind:'support'}]}]).status).toBe('counterexample');
 });
});
