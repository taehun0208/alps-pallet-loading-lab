import { validateBenchmark } from './scenarios';
import { failedTrial } from './runner';
import type { BenchmarkConfig,TrialSpec,TrialRow,WarmupRecord } from './model';
export function trialList(c:BenchmarkConfig){validateBenchmark(c);const jobs:TrialSpec[]=[];
 for(let episode=0;episode<c.repeats;episode++)for(const caseId of c.cases){const ids=[...c.algorithms,...(c.includeOffline&&!['missing','resize','damaged','palletChange'].includes(caseId)?['offline-stock']:[])];for(const algorithm of ids)jobs.push({algorithm,caseId,seed:(c.seed+episode)%2147483648,episode});}return jobs;
}
export interface BenchmarkProgress {done:number;total:number;active?:TrialSpec;step?:number;phase?:'warmup'|'measurement';state:'running'|'paused'|'cancelled'|'complete'}
/** One isolated trial at a time; warmup uses the SAME worker but fresh trial state. */
export class BenchmarkController {
 private worker:Worker|null=null;private workerGeneration=0;private invocation=0;
 private cancelled=false;private paused=false;private wake:(()=>void)|null=null;private abortTrial:(()=>void)|null=null;
 constructor(private createWorker:()=>Worker=()=>new Worker(new URL('./worker.ts',import.meta.url),{type:'module'})){}
 pause(value:boolean){this.paused=value;if(!value){this.wake?.();this.wake=null;}}
 cancel(){this.cancelled=true;this.abortTrial?.();this.worker?.terminate();this.worker=null;this.wake?.();}
 private execute(c:BenchmarkConfig,spec:TrialSpec,onStep:(step:number)=>void){
  return new Promise<TrialRow|null>(resolve=>{
   const id=String(++this.invocation);
   if(!this.worker){this.worker=this.createWorker();this.workerGeneration++;}
   const worker=this.worker;let settled=false,decisionTimer:ReturnType<typeof setTimeout>|undefined;
   const finish=(row:TrialRow|null,kill=false)=>{if(settled)return;settled=true;clearTimeout(trialTimer);clearTimeout(decisionTimer);worker.onmessage=null;worker.onerror=null;this.abortTrial=null;if(kill){worker.terminate();this.worker=null;}resolve(row);};
   const trialTimer=setTimeout(()=>finish(failedTrial(c,spec,'전체 실행 시간 예산 초과 · Worker 중단'),true),c.trialMs+2000);
   this.abortTrial=()=>finish(null,true);
   worker.onerror=()=>finish(failedTrial(c,spec,'평가 Worker 오류','error'),true);
   worker.onmessage=event=>{const m=event.data;if(m.id!==id||settled)return;
    if(m.type==='decision-start'){onStep(m.step);clearTimeout(decisionTimer);decisionTimer=setTimeout(()=>finish(failedTrial(c,spec,'판단 시간 예산 초과 · Worker 중단'),true),c.decisionMs+500);}
    if(m.type==='decision-end')clearTimeout(decisionTimer);
    if(m.type==='result')finish(m.row);if(m.type==='error')finish(failedTrial(c,spec,m.message,'error'),true);
   };worker.postMessage({id,config:c,spec});
  });
 }
 async run(input:BenchmarkConfig,onRow:(r:TrialRow)=>void,onProgress:(p:BenchmarkProgress)=>void){
  const c=structuredClone(input),jobs=trialList(c),warmed=new Map<string,{generation:number;record:WarmupRecord}>();let done=0;
  try{for(const spec of jobs){
   if(this.cancelled)break;
   if(this.paused){onProgress({done,total:jobs.length,state:'paused'});await new Promise<void>(r=>this.wake=r);}
   if(this.cancelled)break;
   const update=(phase:'warmup'|'measurement',step?:number)=>onProgress({done,total:jobs.length,active:spec,phase,step,state:'running'});
   let prior=warmed.get(spec.algorithm);
   if(!prior||prior.generation!==this.workerGeneration||!this.worker){
    const record:WarmupRecord={requested:c.warmupRuns??1,completed:0,outcomes:[],sameWorker:false};
    for(let n=0;n<record.requested&&!this.cancelled;n++){
     update('warmup');const result=await this.execute(c,spec,step=>update('warmup',step));
     if(!result)break;record.outcomes.push(result.outcome);
     if(['timeout','error','constraint-rejected','environment-blocked'].includes(result.outcome))break;
     record.completed++;
    }
    prior={generation:this.workerGeneration,record};warmed.set(spec.algorithm,prior);
   }
   if(this.cancelled)break;
   update('measurement');const row=await this.execute(c,spec,step=>update('measurement',step));
   if(row){row.warmup={...structuredClone(prior.record),sameWorker:prior.record.completed>0&&prior.generation===this.workerGeneration};onRow(row);done++;}
  }}finally{this.worker?.terminate();this.worker=null;onProgress({done,total:jobs.length,state:this.cancelled?'cancelled':'complete'});}
 }
}
