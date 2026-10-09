// Single-robot comparison runner.
//   npm run benchmark:single -- --phase eval --run-id <id> --shard 0/8 [--policy-set full|cog-sweep] [--situations a,b] [--policies a,b] [--datasets 11,12]
// Each run ID gets its own directory with manifest.json (planned keys + config hashes) and one
// runs-<shard>.jsonl per shard. Existing shard files are never appended to.
// Defaults to --suite core: ordinary inputs, including paired overflow-buffer capacities 0/2/4.
// --suite boundary tests extreme orders/support sensitivity; --suite events tests faults;
// --suite all preserves the complete experiment set. Explicit --situations overrides the suite.
// Buffer experiments measure temporary storage of boxes with no valid placement, not proactive
// reordering. Buffer handling and pallet exchange durations remain unmeasured (not zero).
import { appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runSingleRobot } from '../src/pallet/singleRobot/compare';
import { selectSituations } from '../src/pallet/singleRobot/situations';
import { PHASE_SEEDS,MAIN_CONDITIONS,BED_SPLIT,caseSeeds,policies,devSweepPolicies,assertDisjointSplit,assertPhaseDatasets,COG_WEIGHTS,HARNESS_VERSION,TRANSPORT_G,type Phase } from '../src/pallet/singleRobot/config';

const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:fallback;};
const phase=arg('phase','eval') as Phase,runId=arg('run-id',''),[shard,shards]=arg('shard','0/1').split('/').map(Number),list=(v:string)=>v==='all'?null:v.split(',');
if(!runId)throw Error('--run-id 가 필요합니다. 실행 ID마다 별도 폴더에 저장합니다.');
if(!['dev','explore','eval'].includes(phase))throw Error('--phase dev|explore|eval');
assertDisjointSplit();
const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v as object).sort().map(k=>`${JSON.stringify(k)}:${stable((v as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(v)??'null';
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');
const bundle=fileURLToPath(import.meta.url),git=(cmd:string)=>{try{return execSync(cmd,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}};
// The esbuild bundle contains every imported src module, so its hash identifies the code that ran.
const source={bundleSha256:hash(readFileSync(bundle,'utf8')),gitHead:git('git rev-parse HEAD'),gitDiffSha256:hash(git('git diff HEAD')??''),gitUntracked:(git('git status --porcelain')??'').split('\n').filter(l=>l.startsWith('??')).length,harness:HARNESS_VERSION};

const situationIds=list(arg('situations','all')),policyIds=list(arg('policies','all'));
const suite=arg('suite','core'),situations=selectSituations(suite,situationIds);
const policySet=arg('policy-set',phase==='dev'?'cog-sweep':'full');if(!['cog-sweep','full'].includes(policySet))throw Error('--policy-set cog-sweep|full');
const policyList=(policySet==='cog-sweep'?devSweepPolicies():policies(COG_WEIGHTS)).filter(p=>!policyIds||policyIds.includes(p.id));
const datasets=(list(arg('datasets','all'))?.map(Number))??PHASE_SEEDS[phase];assertPhaseDatasets(phase,datasets);
const jobs=situations.flatMap(s=>datasets.flatMap(d=>policyList.map(p=>({s,seeds:caseSeeds(d),p}))));
const keyOf=(j:typeof jobs[number])=>[j.s.id,phase,j.seeds.dataset,j.seeds.arrival,j.seeds.event,j.seeds.planner,j.p.id].join('|');
// Config hash covers everything that defines a run except the seeds (which are in the key).
const configOf=(j:typeof jobs[number])=>{const c=j.s.build(phase,j.seeds);return {harness:HARNESS_VERSION,policy:j.p,bufferSize:c.bufferSize,pallet:c.scenario.pallet,constraints:c.scenario.constraints,transportG:TRANSPORT_G,palletUnit:null};};
const inputOf=(c:ReturnType<typeof jobs[number]['s']['build']>)=>hash({types:c.scenario.types,sequence:c.sequence,events:c.events,pallet:c.scenario.pallet,constraints:c.scenario.constraints,source:c.source});

const dir=`work/single-robot-runs/${runId}`;mkdirSync(dir,{recursive:true});
// Concurrency is declared by the operator (processes started together), not inferred from the shard count.
const concurrency=Number(arg('concurrency',String(shards)));if(!Number.isInteger(concurrency)||concurrency<1)throw Error('--concurrency 는 1 이상의 정수');
const environment={node:process.version,platform:process.platform,arch:process.arch,cpuModel:os.cpus()[0]?.model??null,cpus:os.cpus().length,concurrency,shard,loadAverageAtStart:os.loadavg()};
const manifest={runId,phase,policySet,suite,shards,source,cogWeights:COG_WEIGHTS,mainConditions:MAIN_CONDITIONS,bedOrders:BED_SPLIT[phase],datasets,situations:situations.map(s=>s.id),policies:policyList.map(p=>p.id),
 expected:jobs.map(j=>({key:keyOf(j),configHash:hash(configOf(j)),inputHash:inputOf(j.s.build(phase,j.seeds))}))};
const manifestFile=`${dir}/manifest.json`,manifestText=JSON.stringify(manifest,null,1);
if(existsSync(manifestFile)&&readFileSync(manifestFile,'utf8')!==manifestText)throw Error(`${manifestFile} 가 다른 계획으로 이미 존재합니다. 새 실행 ID를 쓰세요.`);
writeFileSync(manifestFile,manifestText);
// Optional warm-up (not recorded) so JIT compilation does not land in the first measured run.
if(arg('warmup','0')==='1'&&jobs.length){const j=jobs[0];runSingleRobot(j.s.build(phase,j.seeds),j.p);}
const file=`${dir}/runs-${shard}.jsonl`;if(existsSync(file))throw Error(`${file} 가 이미 있습니다. 결과에 덧붙이지 않습니다.`);
writeFileSync(file,'');
jobs.forEach((job,i)=>{
 if(i%shards!==shard)return;
 const c=job.s.build(phase,job.seeds),start=performance.now(),run=runSingleRobot(c,job.p);
 const inputHash=inputOf(c);
 const record={...run,runId,key:keyOf(job),configHash:hash(configOf(job)),inputHash,sourceVersion:source,environment,wallSeconds:(performance.now()-start)/1000};
 appendFileSync(file,JSON.stringify(record)+'\n');
 console.log(`${i+1}/${jobs.length} ${job.s.id} d${job.seeds.dataset} ${job.p.id} pallets=${run.performance.pallets} done=${run.performance.completed}/${run.performance.demand} ${record.wallSeconds.toFixed(1)}s`);
});
