import { it,expect } from 'vitest';
import { standingHeight,isTallBox } from '../src/pallet/standingHeight';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { runScenario,ArrivalEnvironment } from '../src/pallet/environment';
import { inspectConstraints } from '../src/pallet/constraints';
import { remainingSites } from '../src/pallet/remainingSites';
import { COMPACT_SEARCH,emptyFrame } from '../src/pallet/types';
import type { Placement } from '../src/pallet/types';
const box=(id:string,x:number,y:number,z:number,w:number,d:number,h:number):Placement=>({id,typeId:id,position:{x,y,z},size:{w,d,h},weight:5,orientation:0,supports:[],supportRatio:1,loadAbove:0,material:'plastic',maxLoadKg:200});
const s=scenario('online-task'),tower=box('tall',400,0,0,160,180,500),low=box('low',0,0,0,400,400,250),high=box('high',0,0,250,400,400,250);

it('rejects an isolated tall box and defers it until a flat neighbouring stack reaches its top',()=>{
 expect(standingHeight(tower,[],s.constraints).valid).toBe(false);
 expect(standingHeight(tower,[low],s.constraints)).toMatchObject({valid:false,riseMm:250,limitMm:100});
 expect(standingHeight(tower,[low,high],s.constraints)).toMatchObject({valid:true,riseMm:0,referenceId:'high'});
 expect(standingHeight({...tower,size:{...tower.size,h:600}},[low,high],s.constraints).valid).toBe(true);
 expect(standingHeight({...tower,size:{...tower.size,h:601}},[low,high],s.constraints).valid).toBe(false);
});
it('does not mistake far towers, small edge slivers, or neighbouring upright boxes for a flat stack',()=>{
 expect(standingHeight(tower,[{...high,position:{...high.position,x:-100}}],s.constraints).valid).toBe(false);
 expect(standingHeight(tower,[{...high,size:{...high.size,d:89}}],s.constraints).valid).toBe(false);
 expect(standingHeight(tower,[box('upright',240,0,0,160,180,500)],s.constraints).valid).toBe(false);
 expect(standingHeight(tower,[{...high,position:{...high.position,x:-20}}],s.constraints).valid).toBe(true);
 expect(standingHeight(tower,[{...high,position:{...high.position,x:-21}}],s.constraints).valid).toBe(false);
});
it('classifies actual proportions independent of orientation code and caps small-box protrusion at a quarter of its height',()=>{
 expect(isTallBox(tower)).toBe(true);expect(isTallBox(low)).toBe(false);
 expect(standingHeight({...tower,size:{w:100,d:100,h:200}},[box('edge',0,0,0,400,400,140)],s.constraints)).toMatchObject({valid:false,riseMm:60,limitMm:50});
 expect(standingHeight(low,[],s.constraints).valid).toBe(true);
 expect(standingHeight(tower,[],{...s.constraints,standingHeight:{enabled:false,maxRiseMm:100}}).valid).toBe(true);
});
function fixture(){const f=scenario('online-task');delete f.generation;f.supplyMode='stock-select';f.events=[];f.constraints.robotMode='ideal';f.constraints.heavyRule='off';f.pallet={width:600,depth:400,maxHeight:900};f.types=[{id:'T',name:'세로',size:{w:500,d:180,h:160},weight:1,quantity:1,orientations:['hdw'],material:'plastic',maxLoadKg:100,color:'#6bcab7'},{id:'F',name:'눕힌 층',size:{w:400,d:400,h:250},weight:5,quantity:2,orientations:[0],material:'plastic',maxLoadKg:200,color:'#e8b86a'}];return f;}
for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} places two flat layers before placing the deferred tall box in the lower gap`,()=>{
 const f=fixture(),r=runScenario(f,algorithm,COMPACT_SEARCH);expect(r.metrics.count).toBe(3);expect(r.frame.records.map(v=>v.observation.typeId)).toEqual(['F','F','T']);
 expect(r.frame.records.at(-1)!.placement!.position.z).toBe(0);
 for(const rec of r.frame.records)expect(inspectConstraints(rec.placement!,rec.observation,rec.before,f.pallet,f.constraints).reasons).toEqual([]);
});
it('applies the same rule to remaining-stock probes and sequential mode without looking ahead',()=>{
 const f=fixture(),env=new ArrivalEnvironment(f),input=env.input(emptyFrame(),'greedy',COMPACT_SEARCH,'reserve')!;
 const settled=inspectConstraints(high,{...high,status:'normal',orientationAllowed:[0]},[low],f.pallet,f.constraints).stack;
 const before=remainingSites(input,[]),after=remainingSites(input,settled);expect(before.types.find(t=>t.id==='T')!.fitSites).toBe(0);expect(after.types.find(t=>t.id==='T')!.fitSites).toBeGreaterThan(0);
 f.supplyMode='arrival';f.arrival.pattern='ordered';const r=runScenario(f,'greedy',COMPACT_SEARCH);expect(r.metrics.count).toBe(0);expect(r.frame.records[0].observation.typeId).toBe('T');expect(r.frame.reason).toContain('세로 박스');
});
it('validates and preserves the policy in scenario JSON, defaulting older input to enabled',()=>{
 const f=fixture();expect(parseScenario(JSON.stringify(f)).constraints.standingHeight).toEqual({enabled:true,maxRiseMm:100});
 delete f.constraints.standingHeight;expect(parseScenario(JSON.stringify(f)).constraints.standingHeight?.enabled).toBe(true);
 for(const value of [null,false,{enabled:'yes',maxRiseMm:100},{enabled:true,maxRiseMm:-1},{enabled:true,maxRiseMm:501}])expect(()=>parseScenario(JSON.stringify({...f,constraints:{...f.constraints,standingHeight:value}}))).toThrow('세로 박스');
});
