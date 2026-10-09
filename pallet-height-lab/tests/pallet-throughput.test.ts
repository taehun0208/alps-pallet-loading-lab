import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {createStream,advanceStream,applyDecision} from '../src/pallet/relay/streamEngine';
import {observedProblem,planStream} from '../src/pallet/relay/streamPlanner';
import {top} from '../src/pallet/geometry';
import type {RelayMotion} from '../src/pallet/relay/types';
it('records fixed-input throughput while preserving support, height and stock invariants',()=>{
 const reports=[];
 for(const seed of [42,7]){
  const s=streamInventory(seed,48);let world=createStream(s),motions:RelayMotion[]=[],cpu=0,calls=0,busy=0,peak=0;
  for(let t=.1;t<800;t+=1){
   ({world,motions}=advanceStream(s,world,motions,t));busy+=motions.length;
   const problem=observedProblem(s,world),decision=planStream(problem.scenario,problem.world,motions.map(m=>m.action.robot));cpu+=decision.milliseconds;calls++;
   ({world,motions}=applyDecision(s,world,motions,decision));peak=Math.max(peak,motions.length);
   if(world.stream!.complete)break;
  }
  const placements=[...world.cells.flatMap(c=>c.placements),...world.stream!.dispatched.flatMap(c=>c.placements)];
  for(const p of placements){expect(top(p)).toBeLessThanOrEqual(s.pallet.maxHeight);expect(p.supportRatio).toBeGreaterThanOrEqual(.92-1e-8);}
  const report={seed,placed:world.records.length,elapsed:world.time,firstPlace:world.records[0]?.finished,t24:world.records[23]?.finished??null,t40:world.records[39]?.finished??null,peak,robotUtilization:busy/(calls*4),planningMs:cpu,meanPlanningMs:cpu/calls,passes:world.stream!.passes,pallets:world.stream!.dispatched.length,maxHeight:Math.max(0,...placements.map(top))};reports.push(report);
  expect(world.records.length).toBeGreaterThan(30);
 }
 mkdirSync('work',{recursive:true});writeFileSync(`work/throughput-${process.env.FLOW_BENCH_ID||'current'}.json`,JSON.stringify(reports,null,2));
},120000);
