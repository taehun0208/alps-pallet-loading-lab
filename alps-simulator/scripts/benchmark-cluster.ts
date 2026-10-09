import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {cpus,platform} from 'node:os';
import {Worker} from 'node:worker_threads';
import {ALGORITHMS,DEFAULT_CONFIG} from '../src/engine/config';
import {runTrial} from '../src/engine/core';
import {createPlannerSupervisor,type WorkerPort} from '../src/engine/supervisor';
import {evaluateTrial,SELECTION_RULE,type Evaluated} from '../src/cluster/evaluation';
import {estimate,pairedEstimate} from '../src/metrics/statistics';
import {CLUSTER_DEFINITIONS} from '../src/metrics/clustering';
import {planRedistribution} from '../src/redistribution';
import type {AlgorithmId,PlannerEvent} from '../src/engine/types';

const root=process.cwd(),out=resolve(root,'public/cluster');mkdirSync(join(out,'trials'),{recursive:true});
const save=(name:string,value:unknown)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(join(dir,f.name)):[join(dir,f.name)]).sort();
const paths=[...walk(resolve(root,'src/engine')),...walk(resolve(root,'src/metrics')),resolve(root,'src/cluster/evaluation.ts'),resolve(root,'scripts/benchmark-cluster.ts')];
const source=paths.map(p=>({path:relative(root,p),sha256:createHash('sha256').update(readFileSync(p)).digest('hex')}));
const provenance={createdAt:new Date().toISOString(),sourceSha256:createHash('sha256').update(JSON.stringify(source)).digest('hex'),source,
 environment:{node:process.version,cpu:cpus()[0].model,platform:platform()},execution:'Sequential Node worker_threads with canonical supervisor, observed current box and remaining counts only.',
 config:DEFAULT_CONFIG,rule:SELECTION_RULE};
if(existsSync(join(out,'freeze.json')))throw Error('Freeze already exists; preserve first outcomes and use a new versioned directory.');
save('freeze.json',provenance);
function factory():WorkerPort{const w=new Worker(new URL('./cluster-worker.mjs',import.meta.url));const port:WorkerPort={onmessage:null,onerror:null,postMessage:m=>w.postMessage(m),terminate:()=>{void w.terminate();}};w.on('message',(data:PlannerEvent)=>port.onmessage?.({data}));w.on('error',e=>port.onerror?.({message:e.message}));return port;}
const supervisor=createPlannerSupervisor(factory),rows:(Evaluated&{split:string;traceUrl:string;redistribution:ReturnType<typeof planRedistribution>['metrics']})[]=[];
const alpsIds:AlgorithmId[]=['floor-dense','cluster-floor','cluster-layer'];
let selected:{before:AlgorithmId;after:AlgorithmId;worst:AlgorithmId;fillGate:number}|null=null;
const metricKeys=['score','fill','floor','sameSkuContact','sameSkuVertical','sameDepartmentContact','componentShare','columnVoidLiters','cogOffsetMm','cogHeightMm','count','maxDecisionMs'] as const;
function summaries(split:string){return ALGORITHMS.map(a=>{const rr=rows.filter(r=>r.algorithm===a.id&&r.split===split);return {id:a.id,name:a.name,n:rr.length,eligible:rr.length===(split==='selection'?4:12)&&rr.every(r=>r.eligible),metrics:Object.fromEntries(metricKeys.map(k=>[k,estimate(rr.map(r=>r[k]).filter((v):v is number=>v!==null))]))};});}
function persist(complete:boolean){const comparisons=selected?metricKeys.map(metric=>({metric,...pairedEstimate(rows.filter(r=>r.split==='evaluation'&&r.algorithm===selected!.after&&r.eligible),rows.filter(r=>r.split==='evaluation'&&r.algorithm===selected!.before&&r.eligible),r=>r[metric]??0)})):[];
 save('index.json',{schema:'alps-cluster/1',complete,provenance,selected,selection:summaries('selection'),evaluation:summaries('evaluation'),paired:comparisons,rows,definitions:CLUSTER_DEFINITIONS,
  limits:['Synthetic one-pallet six-SKU workload; arrival seeds vary but dimensions, inventory and pallet are fixed.','No claim of globally most/least efficient algorithm. Negative control intentionally minimizes SKU clustering.','10-second cycle and redistribution seconds are model assumptions, not measured real-cell times.','Exploratory unadjusted 95% paired Student t intervals over arrival seeds; score weights are design priorities.','Mixed loading does not prove clustering improves redistribution: both are separately computed.'],reviewUrl:'/cluster/claude-review.txt'});
}
try{
 for(const a of ALGORITHMS){await runTrial({...DEFAULT_CONFIG,quantityPerSku:1},a.id,20999,{planDecision:supervisor.planDecision});}
 for(const split of ['selection','evaluation'] as const){
  const seeds=split==='selection'?SELECTION_RULE.selectionSeeds:SELECTION_RULE.evaluationSeeds;
  for(let i=0;i<seeds.length;i++){
   const order=[...ALGORITHMS.slice(i%ALGORITHMS.length),...ALGORITHMS.slice(0,i%ALGORITHMS.length)];
   let input:string|undefined;
   for(const a of order){const row=await runTrial(DEFAULT_CONFIG,a.id,seeds[i],{planDecision:supervisor.planDecision});
    if(input&&input!==row.inputFingerprint)throw Error('Input pairing failed');input=row.inputFingerprint;
    const file=`trials/${split}-${seeds[i]}-${a.id}.json`;save(file,row);
    const redistribution=planRedistribution(row.placements,{cycleSeconds:10,palletWidthMm:row.scenario.pallet.width,palletDepthMm:row.scenario.pallet.depth,unplacedCount:row.unplaced.length}).metrics;
    const e={...evaluateTrial(row),split,traceUrl:`/cluster/${file}`,redistribution};rows.push(e);persist(false);
    process.stdout.write(`${rows.length}/160 ${split} ${seeds[i]} ${a.id} fill ${(e.fill*100).toFixed(1)} floor ${(e.floor*100).toFixed(1)} cluster ${(e.sameSkuContact*100).toFixed(1)} score ${e.score.toFixed(2)} ${e.eligible?'PASS':'FAIL'}\n`);
   }
  }
  if(split==='selection'){
   const ranked=summaries('selection').filter(r=>r.eligible).sort((a,b)=>(b.metrics.score.mean??0)-(a.metrics.score.mean??0));
   const conventional=ranked.filter(r=>!alpsIds.includes(r.id)&&r.id!=='dispersed');
   const fillGate=Math.max(...conventional.map(r=>r.metrics.fill.mean??0))-.05;
   const after=ranked.find(r=>alpsIds.includes(r.id)&&(r.metrics.fill.mean??0)>=fillGate);
   if(!after||!conventional.length)throw Error('No ALPS candidate passed predeclared fill gate; do not force a winner.');
   selected={before:conventional[0].id,after:after.id,worst:ranked.at(-1)!.id,fillGate};save('selection.json',{selected,rule:SELECTION_RULE,summaries:ranked,selectedAt:new Date().toISOString()});persist(false);
   process.stdout.write(`FROZEN SELECTION ${JSON.stringify(selected)}\n`);
  }
 }
 persist(true);
 const fields=Object.keys(rows[0]).filter(k=>k!=='redistribution');writeFileSync(join(out,'trials.csv'),fields.join(',')+'\n'+rows.map(r=>fields.map(k=>JSON.stringify((r as Record<string,unknown>)[k])??'').join(',')).join('\n')+'\n');
}finally{supervisor.dispose();}
