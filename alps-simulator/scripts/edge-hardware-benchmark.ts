/** Portable headless hardware pilot; preserves the evaluation-v2 engine/config. */
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {cpus,platform,arch,totalmem} from 'node:os';
import {Worker} from 'node:worker_threads';
import {runTrial} from '../src/engine/core';
import {createPlannerSupervisor,type WorkerPort} from '../src/engine/supervisor';
import {evaluateTrial} from '../src/cluster/evaluation';
import type {AlgorithmId,PlannerEvent,TrialResult} from '../src/engine/types';

const args=process.argv.slice(2);
function arg(name:string,fallback:string){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const root=process.cwd(),source=join(root,'docs/benchmark-1000/evaluation-v2');
const out=resolve(arg('--out','docs/edge-hardware/pilot-v1'));
const algorithm=arg('--algorithm','cluster-layer') as AlgorithmId;
const profile=arg('--profile','native');
const heap=Number(arg('--heap-mib','64'));
const indices=arg('--indices','0,24,49,74,99').split(',').map(Number);
if(!['capacity-compact','floor-dense','cluster-layer'].includes(algorithm)||!Number.isInteger(heap)||heap<16||indices.some(i=>!Number.isInteger(i)||i<0||i>=100))throw Error('Invalid hardware pilot arguments');
const freeze=JSON.parse(readFileSync(join(source,'freeze.json'),'utf8'));
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const frozenFiles=freeze.source.filter((f:{path:string})=>f.path.startsWith('src/engine/')||f.path.startsWith('src/metrics/')||f.path==='src/cluster/evaluation.ts'||f.path==='scripts/benchmark-worker.mjs');
for(const f of frozenFiles)if(sha(readFileSync(join(root,f.path)))!==f.sha256)throw Error(`Engine differs from audited source: ${f.path}`);
mkdirSync(join(out,'trials'),{recursive:true});
const atomic=(file:string,value:unknown)=>{writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(file+'.tmp',file);};
const resource=()=>{const r=process.resourceUsage();return {cpuMs:(r.userCPUTime+r.systemCPUTime)/1000,peakRssMiB:r.maxRSS/1024,rssMiB:process.memoryUsage().rss/1048576};};
const geometry=(t:TrialResult)=>sha(JSON.stringify(t.placements.map(b=>({id:b.id,typeId:b.typeId,position:b.position,size:b.size,orientation:b.orientation}))));
const bootMs:number[]=[],rows:Record<string,any>[]=[];
function factory():WorkerPort{
 const started=performance.now();
 const w=new Worker(new URL('./benchmark-worker.mjs',import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:heap}});
 const port:WorkerPort={onmessage:null,onerror:null,postMessage:m=>w.postMessage(m),terminate:()=>{void w.terminate();}};
 w.on('message',(data:PlannerEvent)=>{if(data.type==='ready')bootMs.push(performance.now()-started);port.onmessage?.({data});});
 w.on('error',e=>port.onerror?.({message:e.message}));return port;
}
const supervisor=createPlannerSupervisor(factory),start=performance.now();
const controller=new AbortController();
process.on('SIGTERM',()=>controller.abort());process.on('SIGINT',()=>controller.abort());
function persist(complete:boolean,error?:string){atomic(join(out,`${profile}-${algorithm}.json`),{
 schema:'alps-hardware-pilot/1',complete,error,profile,algorithm,indices,sourceSignature:freeze.signature,
 engineSourceCommit:freeze.sourceGitCommit,config:freeze.config,
 environment:{node:process.version,cpu:cpus()[0]?.model,platform:platform(),arch:arch(),hostMemoryMiB:totalmem()/1048576,heapCapMiBPerIsolate:heap,execArgv:process.execArgv},
 wallMs:performance.now()-start,resource:resource(),workerBootMs:bootMs,rows});}

