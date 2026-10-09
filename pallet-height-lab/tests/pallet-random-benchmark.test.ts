import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { randomScenario,LEGACY_RANDOM } from '../src/pallet/random';
import { ArrivalEnvironment,runScenario,replay } from '../src/pallet/environment';
import { DEFAULT_SEARCH } from '../src/pallet/types';
import { intersects } from '../src/pallet/geometry';
import { stability } from '../src/pallet/stability';
it('simulates random starting inventory and per-step arrivals under the three actual algorithms',()=>{
 const results=[];for(const [seed,arrivalSeed] of [[20261004,733],[20261005,734],[20261006,735]]){const s=randomScenario({...LEGACY_RANDOM,seed,arrivalSeed,totalCount:18,arrivalPattern:'random-draw'});let shared:string[]=[];for(const algorithm of ['bl','greedy','rollout'] as const){const r=runScenario(s,algorithm,DEFAULT_SEARCH),e=new ArrivalEnvironment(s),p=r.frame.placements,arrivals=r.frame.records.map(r=>r.observation.id);const common=Math.min(shared.length,arrivals.length);expect(arrivals.slice(0,common)).toEqual(shared.slice(0,common));if(arrivals.length>shared.length)shared=arrivals;
 for(let n=0;n<=r.frame.records.length;n++){const f=replay(r.frame.records,n);expect(Object.values(e.remaining(f)).reduce((a,b)=>a+b,0)+(e.current(f.processed)?1:0)+f.placements.length+f.excluded.length+f.missing.length).toBe(e.total);}
 for(let i=0;i<p.length;i++){const b=p[i];expect(b.position.x).toBeGreaterThanOrEqual(0);expect(b.position.y).toBeGreaterThanOrEqual(0);expect(b.position.x+b.size.w).toBeLessThanOrEqual(s.pallet.width);expect(b.position.y+b.size.d).toBeLessThanOrEqual(s.pallet.depth);expect(b.position.z+b.size.h).toBeLessThanOrEqual(s.pallet.maxHeight);expect(b.supportRatio).toBeGreaterThanOrEqual(.95);for(let j=0;j<i;j++)expect(intersects(b,p[j])).toBe(false);}expect(stability(p,s.constraints.stability).violations).toEqual([]);expect(r.metrics.loadUtilization).toBeLessThanOrEqual(1);expect(r.metrics.workSeconds).toBe(0);results.push({scenario:s,algorithm,settings:DEFAULT_SEARCH,metrics:r.metrics,placements:p,records:r.frame.records.map(({step,observation,disposition,remaining})=>({step,observation,disposition,remaining}))});console.log(`${seed}/${arrivalSeed} ${algorithm}: ${r.metrics.count}/18 height=${r.metrics.height}`);
 }}writeFileSync('docs/pallet-random-arrival-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),model:'random-draw: finite inventory, uniform individual-box sampling without replacement',results},null,2));
},180000);
