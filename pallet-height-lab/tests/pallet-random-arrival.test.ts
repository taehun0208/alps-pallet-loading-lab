import { it,expect } from 'vitest';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { randomScenario,DEFAULT_RANDOM,LEGACY_RANDOM } from '../src/pallet/random';
import { ArrivalEnvironment,advance,replay,runScenario } from '../src/pallet/environment';
import { plan,virtualSequences } from '../src/pallet/planner';
import { DEFAULT_SEARCH,emptyFrame } from '../src/pallet/types';
const search={...DEFAULT_SEARCH,topK:3,samples:2,depth:2};
const randomInput=(seed=42)=>{const s=scenario('identical',seed);s.arrival.pattern='random-draw';s.types=[{...s.types[0],quantity:3},{...s.types[0],id:'B',quantity:9},{...s.types[0],id:'zero',quantity:0}];return s;};
it('draws only the requested observation and never rerolls it on reads, pause or replay',()=>{
 const e=new ArrivalEnvironment(randomInput());expect(e.total).toBe(12);expect(e.sampledCount).toBe(0);const first=e.current(0)!;expect(e.sampledCount).toBe(1);first.size.w=9999;expect(e.current(0)!.size.w).toBe(300);for(let i=0;i<10;i++)e.remaining(emptyFrame());expect(e.sampledCount).toBe(1);expect(e.current(-1)).toBeNull();expect(e.current(12)).toBeNull();expect(e.current(.5)).toBeNull();expect(e.sampledCount).toBe(1);
 const input=e.input(emptyFrame(),'greedy',search,'one')!,f=advance(emptyFrame(),input,plan(input));e.current(f.processed);expect(e.sampledCount).toBe(2);const old=replay(f.records,0);expect(e.current(old.processed)!.id).toBe(input.current.id);expect(e.sampledCount).toBe(2);
});
it('reproduces random draws, preserves every individual box and changes only order with arrival seed',()=>{
 const a=new ArrivalEnvironment(randomInput()),b=new ArrivalEnvironment(randomInput()),c=new ArrivalEnvironment(randomInput(900));const draw=(e:ArrivalEnvironment)=>Array.from({length:e.total},(_,i)=>e.current(i)!);
 const aa=draw(a);expect(aa).toEqual(draw(b));expect(aa.map(o=>o.id)).not.toEqual(draw(c).map(o=>o.id));expect(new Set(aa.map(o=>o.id)).size).toBe(12);expect(aa.filter(o=>o.typeId==='A')).toHaveLength(3);expect(aa.filter(o=>o.typeId==='B')).toHaveLength(9);expect(aa.some(o=>o.typeId==='zero')).toBe(false);expect(a.current(12)).toBeNull();
});
it('samples types in proportion to available individual quantities rather than uniformly over types',()=>{
 let count=0;for(let seed=0;seed<4096;seed++){const s=randomInput(seed);s.types[0].quantity=1;if(new ArrivalEnvironment(s).current(0)!.typeId==='B')count++;}expect(count/4096).toBeGreaterThan(.87);expect(count/4096).toBeLessThan(.93);
});
it.each(['bl','greedy','rollout'] as const)('%s uses the same draw stream, conserves counts and retains constraints',algorithm=>{
 const s=randomInput(),r=runScenario(s,algorithm,search),env=new ArrivalEnvironment(s);expect(r.metrics.complete).toBe(true);expect(r.metrics.count).toBe(12);for(let n=0;n<=r.frame.records.length;n++){const f=replay(r.frame.records,n),remaining=env.remaining(f);expect(Object.values(remaining).every(q=>q>=0)).toBe(true);expect(Object.values(remaining).reduce((a,b)=>a+b,0)+(env.current(f.processed)?1:0)+f.placements.length+f.excluded.length+f.missing.length).toBe(12);}expect(r.frame.records.map(r=>r.observation.id)).toEqual(Array.from({length:12},(_,i)=>env.current(i)!.id));expect(r.metrics.workSeconds).toBe(0);expect(r.metrics.loadUtilization).toBeLessThanOrEqual(1);
 const input=env.input(emptyFrame(),algorithm,search,'input')!;expect(Object.keys(input).sort()).toEqual(['algorithm','constraints','current','pallet','placements','remaining','runId','settings','stepId','types']);expect(virtualSequences(input)).toEqual(virtualSequences({...input,runId:'other'}));
},30000);
it('random draw applies damaged, missing and resize events without losing inventory',()=>{
 const s=randomInput();s.events=[{step:2,kind:'damaged'},{step:5,kind:'missing'},{step:8,kind:'resize',size:{w:300,d:250,h:200}}];const r=runScenario(s,'greedy',search),e=new ArrivalEnvironment(s);expect(r.frame.processed).toBe(12);expect(r.frame.excluded).toHaveLength(1);expect(r.frame.missing).toHaveLength(1);expect(r.frame.records[7].observation.status).toBe('resized');for(let n=0;n<=12;n++){const f=replay(r.frame.records,n);expect(Object.values(e.remaining(f)).reduce((a,b)=>a+b,0)+(e.current(f.processed)?1:0)+f.placements.length+f.excluded.length+f.missing.length).toBe(12);}
});
it('keeps a blocked current box and does not draw a replacement to skip failure',()=>{
 const s=scenario('impossible',1);s.arrival.pattern='random-draw';const e=new ArrivalEnvironment(s);let f=emptyFrame();while(!f.blocked&&f.processed<e.total){const i=e.input(f,'greedy',search,'run')!;f=advance(f,i,plan(i));}expect(f.blocked).toBe(true);const sampled=e.sampledCount,id=f.records.at(-1)!.observation.id;expect(e.current(f.processed)!.id).toBe(id);e.input(f,'greedy',search,'run');expect(e.sampledCount).toBe(sampled);expect(Object.values(e.remaining(f)).reduce((a,b)=>a+b,0)+1+f.placements.length).toBe(e.total);
});
it('serializes random mode and independent generation seeds while preserving shuffle compatibility',()=>{
 const a=randomScenario({...DEFAULT_RANDOM,seed:123,arrivalSeed:999,arrivalPattern:'random-draw'}),b=randomScenario({...DEFAULT_RANDOM,seed:123,arrivalSeed:111,arrivalPattern:'random-draw'});expect(a.types).toEqual(b.types);expect(parseScenario(JSON.stringify(a))).toEqual(a);expect(randomScenario(LEGACY_RANDOM).arrival.pattern).toBe('shuffle');expect(()=>parseScenario(JSON.stringify({...a,arrival:{seed:1,pattern:'invalid'}}))).toThrow('입고');
});
