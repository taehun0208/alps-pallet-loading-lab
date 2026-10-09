import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,renameSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {cpus,platform,arch} from 'node:os';
import {Worker} from 'node:worker_threads';
import {BENCHMARK_ALGORITHMS,CONDITIONS,workload,uniqueOrders} from '../src/benchmark1000/workloads';
import {DEFAULT_CONFIG} from '../src/engine/config';
import {runTrial} from '../src/engine/core';
import {createPlannerSupervisor,type WorkerPort} from '../src/engine/supervisor';
import {evaluateTrial} from '../src/cluster/evaluation';
import {volume} from '../src/engine/vendor/pallet/geometry';
import type {PlannerEvent,TrialResult} from '../src/engine/types';

const root=process.cwd(),pilot=process.argv.includes('--pilot'),n=pilot?3:1000;
const out=resolve(root,'docs/benchmark-1000',pilot?'pilot-v1':'evaluation-v1');
mkdirSync(join(out,'trials'),{recursive:true});
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const atomic=(path:string,v:unknown)=>{writeFileSync(path+'.tmp',JSON.stringify(v,null,2)+'\n');renameSync(path+'.tmp',path);};
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(join(dir,f.name)):[join(dir,f.name)]).sort();
const paths=[...walk(join(root,'src/engine')),...walk(join(root,'src/metrics')),...walk(join(root,'src/benchmark1000')),join(root,'src/cluster/evaluation.ts'),join(root,'scripts/benchmark-1000.ts'),join(root,'scripts/benchmark-1000.mjs'),join(root,'scripts/benchmark-worker.mjs')];
const source=paths.map(p=>({path:relative(root,p),sha256:sha(readFileSync(p))}));
const manifests=CONDITIONS.map((c,i)=>({condition:c,scenario:workload(c),...uniqueOrders(workload(c),n,(pilot?910000000:460000000)+i*100000)}));
const config={...DEFAULT_CONFIG,quantityPerSku:5};
const signature=sha(JSON.stringify({source,manifests,config,algorithms:BENCHMARK_ALGORITHMS}));
const freezePath=join(out,'freeze.json');
if(existsSync(freezePath)){
 const f=JSON.parse(readFileSync(freezePath,'utf8'));if(f.signature!==signature)throw Error('Source/protocol changed: use a new versioned output directory.');
}else atomic(freezePath,{schema:'alps-paired-1000/1',signature,source,manifests,config,algorithms:BENCHMARK_ALGORITHMS,n,pilot,
 createdAt:new Date().toISOString(),environment:{node:process.version,cpu:cpus()[0]?.model,platform:platform(),arch:arch()},
 protocol:{primary:'placed volume / supplied volume',primaryPolicy:'floor-dense',baselineFamily:BENCHMARK_ALGORITHMS.filter(a=>a!=='floor-dense'),
  familySize:CONDITIONS.length*(BENCHMARK_ALGORITHMS.length-1),practicalThreshold:0.02,
  ranking:'No winner is fitted or tuned on evaluation. Report paired effects per condition and Pareto tradeoffs; describe as best among tested conditions only.',
  failures:'Retain every attempted trial, deadline miss and rejected cargo; no success-only filtering for primary outcome.',
  time:'Sequential worker-thread trials, identical 9000ms search window and 10000ms full cycle. Native candidate/iteration caps differ and are disclosed.',
  timing:'Pooled raw decision times; first startup decision included, worker loading excluded by canonical supervisor. Shared machine, not isolated CPU or real robot latency.',
  sampling:'Fixed synthetic inventory; unique arrival seeds AND unique SKU sequences within condition. Differences concern arrival orders, not 1000 different geometries.',
  conditions:'Three 30-box SKU mixes and one predeclared 60-box pressure condition, all at 1200mm. SKU mix also changes supplied volume; compare supply acceptance within condition.',
  statistics:'Paired seed differences, ordinary 95% t intervals plus Bonferroni simultaneous intervals for the 28 primary comparisons; no universal optimum claim.'}});

