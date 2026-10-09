import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DEFAULT_CONFIG,type Config,type Mode} from '../src/pallet/adaptive/types';
import {makeBoxes} from '../src/pallet/adaptive/shape';
import {Session,metrics} from '../src/pallet/adaptive/runtime';
it('measures matched-input ablations and noisy A/B/C runs without crediting unsafe placements',()=>{
 const base:Config={...structuredClone(DEFAULT_CONFIG),count:12,pallet:{width:1000,depth:1000,maxHeight:1400},maxCandidates:24,timeBudgetMs:30000},rows:any[]=[];
 const jobs:Array<{label:string;config:Config}>=[];
 for(const feature of ['full','load','suction','path','buffer','replan','alignment'] as const){const c=structuredClone(base);if(feature!=='full')c.features[feature]=feature==='alignment';jobs.push({label:'ablation-'+feature,config:c});}
 for(const seed of [41,42,43])for(const mode of ['A','B','C'] as Mode[]){const c=structuredClone(base);Object.assign(c,{seed,mode,count:8});c.noise={dimensionMm:.5,positionMm:.25,surfaceMm:.5,yawDeg:.05};jobs.push({label:'observation-noise',config:c});}
 for(const job of jobs){const boxes=makeBoxes(job.config),inputHash=createHash('sha256').update(JSON.stringify(boxes)).digest('hex'),f=new Session(job.config,boxes).run(),m=metrics(f,boxes,job.config);
  expect(m.finalViolations).toEqual([]);expect(f.done).toBe(true);expect(f.placed.length+f.rejected.length).toBe(boxes.length);
  rows.push({label:job.label,inputHash,config:job.config,metrics:m,events:f.events,placements:f.placed.map(p=>({id:p.box.id,position:p.position,rotation:p.rotation})),rejected:f.rejected});
 }
 expect(new Set(rows.filter(r=>r.label.startsWith('ablation')).map(r=>r.inputHash)).size).toBe(1);
 for(const seed of [41,42,43])expect(new Set(rows.filter(r=>r.label==='observation-noise'&&r.config.seed===seed).map(r=>r.inputHash)).size).toBe(1);
 mkdirSync('docs/adaptive-results',{recursive:true});writeFileSync('docs/adaptive-results/ablations.json',JSON.stringify(rows,null,2));
 const keys=['mode','seed','placed','unplaced','retries','planningMs','placementFail'] as const;
 writeFileSync('docs/adaptive-results/ablations.csv','case,'+keys.join(',')+'\n'+rows.map(r=>r.label+','+keys.map(k=>r.metrics[k]).join(',')).join('\n'));
},180000);
