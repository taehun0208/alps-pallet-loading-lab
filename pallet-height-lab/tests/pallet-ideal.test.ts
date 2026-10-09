import { describe,it,expect } from 'vitest';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { randomScenario,DEFAULT_RANDOM,LEGACY_RANDOM } from '../src/pallet/random';
import { runScenario,ArrivalEnvironment } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { DEFAULT_SEARCH,emptyFrame } from '../src/pallet/types';
import { frontierOrigins,geometricFeasible } from '../src/pallet/frontier';
import { sparseOrigins } from '../src/pallet/geometry';
import { packingQuality } from '../src/pallet/packing';
import type { Placement } from '../src/pallet/types';
const search={...DEFAULT_SEARCH,topK:3,samples:2,depth:2};
describe('ideal pallet model and seeded random inputs',()=>{
 it('ignores every gripper dimension, payload and workspace while retaining packing constraints',()=>{
  const s=scenario('identical');s.constraints.robotMode='ideal';const a=runScenario(s,'greedy',search);s.constraints.gripper.width=100000;s.constraints.gripper.depth=200000;s.constraints.gripper.payload=.01;s.constraints.workspace.zMax=1;const b=runScenario(s,'greedy',search);
  expect(a.metrics.complete).toBe(true);expect(b.frame.placements).toEqual(a.frame.placements);expect(b.metrics.workSeconds).toBe(0);expect(b.metrics.distanceM).toBe(0);expect(b.frame.records.every(r=>r.path?.model==='ideal')).toBe(true);
 });
 it('random set and arrival streams are independent, validated and reproducible',()=>{
  const a=randomScenario(),b=randomScenario({...DEFAULT_RANDOM,arrivalSeed:998}),c=randomScenario({...DEFAULT_RANDOM,seed:123});expect(a.types).toEqual(b.types);expect(a.types).not.toEqual(c.types);expect(a.types.reduce((n,b)=>n+b.quantity,0)).toBe(30);expect(parseScenario(JSON.stringify(a))).toEqual(a);expect(()=>randomScenario({...DEFAULT_RANDOM,totalCount:0})).toThrow('랜덤 입력');expect(randomScenario()).toEqual(a);
  const ea=new ArrivalEnvironment(a),eb=new ArrivalEnvironment(b);expect(Array.from({length:30},(_,i)=>ea.current(i)?.id)).not.toEqual(Array.from({length:30},(_,i)=>eb.current(i)?.id));
 });
 it('uniform box mass uses the geometric centroid and hidden future order never enters planning',()=>{
  const e=new ArrivalEnvironment(randomScenario(LEGACY_RANDOM)),input=e.input(emptyFrame(),'rollout',search,'test')!;expect(Object.keys(input)).not.toContain('arrival');const a=plan(input),b=plan({...structuredClone(input),runId:'other'});expect(a.selectedId).toBe(b.selectedId);expect(a.virtualSequences).toEqual(b.virtualSequences);const p=a.candidates.find(c=>c.id===a.selectedId)!.placement;expect(p.position.x+p.size.w/2).toBeGreaterThanOrEqual(p.position.x);expect(a.candidates.find(c=>c.id===a.selectedId)!.path.model).toBe('ideal');
 });
 it('recovers a usable corner formed by edges of different existing boxes',()=>{
  const box=(id:string,x:number,y:number):Placement=>({id,typeId:'A',position:{x,y,z:0},size:{w:100,d:100,h:100},weight:1,orientation:0,supports:[],supportRatio:1,loadAbove:0}),placed=[box('a',100,0),box('b',0,250)],pallet={width:600,depth:600,maxHeight:800},size={w:150,d:150,h:100},point={x:200,y:350,z:0};
  expect(sparseOrigins(pallet,size,placed,0)).not.toContainEqual(point);expect(frontierOrigins(pallet,size,placed,0)).toContainEqual(point);expect(geometricFeasible({position:point,size,orientation:0},placed,pallet,scenario().constraints)).toBe(true);
 });
 it('penalises destroying a broad top needed by larger remaining boxes',()=>{
  const s=scenario('materials'),env=new ArrivalEnvironment(s),input=env.input(emptyFrame(),'greedy',search,'r')!,base:Placement={id:'base',typeId:'P',position:{x:0,y:0,z:0},size:{w:600,d:400,h:200},weight:3,material:'plastic',orientation:0,supports:[],supportRatio:1,loadAbove:0},small:Placement={...base,id:'small',typeId:'K',size:{w:300,d:200,h:200},weight:7,material:'paper',position:{x:0,y:0,z:200},supports:[{id:'base',area:60000,share:1,rect:{x:0,y:0,w:300,d:200}}]};input.placements=[base];input.remaining={P:3,K:3};
  expect(packingQuality(small,input).futureSurfacePenalty).toBeGreaterThan(0);expect(packingQuality({...small,position:{x:600,y:0,z:0},supports:[]},input).futureSurfacePenalty).toBe(0);
 });
});