function factory():WorkerPort{
 const w=new Worker(new URL('./benchmark-worker.mjs',import.meta.url));
 const p:WorkerPort={onmessage:null,onerror:null,postMessage:m=>w.postMessage(m),terminate:()=>{void w.terminate();}};
 w.on('message',(data:PlannerEvent)=>p.onmessage?.({data}));w.on('error',e=>p.onerror?.({message:e.message}));return p;
}
const supervisor=createPlannerSupervisor(factory),rows:Record<string,any>[]=[];
const started=Date.now();let interrupted=false;
const controller=new AbortController();
process.on('SIGTERM',()=>{interrupted=true;controller.abort();});process.on('SIGINT',()=>{interrupted=true;controller.abort();});
const total=manifests.length*n*BENCHMARK_ALGORITHMS.length;
function persist(complete=false){
 atomic(join(out,'progress.json'),{signature,complete,pilot,n,total,completed:rows.length,startedAt:new Date(started).toISOString(),updatedAt:new Date().toISOString(),sessionSeconds:(Date.now()-started)/1000,rows});
}
async function main(){
 for(const algorithm of BENCHMARK_ALGORITHMS){
  const warm=await runTrial({...config,quantityPerSku:1},algorithm,990000000,{planDecision:supervisor.planDecision,signal:controller.signal});
  if(warm.status!=='finished'||warm.violations.length)throw Error(`Warmup failed: ${algorithm}`);
 }
 // Interleave workload and rotate algorithm order to limit fixed-order thermal/cache bias.
 outer:for(let i=0;i<n;i++)for(const [ci,m] of manifests.entries()){
  const order=m.orders[i],offset=(i+ci)%BENCHMARK_ALGORITHMS.length;
  const algorithms=[...BENCHMARK_ALGORITHMS.slice(offset),...BENCHMARK_ALGORITHMS.slice(0,offset)];
  let fingerprint:string|undefined;
  for(const algorithm of algorithms){
   if(interrupted)break outer;
   const name=`${m.condition.id}-${order.seed}-${algorithm}.json.gz`,path=join(out,'trials',name);let trial:TrialResult,wallMs:number;
   if(existsSync(path)){
    const saved=JSON.parse(gunzipSync(readFileSync(path)).toString());if(saved.signature!==signature)throw Error('Trace signature mismatch');trial=saved.trial;wallMs=saved.wallMs;
   }else{
    const t=performance.now();trial=await runTrial(config,algorithm,order.seed,{scenario:m.scenario,planDecision:supervisor.planDecision,signal:controller.signal});wallMs=performance.now()-t;
    if(trial.status==='cancelled')break outer;
    const bytes=gzipSync(JSON.stringify({signature,condition:m.condition.id,wallMs,trial}));writeFileSync(path+'.tmp',bytes);renameSync(path+'.tmp',path);
   }
   if(fingerprint&&fingerprint!==trial.inputFingerprint)throw Error('Paired input fingerprint mismatch');fingerprint=trial.inputFingerprint;
   if(JSON.stringify(trial.arrivals.map(o=>o.typeId))!==JSON.stringify(order.sequence))throw Error('Frozen arrival sequence mismatch');
   if(trial.algorithm!==algorithm||trial.seed!==order.seed)throw Error('Trace identity mismatch');
   const supplied=trial.arrivals.reduce((v,b)=>v+volume(b.size),0),e=evaluateTrial(trial);
   rows.push({...e,condition:m.condition.id,status:trial.status,violations:trial.violations.length,unprocessed:trial.unprocessed.length,
    supplyAcceptance:supplied?trial.metrics.volumeMm3/supplied:0,supplyBound:Math.min(1,supplied/(m.scenario.pallet.width*m.scenario.pallet.depth*config.maxHeightMm)),
    suppliedVolumeMm3:supplied,placedVolumeMm3:trial.metrics.volumeMm3,inputFingerprint:trial.inputFingerprint,
    computeMs:trial.metrics.computeMs,fallbackCount:trial.metrics.fallbackCount,wallMs,trace:`trials/${name}`,traceSha256:sha(readFileSync(path))});
   persist();if(rows.length%8===0)process.stdout.write(JSON.stringify({completed:rows.length,total,condition:m.condition.id,elapsedSeconds:Math.round((Date.now()-started)/1000)})+'\n');
  }
 }
 for(const f of source)if(sha(readFileSync(join(root,f.path)))!==f.sha256)throw Error(`Source changed while running: ${f.path}`);
 persist(rows.length===total&&!interrupted);
 process.stdout.write(JSON.stringify({pilot,completed:rows.length,total,sessionSeconds:(Date.now()-started)/1000,interrupted})+'\n');
}
main().catch(e=>{process.stderr.write(String(e.stack??e)+'\n');process.exitCode=1;}).finally(()=>supervisor.dispose());
