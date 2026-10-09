import { it,expect } from 'vitest';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createStream,advanceStream,applyDecision,assertStreamInventory } from '../src/pallet/relay/streamEngine';
import { streamInventory,inventoryProfileInfo } from '../src/pallet/relay/streamInventory';
import type { InventoryProfile } from '../src/pallet/relay/streamInventory';
import { observedProblem,planStream } from '../src/pallet/relay/streamPlanner';
import { evaluateRelay,summarizeLatency } from '../src/pallet/relay/evaluation';
import type { RelayMotion } from '../src/pallet/relay/types';

it('records model-only workload and geometry outcomes for public-data-derived stress trials',()=>{
 const rows=[];
 const selected=process.env.PALLET_REALISTIC_CASES?.split(',').map(v=>{const [profile,count]=v.split(':');return {profile:profile as InventoryProfile,count:Number(count)};})??[
  {profile:'synthetic' as const,count:96},{profile:'bed-bpp-stress' as const,count:96},{profile:'bed-bpp-stress' as const,count:120},
 ];
 const budgetMs=Number(process.env.PALLET_REALISTIC_WALL_MS??35000),limitSeconds=2400;
 for(const {profile,count} of selected){
  const s=streamInventory(42,count,1600,profile),info=inventoryProfileInfo(42,profile,count,1600),begin=performance.now();
  let w=createStream(s),motions:RelayMotion[]=[],peak=0,failure:string|null=null;
  const allLatencies:{milliseconds:number}[]=[],activeLatencies:{milliseconds:number}[]=[];
  try{
   for(let time=.1;time<limitSeconds&&performance.now()-begin<budgetMs;time+=1){
    ({world:w,motions}=advanceStream(s,w,motions,time));
    const observed=observedProblem(s,w),decision=planStream(observed.scenario,observed.world,motions.map(m=>m.action.robot));
    allLatencies.push({milliseconds:decision.milliseconds});if(decision.checks)activeLatencies.push({milliseconds:decision.milliseconds});
    ({world:w,motions}=applyDecision(s,w,motions,decision));peak=Math.max(peak,motions.length);assertStreamInventory(w,motions);
    if(w.stream!.complete)break;
   }
  }catch(error){failure=String(error);}
  const evaluation=evaluateRelay(s,w),exitReasons=w.stream!.dispatched.reduce<Record<string,number>>((n,p)=>{const reason=p.dispatchReason??'unrecorded';n[reason]=(n[reason]??0)+1;return n;},{});
  const row={profile,input:info,placed:evaluation.completion.placed,complete:w.stream!.complete,failure,
   stoppedBy:w.stream!.complete?'complete':failure?'engine-error':performance.now()-begin>=budgetMs?'wall-budget':'simulation-cutoff',
   modeledSeconds:w.time,hostSeconds:(performance.now()-begin)/1000,peakConcurrent:peak,robotCounts:Array.from({length:4},(_,robot)=>w.records.filter(r=>r.robot===robot).length),
   capacity:evaluation.capacity,safety:evaluation.safety,exitReasons,
   pallets:evaluation.pallets.map(p=>({robot:p.robot+1,cycle:p.cycle,dispatched:p.dispatched,count:p.count,heightMm:p.heightMm,utilization:p.volumeMm3/(s.pallet.width*s.pallet.depth*s.pallet.maxHeight),center:p.center,minMarginMm:p.minMarginMm,minTippingG:p.minTippingG})),
   latencyAll:summarizeLatency(allLatencies),latencyActive:summarizeLatency(activeLatencies),
   remaining:w.boxes.filter(b=>b.status!=='placed').map(b=>({id:b.observation.id,status:b.status,reason:b.flow?.lastReason??'미입고'})),
  };
  rows.push(row);console.log(JSON.stringify({profile,count,placed:row.placed,complete:row.complete,stoppedBy:row.stoppedBy,failure,seconds:row.modeledSeconds,hostSeconds:row.hostSeconds,robots:row.robotCounts,fill:row.capacity.utilization,pallets:row.capacity.usedPallets,maxHeight:Math.max(...row.pallets.map(p=>p.heightMm)),minMargin:row.safety.minMarginMm,violations:row.safety.violations.length,exitReasons,activeP99:row.latencyActive.p99}));
  mkdirSync('docs/benchmarks',{recursive:true});writeFileSync('docs/benchmarks/realistic-trials.json',JSON.stringify({description:'Model-only single-seed trials, central default objective, 1-second simulation steps. Different workloads/pallets across profiles: not a matched algorithm superiority comparison. Public measured dimensions/masses do not verify assumed strength, uniform CoG, robot reach, or transport safety. p99 is host wall-clock synchronous planner time, excludes network/physical controller and reports sample count. Per-case wall cutoff is explicit.',node:process.version,platform:process.platform,arch:process.arch,seed:42,budgetMs,limitSeconds,rows},null,2));
  expect(failure).toBeNull();expect(new Set(w.records.map(r=>r.boxId)).size).toBe(w.records.length);
  for(const p of row.pallets)expect(p.heightMm).toBeLessThanOrEqual(s.pallet.maxHeight+1e-6);
 }
},120000);
