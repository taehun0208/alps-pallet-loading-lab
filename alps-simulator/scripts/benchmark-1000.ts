import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,renameSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {cpus,platform,arch} from 'node:os';
import {Worker} from 'node:worker_threads';
import {spawnSync} from 'node:child_process';
import {BENCHMARK_ALGORITHMS,CONDITIONS,workload,uniqueOrders} from '../src/benchmark1000/workloads';
import {DEFAULT_CONFIG} from '../src/engine/config';
import {runTrial} from '../src/engine/core';
import {createPlannerSupervisor,type WorkerPort} from '../src/engine/supervisor';
import {evaluateTrial} from '../src/cluster/evaluation';
import {volume} from '../src/engine/vendor/pallet/geometry';
import type {PlannerEvent,TrialResult} from '../src/engine/types';

const args=process.argv.slice(2);
const arg=(name:string,fallback:string)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing ${name}`);return args[i+1];};
const integer=(name:string,fallback:number,min:number,max:number)=>{const n=Number(arg(name,String(fallback)));if(!Number.isInteger(n)||n<min||n>max)throw Error(`Invalid ${name}`);return n;};
const root=process.cwd(),pilot=args.includes('--pilot'),n=integer('--orders',integer('--n',pilot?2:1000,1,1000),1,1000);
const concurrency=integer('--concurrency',1,1,32),batchSize=integer('--batch-size',25,1,1000);
const out=resolve(root,arg('--out',`docs/benchmark-1000/${pilot?'pilot-v2':'evaluation-v2'}`));
const ciArg=arg('--condition','all'),start=integer('--start',0,0,n-1),end=integer('--end',n,1,n);
if(end<=start)throw Error('Empty seed range');
if(ciArg!=='all'&&!CONDITIONS.some(c=>c.id===ciArg))throw Error('Unknown condition');
const shard=ciArg==='all'&&start===0&&end===n?'serial':`${ciArg}-${String(start).padStart(4,'0')}-${String(end).padStart(4,'0')}`;
const shardOut=shard==='serial'?out:join(out,'shards',shard);
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const atomic=(path:string,v:unknown)=>{mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(v,null,2)+'\n');renameSync(path+'.tmp',path);};
const binaryAtomic=(path:string,bytes:Buffer)=>{mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path+'.tmp',bytes);renameSync(path+'.tmp',path);};
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(join(dir,f.name)):[join(dir,f.name)]).sort();
const paths=[...walk(join(root,'src/engine')),...walk(join(root,'src/metrics')),...walk(join(root,'src/benchmark1000')),join(root,'src/cluster/evaluation.ts'),join(root,'scripts/benchmark-1000-audit.py'),join(root,'docs/benchmark-1000/STATISTICS.md'),join(root,'docs/benchmark-1000/PROTOCOL.md'),join(root,'docs/benchmark-1000/score-plan.json'),...['benchmark-1000.ts','benchmark-1000.mjs','benchmark-worker.ts','benchmark-worker.mjs','benchmark-1000-pool.py'].map(p=>join(root,'scripts',p))];
const source=paths.map(p=>({path:relative(root,p),sha256:sha(readFileSync(p))}));
const manifests=CONDITIONS.map((c,i)=>({condition:c,scenario:workload(c),...uniqueOrders(workload(c),n,(pilot?910000000:460000000)+i*100000)}));
const config={...DEFAULT_CONFIG,quantityPerSku:5};
const execution={mode:concurrency>1?'parallel-shared-machine':'serial',concurrency,batchSize};
const signature=sha(JSON.stringify({source,manifests,config,algorithms:BENCHMARK_ALGORITHMS,execution}));
const freezePath=join(out,'freeze.json');
if(existsSync(freezePath)){
 const f=JSON.parse(readFileSync(freezePath,'utf8'));if(f.signature!==signature)throw Error('Source/protocol/execution changed: use a new versioned output directory.');
}else{
 if(!args.includes('--prepare'))throw Error('Prepare canonical freeze before launching shards: use --prepare.');
 mkdirSync(out,{recursive:true});
 for(const p of paths){const target=join(out,'source-snapshot',relative(root,p));mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,readFileSync(p));}
 atomic(freezePath,{schema:'alps-paired-1000/2',signature,source,manifests,config,algorithms:BENCHMARK_ALGORITHMS,n,pilot,execution,
  createdAt:new Date().toISOString(),sourceGitCommit:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout?.trim()||null,environment:{node:process.version,cpu:cpus()[0]?.model,platform:platform(),arch:arch()},
  protocol:{primary:'placed volume / supplied volume',primaryPolicy:'floor-dense',baselineFamily:BENCHMARK_ALGORITHMS.filter(a=>a!=='floor-dense'),
   familySize:CONDITIONS.length*(BENCHMARK_ALGORITHMS.length-1),practicalThreshold:0.02,
   ranking:'No winner is fitted or tuned on evaluation. Report paired effects per condition and Pareto tradeoffs; describe as best among tested conditions only.',
   failures:'Retain status=error, deadline misses and rejected cargo. Cancelled/incomplete attempts are preserved separately and may be resumed; no success-only primary filtering.',
   time:'Canonical worker-thread supervisor per Node process; identical 9000ms search window and 10000ms full cycle. Native candidate/iteration caps differ and are disclosed.',
   timing:concurrency>1?'Parallel shared-machine throughput and observed wall-deadline behavior under contention. Not isolated latency. Compare latency with separately saved serial pilot.':'Sequential shared-machine serial reference. Pooled raw decision times; first startup decision included, worker loading excluded by canonical supervisor.',
   scheduling:'Condition by seed-index batch. Algorithms interleaved and rotated within each seed; no adaptive allocation from observed quality. Concurrency and batch size frozen.',
   sampling:'Fixed synthetic inventory; unique arrival seeds AND unique SKU sequences within condition. Differences concern arrival orders, not 1000 different geometries.',
   conditions:'Two fixed 30-box SKU mixes (6 and 8 SKU), both at 1200mm. SKU mix changes supplied volume; compare supply acceptance within condition.',
   statistics:`Paired seed differences, ordinary 95% t intervals plus Bonferroni simultaneous intervals for the ${CONDITIONS.length*(BENCHMARK_ALGORITHMS.length-1)} primary comparisons; no universal optimum claim.`}});
}
for(const f of source){const saved=join(out,'source-snapshot',f.path);if(!existsSync(saved)||sha(readFileSync(saved))!==f.sha256)throw Error(`Frozen source missing or altered: ${f.path}`);}
if(args.includes('--prepare')){process.stdout.write(JSON.stringify({prepared:true,signature,n,total:manifests.length*n*BENCHMARK_ALGORITHMS.length,out,execution})+'\n');process.exit(0);}
mkdirSync(join(shardOut,'trials'),{recursive:true});
function factory():WorkerPort{
 const w=new Worker(new URL('./benchmark-worker.mjs',import.meta.url));
 const p:WorkerPort={onmessage:null,onerror:null,postMessage:m=>w.postMessage(m),terminate:()=>{void w.terminate();}};
 w.on('message',(data:PlannerEvent)=>p.onmessage?.({data}));w.on('error',e=>p.onerror?.({message:e.message}));return p;
}
const supervisor=createPlannerSupervisor(factory),rows:Record<string,any>[]=[];
const started=Date.now();let interrupted=false,cancelledAttempts=existsSync(join(shardOut,'attempts'))?readdirSync(join(shardOut,'attempts')).filter(p=>p.endsWith('.json.gz')).length:0;
const controller=new AbortController();
process.on('SIGTERM',()=>{interrupted=true;controller.abort();});process.on('SIGINT',()=>{interrupted=true;controller.abort();});
const selected=manifests.map((m,ci)=>({m,ci})).filter(({m})=>ciArg==='all'||m.condition.id===ciArg);
const total=selected.length*(end-start)*BENCHMARK_ALGORITHMS.length;
function persist(complete=false,error?:string){
 atomic(join(shardOut,'progress.json'),{signature,complete,pilot,n,shard,start,end,condition:ciArg,total,completed:rows.length,cancelledAttempts,startedAt:new Date(started).toISOString(),updatedAt:new Date().toISOString(),sessionSeconds:(Date.now()-started)/1000,interrupted,error,rows});
}
async function main(){
 const pending=selected.some(({m})=>m.orders.slice(start,end).some(order=>BENCHMARK_ALGORITHMS.some(a=>!existsSync(join(shardOut,'trials',`${m.condition.id}-${order.seed}-${a}.json.gz`)))));
 if(pending)for(const algorithm of BENCHMARK_ALGORITHMS){
  if(interrupted)break;
  const warm=await runTrial({...config,quantityPerSku:1},algorithm,990000000,{planDecision:supervisor.planDecision,signal:controller.signal});
  if(interrupted)break;
  if(warm.status!=='finished'||warm.violations.length){atomic(join(shardOut,`warmup-${algorithm}-error.json`),{signature,trial:warm});throw Error(`Warmup failed: ${algorithm}`);}
 }
 outer:for(let i=start;i<end;i++)for(const {m,ci} of selected){
  const order=m.orders[i],offset=(i+ci)%BENCHMARK_ALGORITHMS.length;
  const algorithms=[...BENCHMARK_ALGORITHMS.slice(offset),...BENCHMARK_ALGORITHMS.slice(0,offset)];
  let fingerprint:string|undefined;
  for(const algorithm of algorithms){
   if(interrupted)break outer;
   const name=`${m.condition.id}-${order.seed}-${algorithm}.json.gz`,path=join(shardOut,'trials',name);let trial:TrialResult,wallMs:number;
   if(existsSync(path)){
    const saved=JSON.parse(gunzipSync(readFileSync(path)).toString());if(saved.signature!==signature||saved.condition!==m.condition.id)throw Error('Trace signature/condition mismatch');trial=saved.trial;wallMs=saved.wallMs;
    if(trial.status==='cancelled')throw Error('Cancelled trial cannot be a completed trace');
   }else{
    const t=performance.now();trial=await runTrial(config,algorithm,order.seed,{scenario:m.scenario,planDecision:supervisor.planDecision,signal:controller.signal});wallMs=performance.now()-t;
    const bytes=gzipSync(JSON.stringify({signature,condition:m.condition.id,wallMs,trial}));
    if(trial.status==='cancelled'){binaryAtomic(join(shardOut,'attempts',`${name}.${Date.now()}.json.gz`),bytes);cancelledAttempts++;break outer;}
    binaryAtomic(path,bytes);
   }
   if(fingerprint&&fingerprint!==trial.inputFingerprint)throw Error('Paired input fingerprint mismatch');fingerprint=trial.inputFingerprint;
   if(JSON.stringify(trial.arrivals.map(o=>o.typeId))!==JSON.stringify(order.sequence))throw Error('Frozen arrival sequence mismatch');
   if(trial.algorithm!==algorithm||trial.seed!==order.seed)throw Error('Trace identity mismatch');
   const supplied=trial.arrivals.reduce((v,b)=>v+volume(b.size),0),e=evaluateTrial(trial);
   rows.push({...e,condition:m.condition.id,status:trial.status,violations:trial.violations.length,unprocessed:trial.unprocessed.length,
    supplyAcceptance:supplied?trial.metrics.volumeMm3/supplied:0,supplyBound:Math.min(1,supplied/(m.scenario.pallet.width*m.scenario.pallet.depth*config.maxHeightMm)),
    suppliedVolumeMm3:supplied,placedVolumeMm3:trial.metrics.volumeMm3,inputFingerprint:trial.inputFingerprint,
    computeMs:trial.metrics.computeMs,fallbackCount:trial.metrics.fallbackCount,wallMs,trace:relative(out,path),traceSha256:sha(readFileSync(path))});
   persist();if(rows.length%8===0)process.stdout.write(JSON.stringify({shard,completed:rows.length,total,condition:m.condition.id,elapsedSeconds:Math.round((Date.now()-started)/1000)})+'\n');
  }
 }
 for(const f of source)if(sha(readFileSync(join(root,f.path)))!==f.sha256)throw Error(`Source changed while running: ${f.path}`);
 persist(rows.length===total&&!interrupted);
 process.stdout.write(JSON.stringify({pilot,shard,completed:rows.length,total,sessionSeconds:(Date.now()-started)/1000,interrupted})+'\n');
}
main().catch(e=>{persist(false,String(e.stack??e));process.stderr.write(String(e.stack??e)+'\n');process.exitCode=1;}).finally(()=>supervisor.dispose());