async function main(){
 const warm=await runTrial({...freeze.config,quantityPerSku:1},algorithm,990000000,{planDecision:supervisor.planDecision,signal:controller.signal});
 if(warm.status!=='finished'||warm.violations.length)throw Error('Warmup failed');
 for(const index of indices)for(const manifest of freeze.manifests){
  if(controller.signal.aborted)throw Error('Cancelled');
  const seed=manifest.orders[index].seed,condition=manifest.condition.id;
  let maxSampledRssMiB=0;
  const before=resource(),t=performance.now();
  const trial=await runTrial(freeze.config,algorithm,seed,{scenario:manifest.scenario,planDecision:supervisor.planDecision,signal:controller.signal,onProgress:()=>{maxSampledRssMiB=Math.max(maxSampledRssMiB,process.memoryUsage().rss/1048576);}});
  const after=resource(),wallMs=performance.now()-t;
  if(JSON.stringify(trial.arrivals.map(b=>b.typeId))!==JSON.stringify(manifest.orders[index].sequence))throw Error('Frozen input sequence mismatch');
  const traceName=`${condition}-${seed}-${algorithm}.json.gz`;
  const oldPath=join(source,'shards',`${condition}-${String(Math.floor(index/25)*25).padStart(4,'0')}-${String(Math.min(100,Math.floor(index/25)*25+25)).padStart(4,'0')}`,'trials',traceName);
  const original:TrialResult=JSON.parse(gunzipSync(readFileSync(oldPath)).toString()).trial;
  if(original.inputFingerprint!==trial.inputFingerprint)throw Error('Audited input fingerprint mismatch');
  const name=`${profile}-${traceName}`,bytes=gzipSync(JSON.stringify({profile,heapCapMiBPerIsolate:heap,sourceSignature:freeze.signature,trial}));
  writeFileSync(join(out,'trials',name),bytes);
  const e=evaluateTrial(trial),supplied=trial.arrivals.reduce((v,b)=>v+b.size.w*b.size.d*b.size.h,0);
  const row={profile,condition,algorithm,seed,index,status:trial.status,violations:trial.violations.length,unprocessed:trial.unprocessed.length,
   count:trial.placements.length,supplyAcceptance:trial.metrics.volumeMm3/supplied,density:trial.metrics.envelopeFill,
   columnVoidLiters:trial.metrics.columnVoidMm3/1e6,floor:trial.metrics.floorCoverage,skuContact:e.sameSkuContact,
   inputFingerprint:trial.inputFingerprint,geometrySha256:geometry(trial),sameGeometryAsAudited:geometry(trial)===geometry(original),
   wallMs,cpuMs:after.cpuMs-before.cpuMs,maxSampledRssMiB,peakProcessRssMiB:after.peakRssMiB,
   deadlineMisses:trial.metrics.deadlineMisses,fallbackCount:trial.metrics.fallbackCount,watchdogCount:trial.decisions.filter(d=>d.watchdog).length,
   decisionMs:trial.decisions.map(d=>d.decisionMs),validationMs:trial.decisions.map(d=>d.validationMs),
   cyclePreparationMs:trial.decisions.map(d=>d.recognitionMs+d.decisionMs+d.validationMs),
   searchStops:trial.decisions.map(d=>d.searchDiagnostics?.stop??null),trace:`trials/${name}`,traceSha256:sha(bytes)};
  rows.push(row);persist(false);
  process.stdout.write(JSON.stringify({profile,algorithm,completed:rows.length,total:indices.length*freeze.manifests.length,condition,seed,count:row.count,maxDecisionMs:Math.max(...row.decisionMs),sameGeometryAsAudited:row.sameGeometryAsAudited,deadlineMisses:row.deadlineMisses})+'\n');
 }
 for(const f of frozenFiles)if(sha(readFileSync(join(root,f.path)))!==f.sha256)throw Error(`Source changed during hardware pilot: ${f.path}`);
 persist(true);
}
main().catch(e=>{persist(false,String(e.stack??e));process.stderr.write(String(e.stack??e)+'\n');process.exitCode=1;}).finally(()=>supervisor.dispose());
