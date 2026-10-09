import {describe,it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {assignCentrally} from '../src/pallet/relay/centralDispatch';
import {observedProblem,planStream,type FlowProposal} from '../src/pallet/relay/streamPlanner';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {createStream,advanceStream,applyDecision,assertStreamInventory} from '../src/pallet/relay/streamEngine';
import {stationArc} from '../src/pallet/relay/streamGeometry';
import {inspectConstraints} from '../src/pallet/constraints';
import {receiveConstraints} from '../src/pallet/relay/motion';
import type {RelayMotion} from '../src/pallet/relay/types';
import type {Candidate} from '../src/pallet/types';
const offer=(robot:number,boxId:string,score=1):FlowProposal=>({robot,boxId,cellVersion:0,candidates:[{score} as Candidate],reason:'test',blocked:0,tested:0});
function ready(){const s=streamInventory(42,8);s.types=s.types.slice(0,4);s.types.forEach(t=>{t.size={w:320,d:270,h:180};t.weight=3;t.maxLoadKg=100;t.handling=undefined;t.orientations=[0,90];});const w=createStream(s);w.time=100;w.stream!.inputClosed=true;w.boxes.forEach((b,i)=>{b.status='belt';b.flow={enteredAt:100-(stationArc(i,s.pallet)-600)/w.stream!.speed,measuredAt:0,passes:0,lastReason:'',checks:{}};});return{s,w};}
describe('central dispatch',()=>{
 it('chooses a joint assignment instead of each robot taking its first box',()=>{
  const r=assignCentrally([offer(0,'a',100),offer(0,'b',1),offer(1,'a',2)]);expect(r.commands.map(p=>[p.robot,p.boxId])).toEqual([[0,'b'],[1,'a']]);expect(r.dispatch.capped).toBe(false);
 });
 it('is deterministic, bounded, respects busy robots and reserves each resource once',()=>{
  const offers=[offer(0,'a'),offer(0,'b'),offer(1,'a'),offer(1,'c'),offer(2,'c'),offer(3,'d')],a=assignCentrally(offers,[3]),b=assignCentrally(offers,[3]);expect(a).toEqual(b);expect(a.commands).toHaveLength(3);expect(new Set(a.commands.map(p=>p.robot)).size).toBe(3);expect(new Set(a.commands.map(p=>p.boxId)).size).toBe(3);expect(assignCentrally(offers,[],2).dispatch.capped).toBe(true);expect(assignCentrally(offers,[],2).dispatch.visited).toBe(2);
 });
 it('centrally commands four simultaneous robots, rejects stale global pallet snapshots',()=>{
  const {s,w}=ready(),view=observedProblem(s,w),d=planStream(view.scenario,view.world),a=applyDecision(s,w,[],d);
  expect(d.dispatch?.commands).toBe(4);expect(a.motions).toHaveLength(4);expect(a.motions.every(m=>m.action.reason.startsWith('중앙 배정'))).toBe(true);expect(assertStreamInventory(a.world,a.motions)).toBe(true);expect(applyDecision(s,a.world,a.motions,d).motions).toHaveLength(4);
  const changed=structuredClone(w);changed.cells[2].version++;expect(applyDecision(s,changed,[],d).motions).toHaveLength(0);
  const unmeasured=structuredClone(w);unmeasured.boxes.forEach(b=>b.flow!.measuredAt=200);expect(applyDecision(s,unmeasured,[],d).motions).toHaveLength(0);
 });
 it('does not interpret scheduling deferral as physical no-fit or pallet exhaustion',()=>{
  const {s,w}=ready(),view=observedProblem(s,w),d=planStream(view.scenario,view.world);d.commands=[];const r=applyDecision(s,w,[],d);
  expect(r.motions).toHaveLength(0);expect(r.world.stream!.cells.every(c=>c.rejected.length===0)).toBe(true);expect(r.world.boxes.every(b=>b.flow!.lastReason.includes('중앙 배정 보류'))).toBe(true);expect(r.world.boxes.every(b=>Object.keys(b.flow!.checks).length===0)).toBe(true);
 });
 it('never uses unmeasured future inventory and keeps the legacy planner selectable',()=>{
  const {s,w}=ready(),future=structuredClone(w.boxes[0]);future.observation.id='unmeasured';future.flow!.measuredAt=999;w.boxes.push(future);const o=observedProblem(s,w);expect(o.world.boxes.map(b=>b.observation.id)).not.toContain('unmeasured');expect(planStream(o.scenario,o.world).proposals.some(p=>p.boxId==='unmeasured')).toBe(false);expect(planStream(o.scenario,o.world,[],false).commands).toBeUndefined();
 });
 it('runs matched conveyor comparisons with causal inputs and conserved stock',()=>{
  const rows:any[]=[];
  for(const seed of [41,42])for(const central of [false,true]){const s=streamInventory(seed,12);let w=createStream(s),motions:RelayMotion[]=[],peak=0,ms=0,checks=0,decisions=0;
   for(let time=.25;time<400;time+=1){({world:w,motions}=advanceStream(s,w,motions,time));const o=observedProblem(s,w),d=planStream(o.scenario,o.world,motions.map(m=>m.action.robot),central);ms+=d.milliseconds;checks+=d.checks;decisions++;({world:w,motions}=applyDecision(s,w,motions,d));peak=Math.max(peak,motions.length);assertStreamInventory(w,motions);if(w.stream!.complete)break;}
   const stacks=[...w.cells,...w.stream!.dispatched].map(c=>c.placements);for(const stack of stacks)for(const p of stack){const b=w.boxes.find(b=>b.observation.id===p.id)!;expect(inspectConstraints(p,b.observation,stack.filter(q=>q.id!==p.id),s.pallet,receiveConstraints(s)).reasons.filter(r=>!r.includes('접근')&&!r.includes('경로'))).toEqual([]);}
   rows.push({seed,central,placed:w.boxes.filter(b=>b.status==='placed').length,input:w.boxes.length,peak,seconds:w.time,planningMs:ms,checks,decisions,complete:w.stream!.complete,unplaced:w.boxes.filter(b=>b.status!=='placed').map(b=>({id:b.observation.id,status:b.status,reason:b.flow?.lastReason})),records:w.records});
  }
  mkdirSync('docs/ordering-results',{recursive:true});writeFileSync('docs/ordering-results/central-conveyor.json',JSON.stringify(rows,null,2));expect(rows.every(r=>r.peak>=2)).toBe(true);
 },180000);
});
