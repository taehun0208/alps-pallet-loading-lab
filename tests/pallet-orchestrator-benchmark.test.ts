import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createStream,advanceStream,applyDecision,assertStreamInventory} from '../src/pallet/relay/streamEngine';
import {planStream,observedProblem} from '../src/pallet/relay/streamPlanner';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import type {RelayMotion} from '../src/pallet/relay/types';
import type {OrchestrationMode} from '../src/pallet/relay/orchestrator';
it('records matched central/baseline simulations without asserting unmeasured superiority',()=>{
 const rows=[];
 for(const seed of [42,821])for(const mode of ['independent','central'] as OrchestrationMode[]){
  const s=streamInventory(seed,24);let w=createStream(s),motions:RelayMotion[]=[];w.stream!.orchestrationMode=mode;
  const times:number[]=[],activeTimes:number[]=[];let deferred=0,peak=0;
  for(let time=.1;time<1200;time+=1){
   ({world:w,motions}=advanceStream(s,w,motions,time));
   const o=observedProblem(s,w),d=planStream(o.scenario,o.world,motions.map(m=>m.action.robot));
   times.push(d.milliseconds);if(d.checks)activeTimes.push(d.milliseconds);
   deferred+=d.orchestration?.assignments.filter(a=>!a.launchNow).length??0;
   ({world:w,motions}=applyDecision(s,w,motions,d));peak=Math.max(peak,motions.length);
   assertStreamInventory(w,motions);if(w.stream!.complete)break;
  }
  const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(xs.length*p)-1)]??null;
  rows.push({seed,mode,input:24,placed:w.records.length,complete:w.stream!.complete,simulatedSeconds:w.time,pallets:w.stream!.dispatched.length+w.cells.filter(c=>c.placements.length).length,peakConcurrent:peak,planningCalls:times.length,activeCalls:activeTimes.length,totalPlanningMs:times.reduce((a,b)=>a+b,0),p95Ms:percentile(times,.95),p99Ms:percentile(times,.99),activeP95Ms:percentile(activeTimes,.95),softDeferralDecisions:deferred});
  expect(w.records.length).toBeGreaterThan(0);expect(new Set(w.records.map(r=>r.boxId)).size).toBe(w.records.length);
 }
 mkdirSync('docs/benchmarks',{recursive:true});writeFileSync('docs/benchmarks/orchestration-comparison.json',JSON.stringify({description:'Synthetic simulation, 1-second steps, 1200-second cutoff, no physical robot/MCU timings. Same seed/input/settings per pair; one repetition; cold per-run geometry keys; host wall-clock JS planning timings, not guaranteed deadlines.',node:process.version,platform:process.platform,arch:process.arch,rows},null,2));
},120000);
