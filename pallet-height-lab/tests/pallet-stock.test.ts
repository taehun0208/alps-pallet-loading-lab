import { it,expect } from 'vitest';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { runScenario,ArrivalEnvironment,replay,advance } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { DEFAULT_SEARCH,emptyFrame } from '../src/pallet/types';
import { stability } from '../src/pallet/stability';
import type { Scenario } from '../src/pallet/types';
// Historical single-pedestal fixture tests load capacity and stock selection separately.
function fixture():Scenario {const s=scenario('identical');s.constraints.standingHeight!.enabled=false;s.pallet={width:503,depth:407,maxHeight:900};s.arrival.pattern='ordered';s.types=[
 {id:'tall',name:'먼저 도착한 긴 박스',size:{w:177,d:211,h:417},weight:7,quantity:1,orientations:[0,90],material:'paper',maxLoadKg:10,color:'#e8b86a'},
 {id:'base',name:'넓고 튼튼한 받침',size:{w:503,d:407,h:97},weight:4,quantity:1,orientations:[0],material:'plastic',maxLoadKg:100,color:'#6bcab7'}];return s;}
for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} chooses the strong base before a currently unstable box and then places both`,()=>{
 const s=fixture();expect(runScenario(s,algorithm,DEFAULT_SEARCH).metrics.count).toBe(0);s.supplyMode='stock-select';const r=runScenario(s,algorithm,DEFAULT_SEARCH);expect(r.metrics.complete).toBe(true);expect(r.frame.records.map(r=>r.observation.typeId)).toEqual(['base','tall']);expect(r.frame.placements[1].position.z).toBe(97);expect(stability(r.frame.placements,s.constraints.stability).violations).toEqual([]);expect(parseScenario(JSON.stringify(s))).toEqual(s);
 const env=new ArrivalEnvironment(s);for(let n=0;n<=r.frame.records.length;n++){const f=replay(r.frame.records,n);expect(Object.values(env.remaining(f)).reduce((a,b)=>a+b,0)+f.placements.length).toBe(2);}
});
it('defers impossible stock without throwing away its quantity, while still loading other boxes',()=>{
 const s=fixture();s.supplyMode='stock-select';s.types[0].size.w=800;const r=runScenario(s,'greedy',DEFAULT_SEARCH),e=new ArrivalEnvironment(s);expect(r.metrics.count).toBe(1);expect(r.frame.placements[0].typeId).toBe('base');expect(r.frame.blocked).toBe(true);expect(r.metrics.reason).toContain('팔레트 경계');expect(e.remaining(r.frame)).toEqual({base:0,tall:1});expect(r.frame.records.at(-1)!.analysis!.stockSelection!.checkedTypes).toBe(1);
});
it('selects on actual per-box capacity instead of assuming all plastics are stronger than paper',()=>{
 const s=fixture();s.supplyMode='stock-select';s.types[1].material='paper';s.types[0].material='plastic';const r=runScenario(s,'greedy',DEFAULT_SEARCH);expect(r.metrics.complete).toBe(true);expect(r.frame.placements[0].material).toBe('paper');expect(r.frame.placements[1].supports[0].id).toBe(r.frame.placements[0].id);
});
it('rejects a stale result and keeps selection deterministic without drawing another arrival',()=>{
 const s=fixture();s.supplyMode='stock-select';const env=new ArrivalEnvironment(s),i=env.input(emptyFrame(),'greedy',DEFAULT_SEARCH,'stock')!,a=plan(i);expect(env.currentFor(emptyFrame(),a)!.typeId).toBe('base');expect(plan(i).selectedBoxId).toBe(a.selectedBoxId);expect(env.sampledCount).toBe(0);expect(advance(emptyFrame(),i,{...a,runId:'stale'})).toEqual(emptyFrame());
 const f=advance(emptyFrame(),i,a);expect(plan(env.input(f,'greedy',DEFAULT_SEARCH,'stock')!).selectedBoxId).toBe('tall-01');
});
