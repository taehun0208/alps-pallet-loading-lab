import { createExperiment } from './core';
import { createPlannerSupervisor } from './supervisor';
import type { WorkerPort } from './supervisor';
import type { EngineCommand, EngineEvent } from './types';
let active: { id:string; abort:AbortController; dispose:()=>void }|null=null;
const send=(message:EngineEvent)=>self.postMessage(message);
self.onmessage=async (event:MessageEvent<EngineCommand>)=>{
 const command=event.data;
 if(command.type==='cancel'){if(active?.id===command.runId)active.abort.abort();return;}
 active?.abort.abort();active?.dispose();
 const abort=new AbortController(),supervisor=createPlannerSupervisor(()=>new Worker(new URL('./planner.worker.ts',import.meta.url),{type:'module'}) as unknown as WorkerPort);
 const run={id:command.runId,abort,dispose:supervisor.dispose};active=run;
 try{const result=await createExperiment(command.request,{planDecision:supervisor.planDecision,signal:abort.signal,onProgress:progress=>{if(active===run)send({type:'progress',runId:run.id,progress});}},row=>{if(active===run)send({type:'trial',runId:run.id,row});});if(active===run)send({type:'result',runId:run.id,result});}
 catch(error){if(active===run)send({type:'error',runId:run.id,message:error instanceof Error?error.message:String(error)});}
 finally{supervisor.dispose();if(active===run)active=null;}
};
