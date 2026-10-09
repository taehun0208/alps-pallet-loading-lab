import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DEFAULT_CONFIG,DEFAULT_ORDERING,type Box,type Config} from '../src/pallet/adaptive/types';
import {makeBoxes,shape} from '../src/pallet/adaptive/shape';
import {Session,metrics} from '../src/pallet/adaptive/runtime';
import {assess} from '../src/pallet/adaptive/mechanics';
import {orderingJobs} from '../src/pallet/adaptive/orderingExperiments';
import {buildGraph,verifyCoverage,compatible} from '../src/pallet/adaptive/dependency';
it('measures matched-input ablations over three seeds and two input families',()=>{
 const rows:any[]=[];
 for(const family of ['heterogeneous','equivalent'])for(const seed of [41,42,43]){
  const base:Config={...structuredClone(DEFAULT_CONFIG),seed,count:12,pallet:{width:800,depth:700,maxHeight:1000},bufferSize:4,maxCandidates:24,timeBudgetMs:30000};
  let boxes=makeBoxes(base);if(family==='equivalent'){const prototypes=boxes.slice(0,2).map((b,i)=>{const nominal={w:i?180:260,d:i?180:230,h:i?130:160};return{...b,nominal,parts:shape(nominal,'normal',0),com:{x:nominal.w/2,y:nominal.d/2,z:nominal.h/2},mass:2,damage:'normal',shapeDamage:[],masks:[],strength:{topLoadKg:100,residual:1,source:'assumption',note:'benchmark'}} as Box;});boxes=boxes.map((b,i)=>({...structuredClone(prototypes[(i+seed)%2]),id:b.id,arrival:i}));}
  const inputHash=createHash('sha256').update(JSON.stringify(boxes)).digest('hex');
  const jobs=[...orderingJobs(base),...[0,.06,.25].map(dependencyWeight=>({label:'전체 λ='+dependencyWeight,config:{...structuredClone(base),ordering:{...DEFAULT_ORDERING,enabled:true,dependencyWeight}}}))];
  // Deterministic alternating execution order reduces systematic JIT warm-up bias.
  for(const job of seed%2?jobs:[...jobs].reverse()){
   const s=new Session(job.config,boxes),f=s.run(p=>expect(assess(p.placed,job.config).reasons).toEqual([])),m=metrics(f,boxes,job.config);
   expect(f.done).toBe(true);expect(m.finalViolations).toEqual([]);expect(m.search.capped).toBe(0);expect(m.bufferPeak).toBeLessThan(job.config.bufferSize);
   rows.push({family,label:job.label,inputHash,config:job.config,metrics:m,placements:f.placed.map(p=>({id:p.box.id,position:p.position,rotation:p.rotation})),rejected:f.rejected});
  }
 }
 for(const family of ['heterogeneous','equivalent'])for(const seed of [41,42,43])expect(new Set(rows.filter(r=>r.family===family&&r.config.seed===seed).map(r=>r.inputHash)).size).toBe(1);
 mkdirSync('docs/ordering-results',{recursive:true});writeFileSync('docs/ordering-results/ablations.json',JSON.stringify({measuredAt:new Date().toISOString(),runtime:process.version,platform:process.platform,rows},null,2));
 const keys=['placed','completion','heightMm','unplaced','unplacedNominalVolumeMm3','utilization','planningMs','replans','bufferPeak','additionalHandlingEstimate'] as const;
 writeFileSync('docs/ordering-results/ablations.csv','family,label,seed,inputHash,'+keys.join(',')+',candidates,spaceUpdates,priorHits,equivalentSkipped,violations\n'+rows.map(r=>[r.family,r.label,r.config.seed,r.inputHash,...keys.map(k=>r.metrics[k]),r.metrics.search.checked,r.metrics.search.spaceUpdates,r.metrics.search.priorHits,r.metrics.search.equivalentSkipped,r.metrics.finalViolations.length].join(',')).join('\n'));
},300000);
it('finds counterexample orders and adds bounded fixed plans without claiming QOP coverage',()=>{
 const c:Config={...structuredClone(DEFAULT_CONFIG),count:4,bufferSize:1,pallet:{width:420,depth:220,maxHeight:500},maxCandidates:24,timeBudgetMs:30000,damageKinds:['normal'],ordering:{...DEFAULT_ORDERING,enabled:true}},boxes=makeBoxes(c).map(b=>{const nominal={w:200,d:200,h:100};return {...b,nominal,parts:shape(nominal,'normal',0),mass:2,com:{x:100,y:100,z:50},masks:[],shapeDamage:[],strength:{topLoadKg:100,residual:1,source:'assumption',note:'coverage fixture'}} as Box;}),ids=boxes.map(b=>b.id),graphs:ReturnType<typeof buildGraph>['graph'][]=[],runs:any[]=[];let order=ids;
 for(let i=0;i<8;i++){const input=order.map(id=>boxes.find(b=>b.id===id)!),s=new Session(c,input),f=s.run(),m=metrics(f,input,c);if(f.placed.length===boxes.length)graphs.push(buildGraph(f.placed,c,64).graph);const check=verifyCoverage(ids,graphs,1000,1000);if(check.order)expect(graphs.every(g=>!compatible(g,check.order!))).toBe(true);runs.push({order,metrics:m,check});if(check.status!=='counterexample'||!m.fullSuccess)break;order=check.order!;}
 mkdirSync('docs/ordering-results',{recursive:true});writeFileSync('docs/ordering-results/coverage.json',JSON.stringify({scope:'NDOP graph approximation only; no QOP or physical all-order certificate',plans:graphs,runs},null,2));expect(runs.length).toBeGreaterThan(1);expect(graphs.length).toBeGreaterThan(1);
},60000);
