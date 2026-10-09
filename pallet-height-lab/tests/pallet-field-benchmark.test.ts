import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { randomScenario,DEFAULT_RANDOM } from '../src/pallet/random';
import { runScenario,ArrivalEnvironment,replay } from '../src/pallet/environment';
import { DEFAULT_SEARCH } from '../src/pallet/types';
import { intersects } from '../src/pallet/geometry';
import { stability } from '../src/pallet/stability';
it('runs varied per-item boxes and actual per-box material ratings before UI integration',()=>{
 const results=[];for(const [seed,arrivalSeed] of [[20261004,42],[7919,834],[15401,902]]){const s=randomScenario({...DEFAULT_RANDOM,seed,arrivalSeed,totalCount:seed===20261004?30:24});let common:string[]=[];for(const algorithm of ['bl','greedy','rollout'] as const){const r=runScenario(s,algorithm,DEFAULT_SEARCH),p=r.frame.placements,e=new ArrivalEnvironment(s),order=r.frame.records.map(r=>r.observation.id),n=Math.min(common.length,order.length);expect(order.slice(0,n)).toEqual(common.slice(0,n));if(order.length>common.length)common=order;
 for(let step=0;step<=r.frame.records.length;step++){const f=replay(r.frame.records,step);expect(Object.values(e.remaining(f)).reduce((a,b)=>a+b,0)+(e.current(f.processed)?1:0)+f.placements.length).toBe(e.total);}
 for(let i=0;i<p.length;i++){const b=p[i];expect(b.position.x).toBeGreaterThanOrEqual(0);expect(b.position.y).toBeGreaterThanOrEqual(0);expect(b.position.x+b.size.w).toBeLessThanOrEqual(s.pallet.width);expect(b.position.y+b.size.d).toBeLessThanOrEqual(s.pallet.depth);expect(b.position.z+b.size.h).toBeLessThanOrEqual(s.pallet.maxHeight);expect(b.supportRatio).toBeGreaterThanOrEqual(.95);expect(b.maxLoadSource).toBe('synthetic');for(let j=0;j<i;j++)expect(intersects(b,p[j])).toBe(false);}expect(stability(p,s.constraints.stability).violations).toEqual([]);expect(r.metrics.loadUtilization).toBeLessThanOrEqual(1);expect(r.metrics.workSeconds).toBe(0);results.push({scenario:s,algorithm,settings:DEFAULT_SEARCH,metrics:r.metrics,placements:p,records:r.frame.records.map(({step,observation,disposition,remaining})=>({step,observation,disposition,remaining}))});console.log(`field ${seed}/${arrivalSeed} ${algorithm}: ${r.metrics.count}/${e.total} height=${r.metrics.height}, median=${r.metrics.medianMs.toFixed(1)}ms`);
 }}writeFileSync('docs/pallet-field-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),model:'heterogeneous: per-item 1 mm dimensions, variable mass, synthetic per-box load/friction, finite random-draw',results},null,2));
},240000);
