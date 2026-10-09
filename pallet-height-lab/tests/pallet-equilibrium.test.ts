import { it,expect } from 'vitest';
import { contactsFor,calculateLoads } from '../src/pallet/geometry';
import { equilibrium } from '../src/pallet/equilibrium';
import { inspectConstraints } from '../src/pallet/constraints';
import { scenario } from '../src/pallet/scenarios';
import type { Placement } from '../src/pallet/types';
const base=(id:string,x:number):Placement=>({id,typeId:'P',position:{x,y:0,z:0},size:{w:200,d:300,h:150},weight:1,material:'plastic',orientation:0,supports:[],supportRatio:1,loadAbove:0});
it('balances a heavy bridge on light strong bases without assigning its whole centroid to every base',()=>{
 const lower=[base('left',0),base('right',200)],beam={...base('beam',0),position:{x:0,y:0,z:150},size:{w:400,d:300,h:150},weight:40},s=scenario(),r=inspectConstraints(beam,{...beam,status:'normal',orientationAllowed:[0]},lower,s.pallet,s.constraints);
 expect(r.reasons).toEqual([]);expect(r.stack[0].loadAbove).toBeCloseTo(20);expect(r.stack[1].loadAbove).toBeCloseTo(20);expect(r.placement.supports.map(c=>c.forcePoint!.x)).toEqual([100,300]);
});
it('conserves force and horizontal moments with an eccentric upper load and never mutates input',()=>{
 const left=base('left',0),right=base('right',200),beam={...base('beam',0),position:{x:0,y:0,z:150},size:{w:400,d:300,h:150},weight:2},upper={...base('upper',0),position:{x:0,y:0,z:300},size:{w:200,d:300,h:100},weight:20};beam.supports=contactsFor(beam,[left,right],.5);upper.supports=contactsFor(upper,[beam],.5);const original=[left,right,beam,upper],snapshot=JSON.stringify(original),r=equilibrium(original),loads=calculateLoads(r.placements);
 expect(r.violations).toEqual([]);expect(JSON.stringify(original)).toBe(snapshot);expect(loads.left+loads.right).toBeCloseTo(22);expect(loads.left).toBeGreaterThan(loads.right);
 for(const b of r.placements.filter(b=>b.supports.length)){const m=r.moments.get(b.id)!;expect(b.supports.reduce((n,c)=>n+c.share,0)).toBeCloseTo(1);expect(b.supports.reduce((n,c)=>n+c.share*c.forcePoint!.x*m.mass,0)).toBeCloseTo(m.mx,6);expect(b.supports.reduce((n,c)=>n+c.share*c.forcePoint!.y*m.mass,0)).toBeCloseTo(m.my,6);for(const c of b.supports){expect(c.share).toBeGreaterThanOrEqual(0);expect(c.forcePoint!.x).toBeGreaterThanOrEqual(c.rect.x-1e-6);expect(c.forcePoint!.x).toBeLessThanOrEqual(c.rect.x+c.rect.w+1e-6);}}
});
