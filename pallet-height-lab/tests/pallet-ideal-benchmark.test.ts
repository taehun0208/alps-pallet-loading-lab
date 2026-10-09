import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scenario } from '../src/pallet/scenarios';
import { randomScenario,LEGACY_RANDOM } from '../src/pallet/random';
import { runScenario } from '../src/pallet/environment';
import { intersects } from '../src/pallet/geometry';
import { stability } from '../src/pallet/stability';
import { DEFAULT_SEARCH } from '../src/pallet/types';
import type { Scenario,SearchSettings } from '../src/pallet/types';
export const IDEAL_SEARCH:SearchSettings={...DEFAULT_SEARCH,topK:6,samples:4,depth:3,maxCandidates:128,virtualCandidates:24};
function cases(heldout:boolean){
 const fixed=['reference','identical','mixed','materials','large-late','impossible'].map(id=>{const s=scenario(id);s.constraints.robotMode='ideal';if(id==='large-late')s.types.forEach(t=>t.quantity=Math.ceil(t.quantity/2));return s;});
 const seeds=heldout?[9001,9011,9029,9041,9067,9091]:[101,107,113];
 return [...(heldout?[]:fixed),...seeds.map(seed=>randomScenario({...LEGACY_RANDOM,seed,arrivalSeed:seed*17,typeCount:5,totalCount:30}))];
}
it('runs fixed, development and separate holdout inputs before UI integration',()=>{
 const stage=process.env.PALLET_ALGORITHM_STAGE||'final',heldout=stage==='holdout',settings={...IDEAL_SEARCH,portfolio:stage==='portfolio-v3'||stage==='final'||stage==='holdout',weights:stage==='baseline'||stage==='candidate-v1'?{...IDEAL_SEARCH.weights,contact:0,futureSurface:0}:{...IDEAL_SEARCH.weights,contact:12,futureSurface:24},candidateMode:stage==='baseline'?'legacy' as const:'frontier' as const},results=[];
 for(const s of cases(heldout))for(const algorithm of ['bl','greedy','rollout'] as const){
  const r=runScenario(s,algorithm,settings),p=r.frame.placements;
  for(const b of p){expect(b.position.x).toBeGreaterThanOrEqual(0);expect(b.position.y).toBeGreaterThanOrEqual(0);expect(b.position.x+b.size.w).toBeLessThanOrEqual(s.pallet.width+1e-6);expect(b.position.y+b.size.d).toBeLessThanOrEqual(s.pallet.depth+1e-6);expect(b.position.z+b.size.h).toBeLessThanOrEqual(s.pallet.maxHeight+1e-6);expect(b.supportRatio).toBeGreaterThanOrEqual(s.constraints.supportRatio-1e-6);}
  for(let i=0;i<p.length;i++)for(let j=0;j<i;j++)expect(intersects(p[i],p[j])).toBe(false);
  expect(stability(p,s.constraints.stability).violations).toEqual([]);expect(r.metrics.loadUtilization).toBeLessThanOrEqual(1);expect(r.metrics.distanceM).toBe(0);expect(r.metrics.workSeconds).toBe(0);
  if(s.id==='reference'||s.id==='identical'||s.id==='materials')expect(r.metrics.complete).toBe(true);
  if(s.id==='impossible'){expect(r.metrics.count).toBe(1);expect(r.metrics.failedStep).toBe(2);}
  results.push({case:s.id,setSeed:s.id==='random'?Number(s.name.split(' · ')[1]):null,scenario:s,algorithm,metrics:r.metrics,placements:p});
  console.log(`${stage} ${s.id}/${s.arrival.seed} ${algorithm}: ${r.metrics.count}/${s.types.reduce((n,t)=>n+t.quantity,0)} height=${r.metrics.height}, median=${r.metrics.medianMs.toFixed(1)} ms`);
 }
 writeFileSync(`docs/pallet-ideal-${stage}.json`,JSON.stringify({stage,measuredAt:new Date().toISOString(),runtime:'Node / Vitest on this host',settings,results},null,2));
},240000);
