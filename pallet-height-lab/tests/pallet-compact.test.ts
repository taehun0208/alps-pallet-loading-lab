import { it,expect } from 'vitest';
import { scenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment,runScenario } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { COMPACT_SEARCH,emptyFrame } from '../src/pallet/types';
import { trappedBelow } from '../src/pallet/compactPacking';
import { inspectConstraints } from '../src/pallet/constraints';
import type { Placement,BoxType } from '../src/pallet/types';
const type=(id:string,w:number,d:number,h:number,weight=4):BoxType=>({id,name:id,size:{w,d,h},weight,quantity:1,orientations:[0,90],color:'#6bcab7',material:'plastic',maxLoadKg:200});
const placed=(id:string,x:number,y:number,z:number,w:number,d:number,h:number,weight=10):Placement=>({id,typeId:id,position:{x,y,z},size:{w,d,h},weight,orientation:0,supports:[],supportRatio:1,loadAbove:0,maxLoadKg:200,material:'plastic'});
function input(types:BoxType[],placements:Placement[]){const s=scenario('online-task');s.supplyMode='stock-select';s.pallet={width:800,depth:600,maxHeight:1200};s.constraints.robotMode='ideal';s.types=types;const i=new ArrivalEnvironment(s).input(emptyFrame(),'greedy',COMPACT_SEARCH,'compact')!;i.placements=placements;return i;}

for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} fills the remaining low pocket with a smaller box before sending a larger box upstairs`,()=>{
 const i=input([type('large',550,550,120),type('small',200,600,100)],[placed('base',0,0,0,600,600,180,20)]);i.algorithm=algorithm;const a=plan(i),c=a.candidates.find(c=>c.id===a.selectedId)!;
 expect(c.placement.id).toBe('small-01');expect(c.placement.position).toEqual({x:600,y:0,z:0});expect(a.candidates.some(c=>c.valid&&c.placement.typeId==='large'&&c.placement.position.z===180)).toBe(true);
 expect(c.reservation).toBeDefined();expect(a.stockSelection?.sizePriority).toBe('low-space-fit');
});

for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} uses a level surface shared by two boxes without preferring a separate centred column`,()=>{
 const i=input([type('bridge',500,500,150)],[placed('left',0,0,0,400,600,180),placed('right',400,0,0,400,600,180)]);i.algorithm=algorithm;const a=plan(i),c=a.candidates.find(c=>c.id===a.selectedId)!;
 expect(c.valid).toBe(true);expect(c.placement.supports).toHaveLength(2);expect(c.placement.supportRatio).toBeCloseTo(1);expect(inspectConstraints(c.placement,i.current,i.placements,i.pallet,i.constraints).reasons).toEqual([]);
});

it('does not invent a flat surface across different heights or weaken load or boundary checks',()=>{
 const i=input([type('bridge',700,600,150)],[placed('left',0,0,0,400,600,180),placed('right',400,0,0,400,600,167)]);expect(plan(i).selectedId).toBeNull();
 i.placements=[placed('weak',0,0,0,800,600,180,1)];expect(plan(i).selectedId).toBeNull();
 i.types[0].size.w=900;i.current.size.w=900;i.available![0].size.w=900;expect(plan(i).selectedId).toBeNull();
});

it('counts sub-grid buried gaps exactly instead of hiding them on the surface grid',()=>{
 const boxes=[placed('a',0,0,0,197,400,100),placed('b',200,0,0,200,400,100)];
 expect(trappedBelow(placed('top',0,0,100,400,400,100),boxes)).toBe(3*400*100);
});

it('replays a mixed repeated inventory deterministically with all quantities and hard checks preserved',()=>{
 const s=scenario('online-task');s.supplyMode='stock-select';s.constraints.robotMode='ideal';s.pallet={width:800,depth:600,maxHeight:1000};s.types=[{...type('a',390,290,137,8),quantity:4},{...type('b',191,281,183,4),quantity:6},{...type('c',273,187,109,2),quantity:6}];
 const first=runScenario(s,'greedy',COMPACT_SEARCH),second=runScenario(s,'greedy',COMPACT_SEARCH);
 expect(first.frame.placements).toEqual(second.frame.placements);expect(first.metrics.count).toBeGreaterThan(8);
 for(const record of first.frame.records){if(!record.analysis)continue;expect(record.analysis.candidates.length).toBeLessThanOrEqual(96);expect(record.analysis.checkedCandidates).toBeGreaterThanOrEqual(record.analysis.candidates.length);if(record.analysis.selectedId)expect(record.analysis.candidates.some(c=>c.id===record.analysis!.selectedId)).toBe(true);}
 expect(first.frame.placements.some(b=>b.orientation===90)).toBe(true);
 for(const r of first.frame.records)if(r.placement)expect(inspectConstraints(r.placement,r.observation,r.before,s.pallet,s.constraints).reasons).toEqual([]);
 const e=new ArrivalEnvironment(s);expect(first.metrics.count+Object.values(e.remaining(first.frame)).reduce((a,b)=>a+b,0)).toBe(16);
},30000);
