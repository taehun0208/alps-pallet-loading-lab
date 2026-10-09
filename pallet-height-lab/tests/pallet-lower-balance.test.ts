import { it,expect } from 'vitest';
import { scenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { stability } from '../src/pallet/stability';
import { balance } from '../src/pallet/features';
import { contactsFor } from '../src/pallet/geometry';
import { DEFAULT_SEARCH,emptyFrame } from '../src/pallet/types';
import type { Placement,Observation } from '../src/pallet/types';
const box=(id:string,x=0,y=0,z=0,w=400,d=400,h=100,weight=10):Placement=>({id,typeId:id,position:{x,y,z},size:{w,d,h},weight,orientation:0,supports:[],supportRatio:1,loadAbove:0,material:'plastic',maxLoadKg:200});
const observation=(b:Placement):Observation=>({...b,status:'normal',orientationAllowed:[0]});

it('reports eccentric lower bases even when the whole pallet centre is perfectly balanced',()=>{
 const left=box('left'),right=box('right',600),a=box('a',275,0,100,100),b=box('b',625,0,100,100);a.supports=contactsFor(a,[left],.5);b.supports=contactsFor(b,[right],.5);
 const stack=[left,right,a,b],p={width:1000,depth:400,maxHeight:1000},r=stability(stack);
 expect(balance(stack,p).center.x).toBe(500);expect(r.violations).toEqual([]);expect(r.supports.find(s=>s.id==='left')!.center.x).toBe(262.5);expect(r.supports.find(s=>s.id==='right')!.center.x).toBe(737.5);expect(r.lowerBalance).toBeCloseTo(.3125);
 expect(r.supports.filter(s=>s.isBase).reduce((n,s)=>n+s.mass,0)).toBe(40);
});

it('splits bridge loads and conserves bottom force and moment without duplicating upper mass',()=>{
 const left=box('left',0,0,0,200,300,50,1),right=box('right',200,0,0,200,300,50,1),beam=box('beam',0,0,50,400,300,50,2),upper=box('upper',0,0,100,200,300,50,20);beam.supports=contactsFor(beam,[left,right],.5);upper.supports=contactsFor(upper,[beam],.5);
 const stack=[left,right,beam,upper],r=stability(stack),bases=r.supports.filter(s=>s.isBase),global=balance(stack,{width:400,depth:300,maxHeight:1000});
 expect(r.violations).toEqual([]);expect(bases.reduce((n,s)=>n+s.mass,0)).toBeCloseTo(24);expect(bases.reduce((n,s)=>n+s.center.x*s.mass,0)).toBeCloseTo(global.center.x*24);expect(bases[0].mass).toBeGreaterThan(bases[1].mass);expect(bases[0].center.x).toBeLessThan(200);expect(bases[1].center.x).toBeGreaterThan(200);
});

for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} places a counterweight beside an existing upper box to centre the lower base`,()=>{
 const s=scenario();s.pallet={width:400,depth:400,maxHeight:800};s.supplyMode='stock-select';const base=box('base'),left=box('left',0,100,100,200,200),next=box('next',0,0,0,200,200);left.supports=contactsFor(left,[base],.5);
 const env=new ArrivalEnvironment(s),input=env.input(emptyFrame(),algorithm,DEFAULT_SEARCH,'lower')!;input.placements=[base,left];input.current=observation(next);input.available=[observation(next)];input.types=[{id:'next',name:'next',size:next.size,weight:10,quantity:1,orientations:[0],material:'plastic',maxLoadKg:200,color:'#6bcab7'}];input.remaining={next:1};
 const a=plan(input),chosen=a.candidates.find(c=>c.id===a.selectedId)!;expect(chosen.valid).toBe(true);expect(chosen.placement.position).toEqual({x:200,y:100,z:100});expect(chosen.features.lowerBalance).toBeCloseTo(0);expect(chosen.terms.lowerBalance).toBeCloseTo(0);expect(stability([...input.placements,chosen.placement]).supports.find(s=>s.id==='base')!.center.x).toBeCloseTo(200);
 expect(a.candidates.some(c=>c.valid&&(c.features.lowerBalance??0)>.05)).toBe(true);
});

for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} selects larger footprints before smaller boxes despite their immediate height score`,()=>{
 const s=scenario();s.supplyMode='stock-select';s.pallet={width:800,depth:800,maxHeight:1000};s.types=[{id:'small',name:'small',size:{w:200,d:200,h:20},weight:1,quantity:1,orientations:[0],material:'plastic',maxLoadKg:200,color:'#6bcab7'},{id:'large',name:'large',size:{w:500,d:450,h:200},weight:8,quantity:1,orientations:[0],material:'paper',maxLoadKg:100,color:'#e8b86a'}];
 const input=new ArrivalEnvironment(s).input(emptyFrame(),algorithm,{...DEFAULT_SEARCH,weights:{...DEFAULT_SEARCH.weights,maximum:10000}},'size')!,a=plan(input);expect(a.selectedBoxId).toBe('large-01');expect(a.stockSelection!.footprintMm2).toBe(225000);expect(a.stockSelection!.sizePriority).toBe('footprint-volume');
});

it('breaks equal footprint ties by volume and defers a larger unsafe tall box',()=>{
 const s=scenario();s.supplyMode='stock-select';s.pallet={width:500,depth:500,maxHeight:1800};s.types=[{id:'short',name:'short',size:{w:400,d:400,h:100},weight:5,quantity:1,orientations:[0],material:'plastic',maxLoadKg:200,color:'#6bcab7'},{id:'thick',name:'thick',size:{w:400,d:400,h:200},weight:5,quantity:1,orientations:[0],material:'plastic',maxLoadKg:200,color:'#6bcab7'},{id:'unsafe',name:'unsafe',size:{w:500,d:500,h:1600},weight:5,quantity:1,orientations:[0],material:'plastic',maxLoadKg:200,color:'#6bcab7'}];
 const input=new ArrivalEnvironment(s).input(emptyFrame(),'greedy',DEFAULT_SEARCH,'size')!,a=plan(input);expect(a.selectedBoxId).toBe('thick-01');expect(a.stockSelection!.deferred.find(d=>d.id==='unsafe')!.reason).toContain('세로 박스 주변 높이 부족');expect(input.available).toHaveLength(3);
});
