import { it,expect } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { runRelay,assertRelayInventory } from '../src/pallet/relay/engine';
import { inspectConstraints } from '../src/pallet/constraints';
import { verifyPhysics } from '../src/pallet/physics';
import { DEFAULT_PHYSICS } from '../src/pallet/types';
it('runs heterogeneous stock through four cells without multiplying stock or relaxing packing constraints',async()=>{
 const previous=JSON.parse(readFileSync('docs/pallet-buffer-measurements.json','utf8')),results=[];
 for(const entry of previous.results.slice(0,2)){const s=entry.scenario,started=performance.now(),run=runRelay(s,'greedy',{seed:entry.seed,shuffle:true}),world=run.world,times=[performance.now()-started];expect(assertRelayInventory(world)).toBe(true);expect(run.peakConcurrent).toBeGreaterThan(1);
  for(const cell of world.cells){let placed:any[]=[];for(const p of cell.placements){const box=world.boxes.find(b=>b.observation.id===p.id)!;const check=inspectConstraints(p,box.observation,placed,s.pallet,{...s.constraints,robotMode:'ideal'});expect(check.reasons).toEqual([]);placed=check.stack;}}
  const physics=[];for(let i=0;i<world.cells.length;i++)physics.push(await verifyPhysics(world.cells[i].placements,s.pallet,DEFAULT_PHYSICS,`relay-${entry.seed}-${i}`));
  const result={peakConcurrent:run.peakConcurrent,elapsed:run.elapsed,seed:entry.seed,scenario:s,world,physics,milliseconds:times.reduce((a,b)=>a+b,0),placed:world.cells.reduce((n,c)=>n+c.placements.length,0),transfers:world.records.filter(r=>r.kind.startsWith('receive')).length};results.push(result);
  console.log(JSON.stringify({peakConcurrent:run.peakConcurrent,elapsed:run.elapsed,seed:entry.seed,initial:world.boxes.length,placed:result.placed,waiting:world.cells.reduce((n,c)=>n+c.queue.length,0),transfers:result.transfers,byRobot:world.cells.map(c=>c.placements.length),physics:physics.map(p=>p.status),ms:Math.round(result.milliseconds)}));
 }
 writeFileSync('docs/pallet-concurrent-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),results},null,2));
},300000);
