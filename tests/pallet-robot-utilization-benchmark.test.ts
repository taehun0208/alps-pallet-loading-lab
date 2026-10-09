import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createStream,advanceStream,applyDecision} from '../src/pallet/relay/streamEngine';
import {planStream,observedProblem} from '../src/pallet/relay/streamPlanner';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import type {RelayMotion} from '../src/pallet/relay/types';

it('diagnoses seeded per-robot utilization without requiring four simultaneous jobs from a serial feeder',()=>{
 const rows=[];
 const sourceHashes=Object.fromEntries(['orchestrator.ts','streamPlanner.ts','streamEngine.ts'].map(f=>[f,createHash('sha256').update(readFileSync(`src/pallet/relay/${f}`)).digest('hex')]));
 const counts=process.env.PALLET_UTILIZATION_COUNTS?.split(',').map(Number)??[20,48,50,96];
 for(const count of counts){
  const s=streamInventory(42,count);let w=createStream(s),motions:RelayMotion[]=[];const concurrentSeconds=[0,0,0,0,0],launches=[0,0,0,0],offered=[0,0,0,0],won=[0,0,0,0];
  const enteredTimes:number[]=[],reasons:Record<string,number>={};let priorEntered=0,planningMs=0,peak=0;
  for(let time=.1;time<1600;time+=1){
   ({world:w,motions}=advanceStream(s,w,motions,time));
   if(w.stream!.entered>priorEntered){enteredTimes.push(time);priorEntered=w.stream!.entered;}
   const o=observedProblem(s,w),d=planStream(o.scenario,o.world,motions.map(m=>m.action.robot));planningMs+=d.milliseconds;
   for(const a of d.orchestration?.assignments??[]){won[a.robot]++;for(const b of a.bids)offered[b.robot]++;}
   const prior=new Set(motions.map(m=>m.action.boxId));({world:w,motions}=applyDecision(s,w,motions,d));
   for(const m of motions)if(!prior.has(m.action.boxId))launches[m.action.robot]++;
   peak=Math.max(peak,motions.length);concurrentSeconds[motions.length]++;
   if(w.stream!.complete)break;
  }
  for(const b of w.boxes.filter(b=>b.status!=='placed')){const reason=b.flow?.lastReason??b.status;reasons[reason]=(reasons[reason]??0)+1;}
  const robots=Array.from({length:4},(_,robot)=>{
   const records=w.records.filter(r=>r.robot===robot),busySeconds=records.reduce((n,r)=>n+r.finished-r.started,0);
   return {robot:robot+1,placed:records.length,launches:launches[robot],busySeconds,busyFraction:busySeconds/w.time,firstStart:records[0]?.started??null,lastFinish:records.at(-1)?.finished??null,offerAppearances:offered[robot],assignmentWins:won[robot]};
  });
  const row={seed:42,count,placed:w.records.length,complete:w.stream!.complete,modeledSeconds:w.time,peakConcurrent:peak,concurrentSeconds,planningMs,robots,
   meanInfeedInterval:enteredTimes.length>1?(enteredTimes.at(-1)!-enteredTimes[0])/(enteredTimes.length-1):null,activeInfeedSeconds:enteredTimes.at(-1)??null,remainingReasons:reasons};
  rows.push(row);console.log(JSON.stringify(row));expect(new Set(w.records.map(r=>r.boxId)).size).toBe(w.records.length);
 }
 mkdirSync('docs/benchmarks',{recursive:true});writeFileSync(`docs/benchmarks/robot-utilization-${counts.join('-')}.json`,JSON.stringify({description:'Seed42 central mode, one repetition each, 1-second simulation steps, 1600-second cutoff. Busy seconds are modeled completed action durations; concurrency histogram is one-second sampled, not physical utilization. Counts do not require equal robot workload.',sourceHashes,rows},null,2));
},180000);
