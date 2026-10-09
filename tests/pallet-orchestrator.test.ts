import {describe,it,expect} from 'vitest';
import {rankAssignments} from '../src/pallet/relay/orchestrator';
import type {OrchestrationBid} from '../src/pallet/relay/orchestrator';
import {createStream,applyDecision} from '../src/pallet/relay/streamEngine';
import {planStream,observedProblem} from '../src/pallet/relay/streamPlanner';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {stationArc} from '../src/pallet/relay/streamGeometry';
const bid=(robot:number,score:number,eligible=true):OrchestrationBid=>({robot,score,eligible,arrivalSeconds:eligible?0:8,workSeconds:5,remainingVolumeRatio:.7,futureFitRatio:1,reason:'fixture'});
function fixture(){
 const s=streamInventory(42,8);s.types=s.types.slice(0,4);s.types.forEach(t=>{t.size={w:320,d:270,h:180};t.weight=3;t.maxLoadKg=100;t.handling=undefined;t.orientations=[0,90];});
 const w=createStream(s);w.time=100;w.stream!.inputClosed=true;
 w.boxes.forEach((b,i)=>{b.status='belt';b.flow={enteredAt:100-(stationArc(i,s.pallet)-600)/w.stream!.speed,measuredAt:0,passes:0,lastReason:'',checks:{}};});
 return {s,w};
}
describe('central coordinator',()=>{
 it('can pass a box to a downstream cell with a better score without reserving it now',()=>{
  const [a]=rankAssignments([{boxId:'a',passes:0,bids:[bid(0,60),bid(1,85,false)]}]);
  expect(a.robot).toBe(1);expect(a.launchNow).toBe(false);
 });
 it('serves recirculated stock now and never assigns two boxes to the same robot',()=>{
  const result=rankAssignments([{boxId:'a',passes:0,bids:[bid(0,90),bid(1,80)]},{boxId:'b',passes:1,bids:[bid(0,70),bid(2,95,false)]}]);
  expect(result[0].boxId).toBe('b');expect(result[0].robot).toBe(0);expect(result[0].launchNow).toBe(true);
  expect(result[1].robot).toBe(1);
 });
 it('maximizes joint immediate matching rather than greedily consuming the best robot',()=>{
  const result=rankAssignments([{boxId:'a',passes:0,bids:[bid(0,90),bid(1,89)]},{boxId:'b',passes:0,bids:[bid(0,88)]}]);
  expect(result.map(a=>[a.boxId,a.robot])).toEqual([['a',1],['b',0]]);
 });
 it('does not let downstream intentions reserve an immediately useful robot',()=>{
  const result=rankAssignments([{boxId:'a',passes:0,bids:[bid(0,60),bid(1,90,false)]},{boxId:'b',passes:0,bids:[bid(1,80)]}]);
  expect(result.map(a=>[a.boxId,a.robot,a.launchNow])).toEqual([['a',1,false],['b',1,true]]);
 });
 it('rejects a globally stale allocation, including changes on another pallet',()=>{
  const {s,w}=fixture(),observed=observedProblem(s,w),decision=planStream(observed.scenario,observed.world);
  expect(decision.orchestration?.evaluatedBids).toBeGreaterThan(0);
  const changed=structuredClone(w);changed.cells[3].version++;
  expect(applyDecision(s,changed,[],decision).motions).toHaveLength(0);
  expect(applyDecision(s,w,[],decision).motions.length).toBeGreaterThan(0);
 });
 it('changes an actual box destination when its current pallet is tall',()=>{
  const {s,w}=fixture();w.boxes.slice(1).forEach(b=>{b.status='pending';b.flow=undefined;});
  const first=planStream(s,w),boxId=w.boxes[0].observation.id;
  expect(first.orchestration!.assignments.find(a=>a.boxId===boxId)!.robot).toBe(0);
  const floor=structuredClone(first.proposals.find(p=>p.robot===0)!.candidates[0].placement);
  floor.id='existing-foundation';floor.position={x:0,y:0,z:0};floor.size={w:s.pallet.width,d:s.pallet.depth,h:1200};floor.weight=10;floor.maxLoadKg=1000;
  w.cells[0].placements=[floor];w.cells[0].version++;
  const changed=planStream(s,w),assignment=changed.orchestration!.assignments.find(a=>a.boxId===boxId)!;
  expect(assignment.robot).toBeGreaterThan(0);expect(assignment.launchNow).toBe(false);
  expect(applyDecision(s,w,[],changed).motions).toHaveLength(0);
 });
 it('rejects a pallet phase change without a version increment',()=>{
  const {s,w}=fixture(),decision=planStream(s,w);w.stream!.cells[2].phase='checking';
  expect(applyDecision(s,w,[],decision).motions).toHaveLength(0);
 });
 it('direct planning is invariant to hidden manifest mutations and reports actual interception path length',()=>{
  const {s,w}=fixture();w.boxes.slice(1).forEach(b=>{b.status='pending';b.flow=undefined;});
  const a=planStream(s,w),altered=structuredClone(w);altered.boxes.slice(1).forEach(b=>{b.observation.size={w:9999,d:9999,h:9999};b.observation.weight=999;});
  const b=planStream(s,altered);expect(a.orchestration).toEqual(b.orchestration);
  const motions=applyDecision(s,w,[],a).motions;expect(motions.length).toBeGreaterThan(0);
  for(const {action} of motions){
   const path=action.path!,length=path.points.slice(1).reduce((v,p,i)=>{const q=path.points[i].tcp;return v+Math.hypot(p.tcp.x-q.x,p.tcp.y-q.y,p.tcp.z-q.z);},0);
   expect(path.lengthMm).toBeCloseTo(length,6);
  }
 });
 it('honors explicit deferral at the execution boundary even if a producer includes valid candidates',()=>{
  const {s,w}=fixture(),decision=planStream(s,w);expect(decision.proposals.some(p=>p.candidates.length)).toBe(true);
  decision.proposals.forEach(p=>{p.disposition='defer';p.reason='explicit policy defer';});
  const result=applyDecision(s,w,[],decision);
  expect(result.motions).toHaveLength(0);
  expect(result.world.stream!.cells.every(c=>c.rejected.length===0)).toBe(true);
  expect(result.world.boxes.some(b=>b.flow?.lastReason==='explicit policy defer')).toBe(true);
 });
 it('retains pair-specific no-candidate evidence alongside a downstream intention',()=>{
  const {s,w}=fixture();w.boxes.slice(1).forEach(b=>{b.status='pending';b.flow=undefined;});
  const initial=planStream(s,w),floor=structuredClone(initial.proposals[0].candidates[0].placement);
  floor.id='full-pallet';floor.position={x:0,y:0,z:0};floor.size={w:s.pallet.width,d:s.pallet.depth,h:s.pallet.maxHeight};floor.weight=10;floor.maxLoadKg=1000;
  w.cells[0].placements=[floor];w.cells[0].version++;
  const decision=planStream(s,w);expect(decision.orchestration!.assignments[0].launchNow).toBe(false);
  expect(decision.proposals.some(p=>p.robot===0&&p.disposition==='no-candidate')).toBe(true);
  const result=applyDecision(s,w,[],decision);expect(result.world.stream!.cells[0].rejected).toContain(w.boxes[0].observation.id);
  expect(result.world.boxes[0].flow!.checks[0]).toBeDefined();expect(result.motions).toHaveLength(0);
 });
 it('records no-candidate pair checks before a different pair reserves that box',()=>{
  const {s,w}=fixture(),decision=planStream(s,w),offer=decision.proposals.find(p=>p.candidates.length)!;
  decision.proposals=[offer,{...offer,robot:(offer.robot+1)%4,candidates:[],disposition:'no-candidate',reason:'no candidate at another cell'}];
  const result=applyDecision(s,w,[],decision),box=result.world.boxes.find(b=>b.observation.id===offer.boxId)!;
  expect(box.status).toBe('reserved');expect(box.flow!.checks[(offer.robot+1)%4].reason).toBe('no candidate at another cell');
 });
 it('tries the scored second candidate when the first fails launch-time validation',()=>{
  const {s,w}=fixture(),decision=planStream(s,w),offer=decision.proposals.find(p=>p.candidates.length>=2)!;
  expect(offer).toBeDefined();decision.proposals=[offer];const expected=offer.candidates[1].id;offer.candidates[0].placement.position.x=99999;
  const result=applyDecision(s,w,[],decision);expect(result.motions).toHaveLength(1);expect(result.motions[0].action.candidate!.id).toBe(expected);
  expect(result.world.stream!.cells[offer.robot].rejected).toHaveLength(0);
 });
 it('does not exhaust a pallet on launch failures and permits retry within the same pick window',()=>{
  const {s,w}=fixture(),decision=planStream(s,w),offer=decision.proposals.find(p=>p.candidates.length)!;
  decision.proposals=[offer];offer.candidates.forEach(c=>{c.placement.position.x=99999;});
  const result=applyDecision(s,w,[],decision);expect(result.motions).toHaveLength(0);
  expect(result.world.stream!.cells[offer.robot].rejected).toHaveLength(0);
  const box=result.world.boxes.find(b=>b.observation.id===offer.boxId)!;expect(box.flow!.checks[offer.robot].retryAfter).toBe(.65);
  result.world.time+=1;const retry=planStream(s,result.world);expect(retry.proposals.some(p=>p.boxId===offer.boxId&&p.robot===offer.robot&&p.candidates.length)).toBe(true);
 });
 it('rejects assignments generated under a different objective',()=>{
  const {s,w}=fixture(),decision=planStream(s,w);expect(decision.orchestration!.objective).toBe('throughput');
  w.stream!.orchestrationObjective='balanced';expect(applyDecision(s,w,[],decision).motions).toHaveLength(0);
  expect(planStream(s,w).orchestration!.objective).toBe('balanced');
 });
 it('excludes busy robots and hidden input; independent mode remains available',()=>{
  const {s,w}=fixture();w.boxes[3].status='pending';w.boxes[3].flow=undefined;
  const observed=observedProblem(s,w),central=planStream(observed.scenario,observed.world,[0]);
  expect(central.orchestration?.assignments.flatMap(a=>a.bids).some(b=>b.robot===0)).toBe(false);
  expect(central.orchestration?.assignments.some(a=>a.boxId===w.boxes[3].observation.id)).toBe(false);
  const baseline=planStream(observed.scenario,observed.world,[],'independent');
  expect(baseline.orchestration?.mode).toBe('independent');
  w.stream!.orchestrationMode='independent';expect(applyDecision(s,w,[],baseline).motions.length).toBeGreaterThan(0);
  expect(applyDecision(s,w,[],central).motions).toHaveLength(0);
 });
});
