import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {createStream,advanceStream,applyDecision} from '../src/pallet/relay/streamEngine';
import {observedProblem,planStream} from '../src/pallet/relay/streamPlanner';
import {top} from '../src/pallet/geometry';
import {inspectConstraints} from '../src/pallet/constraints';
import {receiveConstraints} from '../src/pallet/relay/motion';
import type {RelayMotion} from '../src/pallet/relay/types';
it('validates 96 diverse boxes through simultaneous infeed, stacking and independent pallet exchange',()=>{
 const s=streamInventory(42,96);let w=createStream(s),motions:RelayMotion[]=[],peak=0,exchangeOverlap=false,decisions=0,ms=0;
 for(let time=.1;time<1600;time+=1){
  ({world:w,motions}=advanceStream(s,w,motions,time));
  const observed=observedProblem(s,w),d=planStream(observed.scenario,observed.world,motions.map(m=>m.action.robot));
  ({world:w,motions}=applyDecision(s,w,motions,d));decisions++;ms+=d.milliseconds;peak=Math.max(peak,motions.length);
  if(motions.length&&w.stream!.cells.some(c=>c.phase==='outbound'||c.phase==='returning'))exchangeOverlap=true;
  if(w.stream!.complete)break;
 }
 const pallets=[...w.stream!.dispatched,...w.cells.map((c,robot)=>({...c,robot}))],heights=pallets.map(p=>Math.max(0,...p.placements.map(top)));
 const report={seed:42,input:96,placed:w.records.length,remaining:w.boxes.filter(b=>b.status!=='placed').map(b=>({id:b.observation.id,reason:b.flow?.lastReason})),elapsed:w.time,peak,exchangeOverlap,pallets:w.stream!.dispatched.length,heights,minSupport:Math.min(...pallets.flatMap(c=>c.placements.map(p=>p.supportRatio))),orientations:[...new Set(pallets.flatMap(c=>c.placements.map(p=>p.orientation)))],meanPlanningMs:ms/decisions};
 mkdirSync('work',{recursive:true});writeFileSync('work/continuous-validation.json',JSON.stringify(report,null,2));
 // Shorter return paths change overlap for random arrivals. The dedicated four-window
 // fixture in pallet-stream.test verifies that all four arms can launch together.
 expect(peak).toBeGreaterThanOrEqual(2);expect(peak).toBeLessThanOrEqual(4);
 expect(new Set(w.records.map(r=>r.robot)).size).toBe(4);
 expect(exchangeOverlap).toBe(true);expect(w.records.length).toBeGreaterThanOrEqual(90);expect(Math.max(...heights)).toBeLessThanOrEqual(1600);
 for(const pallet of pallets){let stack:typeof pallet.placements=[];for(const p of pallet.placements){const observation=w.boxes.find(b=>b.observation.id===p.id)!.observation;const check=inspectConstraints(p,observation,stack,s.pallet,{...receiveConstraints(s),robotMode:'ideal'});expect(check.reasons,`${p.id}: ${check.reasons}`).toEqual([]);stack=check.stack;}}
},120000);
