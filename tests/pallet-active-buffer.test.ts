import { describe,it,expect } from 'vitest';
import { runBufferExperiment,type BufferMode } from '../src/pallet/singleRobot/bufferExperiment';
import { buildCase } from '../src/pallet/singleRobot/situations';
import type { BoxType } from '../src/pallet/types';

const modes:BufferMode[]=['overflow','window-fifo','window-best'];
const box=(id:string,w:number,weight:number,quantity=1):BoxType=>({id,name:id,size:{w,d:w,h:200},weight,quantity,orientations:[0,90],color:'#888',material:'plastic',maxLoadKg:200,maxLoadSource:'synthetic'});
function fixture(bufferSize=1){
 const c=buildCase('mixed-small','dev',1);c.scenario.types=[box('small',400,1),box('large',800,10)];c.sequence=['small','large'];c.bufferSize=bufferSize;
 c.scenario.pallet={width:800,depth:800,maxHeight:400};c.scenario.constraints.standingHeight={enabled:false,maxRiseMm:100};return c;
}
const placements=(r:ReturnType<typeof runBufferExperiment>)=>r.pallets.map(p=>p.placements.map(b=>({id:b.id,position:b.position})));
describe('observed-box buffer experiment',()=>{
 it('chooses a foundation box from the observed window and improves a controlled fixture',()=>{
  const c=fixture(),fifo=runBufferExperiment(c,{mode:'window-fifo'}),best=runBufferExperiment(c,{mode:'window-best'});
  expect(fifo.performance.pallets).toBe(2);expect(best.performance.pallets).toBe(1);
  expect(best.history.find(h=>h.action==='place')?.box).toBe('box-1');
  for(const r of [fifo,best]){expect(r.performance.completed).toBe(2);expect(r.fitness.status).toBe('pass');expect(r.buffer.peak).toBeLessThanOrEqual(1);}
 });
 it('reduces all policies to the same placement order with zero buffer',()=>{
  const runs=modes.map(mode=>runBufferExperiment(fixture(0),{mode}));
  for(const r of runs){expect(placements(r)).toEqual(placements(runs[0]));expect(r.buffer.stores).toBe(0);}
 });
 it('does not inspect unseen boxes or mutate the supplied case',()=>{
  const c=fixture(),original=structuredClone(c),seen:string[]=[];
  runBufferExperiment(c,{mode:'window-best',audit:i=>{seen.push(i.current.id);expect(i.pending!.unarrived).toEqual({T001:0,T002:0});expect(Object.values(i.remaining).reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(1);}});
  expect(seen).toContain('box-1');expect(c).toEqual(original);
 });
 it('accounts for storage, retrieval, arrivals and exchange under explicit timing assumptions',()=>{
  const timing={arrivalIntervalSeconds:100,storeSeconds:2,retrieveSeconds:3,exchangeSeconds:7};
  const r=runBufferExperiment(fixture(),{mode:'window-best',timing});
  expect(r.buffer.stores).toBe(1);expect(r.buffer.retrieves).toBe(1);expect(r.buffer.maxWaitArrivalSteps).toBe(1);
  expect(r.robot.bufferHandlingSeconds).toBe(5);expect(r.robot.serialModelSeconds).toBeCloseTo(100+r.robot.placementSeconds+3);
  expect(runBufferExperiment(fixture(),{mode:'window-best'}).robot.serialModelSeconds).toBeNull();
 });
 it('flushes short orders, isolates oversized boxes, and conserves every box at capacities 0/2/4',()=>{
  for(const capacity of [0,2,4])for(const mode of modes){
   const c=fixture(capacity);c.scenario.types.push(box('oversized',2000,5));c.sequence.push('oversized');
   const r=runBufferExperiment(c,{mode});expect(r.performance.completed).toBe(2);expect(r.performance.rejected).toBe(1);
   expect(r.buffer.peak).toBeLessThanOrEqual(capacity);expect(new Set(r.pallets.flatMap(p=>p.placements.map(b=>b.id))).size).toBe(2);
  }
 });
 it('reports empty inputs without claiming success and rejects unsupported event cases',()=>{
  const c=fixture();c.sequence=[];c.scenario.types=[];expect(runBufferExperiment(c,{mode:'window-best'}).fitness.status).toBe('unverified');
  expect(()=>runBufferExperiment({...fixture(),events:[{kind:'missing',at:0}]},{mode:'window-best'})).toThrow(/normal/);
  expect(()=>runBufferExperiment(fixture(-1),{mode:'window-best'})).toThrow(/buffer size/);
 });
 it('reproduces non-timing results for the same input',()=>{
  const strip=(r:ReturnType<typeof runBufferExperiment>)=>({...r,compute:{...r.compute,decisionMs:[],plannerMs:[]}});
  expect(strip(runBufferExperiment(fixture(),{mode:'window-best'}))).toEqual(strip(runBufferExperiment(fixture(),{mode:'window-best'})));
 });
 it('keeps early actions unchanged when only the unseen arrival suffix changes',()=>{
  const c=fixture(2);c.scenario.types=c.scenario.types.map(t=>({...t,quantity:3}));
  c.sequence=['small','large','small','large','small','large'];
  const other={...structuredClone(c),sequence:['small','large','small','small','large','large']};
  for(const mode of modes){const prefix=(x:typeof c)=>runBufferExperiment(x,{mode}).history.filter(h=>h.arrival<3);
   expect(prefix(c)).toEqual(prefix(other));}
 });
});
