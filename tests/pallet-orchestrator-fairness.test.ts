import {it,expect} from 'vitest';
import {createStream,advanceStream,applyDecision,assertStreamInventory} from '../src/pallet/relay/streamEngine';
import {planStream,observedProblem} from '../src/pallet/relay/streamPlanner';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import type {OrchestrationObjective} from '../src/pallet/relay/orchestrator';
import type {RelayMotion} from '../src/pallet/relay/types';
import {writeFileSync,mkdirSync} from 'node:fs';
it('serves every reachable cell on a short batch without unbounded balancing delays',()=>{
 const reports=[];
 for(const count of [20,24])for(const objective of ['throughput','balanced'] as OrchestrationObjective[]){
  const s=streamInventory(42,count);let w=createStream(s),motions:RelayMotion[]=[];w.stream!.orchestrationObjective=objective;const bidCounts=[0,0,0,0],wins=[0,0,0,0];
  for(let time=.1;time<1000;time+=.5){
   ({world:w,motions}=advanceStream(s,w,motions,time));const o=observedProblem(s,w),d=planStream(o.scenario,o.world,motions.map(m=>m.action.robot));
   for(const a of d.orchestration?.assignments??[]){wins[a.robot]++;for(const b of a.bids)bidCounts[b.robot]++;}
   ({world:w,motions}=applyDecision(s,w,motions,d));assertStreamInventory(w,motions);if(w.stream!.complete)break;
  }
  reports.push({count,objective,pallets:w.stream!.dispatched.length+w.cells.filter(c=>c.placements.length).length,placed:w.records.length,time:w.time,byRobot:Array.from({length:4},(_,r)=>({robot:r+1,count:w.records.filter(x=>x.robot===r).length,work:w.records.filter(x=>x.robot===r).reduce((n,x)=>n+x.finished-x.started,0)})),bidCounts,wins});
  expect(w.records.length).toBe(count);if(objective==='balanced')expect(new Set(w.records.map(r=>r.robot)).size).toBe(4);expect(w.time).toBeLessThan(250);
 }
 mkdirSync('docs/benchmarks',{recursive:true});writeFileSync('docs/benchmarks/orchestration-objectives.json',JSON.stringify({description:'Seed42 synthetic stream; .5 simulated second step; modeled completion including final pallet exchange; one run per objective/count; no claim of physical timing or universal balance.',reports},null,2));
},120000);
