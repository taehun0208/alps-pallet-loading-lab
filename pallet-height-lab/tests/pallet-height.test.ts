import { it,expect } from 'vitest';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { emptyFrame } from '../src/pallet/types';
import type { Placement } from '../src/pallet/types';
import { heightSummary } from '../src/pallet/heightSummary';

it('discloses selectable stock and synthetic strengths without relaxing the task constraints',()=>{
 const s=scenario('high-stack');expect(parseScenario(JSON.stringify(s))).toEqual(s);
 expect(s.constraints).toEqual(scenario('online-task').constraints);
 expect(s.pallet).toEqual(scenario('online-task').pallet);
 expect(s.supplyMode).toBe('stock-select');expect(s.types).toHaveLength(24);
 expect(new Set(s.types.map(t=>JSON.stringify(t.size))).size).toBe(24);
 expect(s.types.every(t=>t.maxLoadSource==='synthetic')).toBe(true);
 expect(s.types.some(t=>t.size.w%50!==0&&t.size.d%50!==0)).toBe(true);
});
it('counts the longest physical support chain rather than distinct top heights',()=>{
 const b=(id:string,z:number,h:number,parents:string[]=[]):Placement=>({id,typeId:id,position:{x:0,y:0,z},size:{w:200,d:200,h},weight:1,orientation:0,supportRatio:1,loadAbove:0,supports:parents.map(id=>({id,area:40000,share:1,rect:{x:0,y:0,w:200,d:200}}))});
 const f=emptyFrame();f.placements=[b('a',0,200),b('b',0,300),b('c',0,400)];
 expect(heightSummary(f,scenario('online-task')).layers).toBe(1);
 f.placements.push(b('d',300,100,['b']),b('e',400,200,['c','d']));
 const h=heightSummary(f,scenario('online-task'));expect(h.layers).toBe(3);expect(h.height).toBe(600);expect(h.headroom).toBe(1000);
 // Display and replay calculations must not reorder or mutate the frame.
 expect(f.placements.map(b=>b.id)).toEqual(['a','b','c','d','e']);
});
it('does not invent a support percentage when no inspected upper candidates are available',()=>{
 const f=emptyFrame();f.blocked=true;
 const h=heightSummary(f,scenario('online-task'));expect(h.bestUpperSupport).toBeNull();expect(h.upperInspected).toBe(0);expect(h.layers).toBe(0);
});
