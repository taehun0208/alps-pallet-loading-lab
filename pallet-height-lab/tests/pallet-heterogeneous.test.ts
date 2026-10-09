import { it,expect } from 'vitest';
import { randomScenario,DEFAULT_RANDOM,LEGACY_RANDOM } from '../src/pallet/random';
import { heterogeneousInventory,DEFAULT_FIELD } from '../src/pallet/inventoryGeneration';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment,advance } from '../src/pallet/environment';
import { packingQuality } from '../src/pallet/packing';
import { materialInfo } from '../src/pallet/materials';
import { assessInventory } from '../src/pallet/inventory';
import { surface } from '../src/pallet/surface';
import { plan } from '../src/pallet/planner';
import { DEFAULT_SEARCH,emptyFrame } from '../src/pallet/types';
import type { Placement } from '../src/pallet/types';
it('uses individual off-grid boxes with heterogeneous mass, material and per-box synthetic strength by default',()=>{
 const s=scenario('field');expect(s.types).toHaveLength(30);expect(s.types.every(t=>t.quantity===1)).toBe(true);expect(new Set(s.types.map(t=>Object.values(t.size).join('/'))).size).toBe(30);expect(s.types.filter(t=>Object.values(t.size).some(d=>d%10!==0)).length).toBeGreaterThan(25);expect(new Set(s.types.map(t=>t.material)).size).toBe(3);expect(new Set(s.types.map(t=>t.weight/(t.size.w*t.size.d*t.size.h))).size).toBe(30);
 expect(new Set(s.types.map(t=>t.maxLoadKg)).size).toBeGreaterThan(20);expect(new Set(s.types.map(t=>t.friction)).size).toBeGreaterThan(8);expect(s.types.every(t=>materialInfo(t).source==='생성 예제값')).toBe(true);expect(parseScenario(JSON.stringify(s))).toEqual(s);
});
it('regenerates seeds exactly without correlating the set with arrival order',()=>{
 const a=randomScenario(),b=randomScenario({...DEFAULT_RANDOM,arrivalSeed:998}),c=randomScenario({...DEFAULT_RANDOM,seed:77});expect(a.types).toEqual(b.types);expect(randomScenario()).toEqual(a);expect(a.types).not.toEqual(c.types);expect(a.generation?.model).toBe('heterogeneous');expect(a.generation?.gridMm).toBeUndefined();
});
it('supports mixed repeated SKUs without quantizing dimensions or assigning the same density',()=>{
 const s=randomScenario({...DEFAULT_RANDOM,assortment:'repeated',typeCount:6,totalCount:24});expect(s.types).toHaveLength(6);expect(s.types.reduce((n,t)=>n+t.quantity,0)).toBe(24);expect(s.types.every(t=>t.quantity>=1)).toBe(true);expect(new Set(s.types.map(t=>t.maxLoadKg)).size).toBeGreaterThan(3);expect(parseScenario(JSON.stringify(s))).toEqual(s);
});
it('validates dimension ranges and keeps legacy grid imports explicitly compatible',()=>{
 expect(()=>heterogeneousInventory({...DEFAULT_FIELD,dimensions:{w:{min:300,max:200},d:{min:100,max:500},h:{min:100,max:400}}})).toThrow('치수 범위');expect(()=>heterogeneousInventory({...DEFAULT_FIELD,dimensions:{w:{min:200,max:200},d:{min:200,max:200},h:{min:200,max:200}}})).toThrow('너무 좁아');const old=randomScenario(LEGACY_RANDOM);expect(old.types.every(t=>Object.values(t.size).every(d=>d%50===0))).toBe(true);delete old.generation!.model;expect(parseScenario(JSON.stringify(old))).toEqual(old);
});
it('stores synthetic load provenance through the real placement and distinguishes manually supplied ratings',()=>{
 const s=scenario('field'),e=new ArrivalEnvironment(s),i=e.input(emptyFrame(),'greedy',DEFAULT_SEARCH,'field')!,a=plan(i);expect(a.selectedId).not.toBeNull();const f=advance(emptyFrame(),i,a);expect(f.placements[0].maxLoadSource).toBe('synthetic');expect(materialInfo(f.placements[0]).source).toBe('생성 예제값');expect(materialInfo({...f.placements[0],maxLoadSource:undefined,maxLoadKg:100}).source).toBe('입력값');
});
it('rewards actual side contact between unequal-height boxes without treating it as vertical support',()=>{
 const box=(id:string,x:number,h:number):Placement=>({id,typeId:'A',position:{x,y:0,z:0},size:{w:200,d:300,h},weight:2,orientation:0,supports:[],supportRatio:1,loadAbove:0});const input=new ArrivalEnvironment(scenario('identical')).input(emptyFrame(),'greedy',DEFAULT_SEARCH,'contact')!,lower=box('old',0,137),current=box('new',200,293);input.placements=[lower];const quality=packingQuality(current,input);expect(quality.contactRatio).toBeCloseTo(137*300/(2*293*(200+300)));expect(packingQuality({...current,position:{x:200,y:0,z:140}},input).contactRatio).toBe(0);expect(current.supports).toEqual([]);
});

it('recognizes an off-grid supporting face even when 100 mm surface cells cannot represent it',()=>{
 const input=new ArrivalEnvironment(scenario('identical')).input(emptyFrame(),'greedy',DEFAULT_SEARCH,'probe')!,box=(id:string,x:number,y:number,w:number,d:number,h:number,noLoad=false):Placement=>({id,typeId:id,position:{x,y,z:0},size:{w,d,h},weight:2,orientation:0,supports:[],supportRatio:1,loadAbove:0,maxLoadKg:80,...(noLoad?{handling:'no-top-load' as const}:{})}),base=box('base',0,0,322,231,167),placed=[base,box('right',322,0,878,1000,400,true),box('back',0,231,322,769,400,true)];input.types=[{id:'future',name:'future',size:{w:301,d:207,h:90},weight:1,quantity:1,orientations:[0],color:'#e8b86a'}];input.remaining={future:1};const map=surface(placed,input.pallet);expect(assessInventory({...input,settings:{...input.settings,inventoryMode:'sample-grid'}},placed,map,base).fitFraction).toBe(0);expect(assessInventory(input,placed,map,base).fitFraction).toBe(1);
});
