import { it,expect } from 'vitest';
import { mkdirSync,writeFileSync } from 'node:fs';
import { defaultAlpsConfig,runAlpsTrial,shortlistAlps,summarizeAlps,pairedRoutingEffect,alpsCsv } from '../src/pallet/alps/experiment';
import type { AlpsTrial,Routing } from '../src/pallet/alps/experiment';
it('measures paired ALPS routing and preserves held-out seeds',()=>{
 const config=defaultAlpsConfig(),rows:AlpsTrial[]=[];config.settings.maxCandidates=16;
 for(let i=0;i<config.discovery+config.holdout;i++){
  const seed=config.seed+i,split=i<config.discovery?'discovery':'holdout';
  // Rotate run order so one algorithm is not always measured cold/first.
  const order=config.algorithms.map((_,j)=>config.algorithms[(i+j)%config.algorithms.length]);
  for(const algorithm of order)for(const route of ['pooled','dedicated','overflow'] as Routing[]){
   const r=runAlpsTrial(config,algorithm,route,seed,split);rows.push(r);
   console.log(`${split} ${seed} ${algorithm} ${route}: ${r.placed}/${r.normal} -> ${r.redistributed}; extra ${r.rehandles}; ${r.planMs.toFixed(0)}ms; ${r.status}`);
  }
  const cohort=rows.filter(r=>r.seed===seed);for(const r of cohort){expect(r.arrivals).toEqual(cohort[0].arrivals);expect(r.fingerprint).toBe(cohort[0].fingerprint);expect(r.violations).toEqual([]);}
 }
 const report={version:1,measuredAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,processor:process.env.PROCESSOR_IDENTIFIER??'unavailable'},config,rows:rows.map(r=>({...r,trace:r.seed===config.seed?r.trace:[]})),shortlist:shortlistAlps(rows),discovery:summarizeAlps(rows,'discovery'),holdout:summarizeAlps(rows,'holdout'),pairedHoldout:pairedRoutingEffect(rows,'dedicated','holdout')};
 mkdirSync('docs/alps-results',{recursive:true});writeFileSync('docs/alps-results/measured.json',JSON.stringify(report));writeFileSync('docs/alps-results/measured.csv',alpsCsv(rows));
 writeFileSync('public/alps-results.json',JSON.stringify(report));
 expect(rows).toHaveLength(60);expect(rows.every(r=>r.status==='finished')).toBe(true);
},600000);
