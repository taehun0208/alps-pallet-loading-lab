import { describe,it,expect } from 'vitest';
import { comCost,comOffsetRatio,loadCom,transportMargin,palletUnitMargin,slidingRisk } from '../src/pallet/palletCom';
import { candidateSet } from '../src/pallet/candidates';
import { inspectConstraints } from '../src/pallet/constraints';
import { DEFAULT_SEARCH } from '../src/pallet/types';
import { scenario } from '../src/pallet/scenarios';
import type { Placement,PlanningInput } from '../src/pallet/types';

const pallet={width:1000,depth:800,maxHeight:1500};
const box=(id:string,x:number,y:number,z:number,w=200,d=200,h=200,weight=10):Placement=>({id,typeId:id,size:{w,d,h},weight,position:{x,y,z},orientation:0,supports:[],supportRatio:1,loadAbove:0});

describe('whole-load centre of mass',()=>{
 it('measures mass-weighted CoG and its offset from the pallet centre',()=>{
  const {mass,center}=loadCom([box('a',0,0,0),box('b',800,600,0,200,200,200,30)]);
  expect(mass).toBe(40);expect(center).toEqual({x:(100*10+900*30)/40,y:(100*10+700*30)/40,z:100});
  expect(comOffsetRatio({x:500,y:400,z:0},pallet)).toBe(0);
  expect(comOffsetRatio({x:1000,y:400,z:0},pallet)).toBe(1);
 });
 it('ramps the balance cost with load mass so the first light box does not dominate',()=>{
  const one=comCost([box('a',0,0,0)],pallet,10),many=comCost(Array.from({length:8},(_,i)=>box(`b${i}`,0,0,i*200)),pallet,10);
  expect(one.offset).toBeCloseTo(many.offset);expect(one.ramp).toBeCloseTo(10/50);expect(many.cost).toBeGreaterThan(one.cost);
  expect(comCost([],pallet).cost).toBe(0);
 });
 it('reports loose and wrapped cargo tipping separately from the coupled pallet unit',()=>{
  // Two 400x400x200 boxes stacked on the floor at the pallet corner.
  const a=box('a',0,0,0,400,400,200),b={...box('b',0,0,200,400,400,200),supports:[{id:'a',area:160000,share:1,rect:{x:0,y:0,w:400,d:400}}]};
  const t=transportMargin([a,b],pallet,.3);
  expect(t.looseMarginMm).toBeCloseTo(200-200*.3);  // floor plane: resultant 200 mm above it, 200 mm from the hull edge
  expect(t.wrappedMarginMm).toBeCloseTo(200-200*.3);
  expect(palletUnitMargin([a,b],pallet,.3)).toBeNull();
  const unit=palletUnitMargin([a,b],pallet,.3,{palletMassKg:20,deckHeightMm:150,source:'test assumption'})!;
  // Combined CoG: x=y=(200*20+500*20)/40=350 (y:(200*20+400*20)/40=300); z=((200+150)*20+75*20)/40=212.5.
  expect(unit).toBeCloseTo(300-212.5*.3);
  expect(slidingRisk([{...box('a',0,0,0),friction:.2},{...box('b',0,0,0),friction:.5}],.3)).toEqual(['a']);
 });
});

describe('optional CoG decision terms',()=>{
 const s=scenario('mixed',7),current={id:'A-01',typeId:'A',size:{w:600,d:400,h:300},weight:12,status:'normal' as const,orientationAllowed:[0 as const,90 as const]};
 const input=(com?:number):PlanningInput=>({runId:'t',stepId:0,pallet:s.pallet,types:s.types,constraints:s.constraints,placements:[],current,remaining:{},algorithm:'greedy',settings:{...DEFAULT_SEARCH,inventoryMode:'none',weights:{...DEFAULT_SEARCH.weights,...(com!==undefined?{com}:{})}}});
 it('leaves scores unchanged when the CoG weight is absent or zero',()=>{
  const a=candidateSet(input()).candidates,b=candidateSet(input(0)).candidates;
  expect(b.map(c=>[c.placement.position,c.score])).toEqual(a.map(c=>[c.placement.position,c.score]));
  expect(a.every(c=>(c.terms.com??0)===0)).toBe(true);
 });
 it('adds a centre candidate and penalises off-centre load when enabled',()=>{
  const c=candidateSet(input(60)).candidates.filter(c=>c.valid);
  const centre=c.find(x=>Math.abs(x.placement.position.x+x.placement.size.w/2-s.pallet.width/2)<1&&Math.abs(x.placement.position.y+x.placement.size.d/2-s.pallet.depth/2)<1);
  expect(centre).toBeDefined();const corner=c.find(x=>x.placement.position.x===0&&x.placement.position.y===0)!;
  expect(centre!.terms.com!).toBeGreaterThan(corner.terms.com!);
 });
 it('rejects a placement only when the transport check is configured and violated',()=>{
  // Corner box: CoG 200 mm from the nearest pallet edge, 150 mm high. 2 g needs 300 mm, 1 g needs 150 mm.
  const p={...box('A-01',0,0,0,600,400,300,12),typeId:'A'},check=(g?:number)=>inspectConstraints(p,current,[],s.pallet,{...s.constraints,robotMode:'ideal',stability:{...s.constraints.stability!,...(g!==undefined?{transportAccelerationG:g}:{})}});
  expect(check().reasons).toEqual([]);expect(check(1).reasons).toEqual([]);
  expect(check(2).reasons.some(r=>r.startsWith('TRANSPORT'))).toBe(true);
 });
});
