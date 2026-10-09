// Build to a separate bundle to avoid touching an ongoing single-robot benchmark:
// npx esbuild scripts/active-buffer-benchmark.ts --bundle --platform=node --format=esm --outfile=work/active-buffer.mjs
// node work/active-buffer.mjs --out work/active-buffer-eval.json --phase eval --datasets 11,12
// Default: paired normal cases, capacity 0/2/4, all three modes. No event injection or tuning.
import { writeFileSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { runBufferExperiment,type BufferMode } from '../src/pallet/singleRobot/bufferExperiment';
import { buildCase } from '../src/pallet/singleRobot/situations';
import type { Phase } from '../src/pallet/singleRobot/config';

const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(`--${name}`);return i<0?fallback:process.argv[i+1];};
// Datasets 11-14 were already examined here, so they now belong to the 'explore' phase (same inputs as before).
const out=arg('out',''),phase=arg('phase','explore') as Phase;
if(!out||!['dev','explore','eval'].includes(phase))throw Error('--out <new file> --phase dev|explore|eval required');
const datasets=arg('datasets','11,12').split(',').map(Number),buffers=arg('buffers','0,2,4').split(',').map(Number);
const situations=arg('situations','mixed-48,repeated-sku,bed-bpp-order').split(',');
const profile=arg('profile','inherited');
if(!['inherited','generic'].includes(profile))throw Error('--profile inherited|generic');
if([...datasets,...buffers].some(n=>!Number.isInteger(n)||n<0))throw Error('Invalid datasets/buffers');
const timingArg=arg('timing','none'),values=timingArg.split(',').map(Number);
if(timingArg!=='none'&&(values.length!==4||values.some(n=>!Number.isFinite(n)||n<0)))throw Error('--timing arrival,store,retrieve,exchange (seconds)');
const timing=timingArg==='none'?undefined:{arrivalIntervalSeconds:values[0],storeSeconds:values[1],retrieveSeconds:values[2],exchangeSeconds:values[3]};
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const modes:BufferMode[]=['overflow','window-fifo','window-best'];
const trials=situations.flatMap(s=>datasets.flatMap(d=>buffers.map(bufferSize=>({s,d,bufferSize}))));
const runs:ReturnType<typeof runBufferExperiment>[]=[],inputs:{situation:string;dataset:number;bufferSize:number;sha256:string}[]=[];
const metadata={schema:'active-buffer-benchmark/1',created:new Date().toISOString(),phase,datasets,buffers,situations,profile,timing:timing??null,
 profileDescription:profile==='generic'?'Disable standingHeight neighbor-build rule only; retain all other geometry, support, load, stability and robot-proxy constraints':'Preserve source case constraints',
 bundleSha256:sha(readFileSync(fileURLToPath(import.meta.url),'utf8')),environment:{node:process.version,cpu:os.cpus()[0]?.model,cpus:os.cpus().length,parallelism:1,externalLoad:'uncontrolled'},
 caveats:['compact planner only','no physical robot validation','latencies under uncontrolled external CPU load','buffer positions and travel not modeled; optional costs are assumptions','not the legacy overflow harness; common engine used for all three modes']};
// Exclusive creation prevents overwriting Claude runs or any previous experiment.
writeFileSync(out,JSON.stringify({metadata,status:'running'}),{flag:'wx'});
const quantile=(xs:number[],q:number)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*q)-1)]:null;
for(const [index,trial] of trials.entries()){
 const c={...buildCase(trial.s,phase,trial.d),bufferSize:trial.bufferSize};
 if(profile==='generic')c.scenario.constraints.standingHeight={enabled:false,maxRiseMm:100};
 inputs.push({situation:trial.s,dataset:trial.d,bufferSize:trial.bufferSize,sha256:sha(JSON.stringify(c))});
 // Rotate execution order to reduce fixed-position warmup bias. No concurrent timing runs here.
 for(let i=0;i<modes.length;i++){
  const mode=modes[(index+i)%modes.length],run=runBufferExperiment(c,{mode,timing});runs.push(run);
  console.log(`${trial.s} d${trial.d} B${trial.bufferSize} ${mode}: ${run.performance.completed}/${run.performance.total}, pallets=${run.performance.pallets}, calls=${run.compute.plannerCalls}`);
 }
 writeFileSync(out,JSON.stringify({metadata,status:'running',inputs,runs}));
}
const summary=runs.map(r=>({situation:r.situation,dataset:r.seeds.dataset,buffer:r.config.bufferSize,mode:r.config.mode,...r.performance,
 status:r.fitness.status,minReserveMm:r.stability.minReserveMm,stores:r.buffer.stores,retrieves:r.buffer.retrieves,maxWaitArrivalSteps:r.buffer.maxWaitArrivalSteps,
 placementSeconds:r.robot.placementSeconds,serialModelSeconds:r.robot.serialModelSeconds,plannerCalls:r.compute.plannerCalls,candidatesChecked:r.compute.candidatesChecked,
 p50DecisionMs:quantile(r.compute.decisionMs,.5),p99DecisionMs:quantile(r.compute.decisionMs,.99)}));
writeFileSync(out,JSON.stringify({metadata,status:'complete',inputs,summary,runs}));
console.log(`Saved ${runs.length} paired runs to ${out}`);
