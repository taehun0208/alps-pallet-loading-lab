/// <reference lib="webworker" />
import { runTrial } from './runner';
import type { BenchmarkConfig,TrialSpec } from './model';
self.onmessage=async(e:MessageEvent<{id:string;config:BenchmarkConfig;spec:TrialSpec}>)=>{
 const {id,config,spec}=e.data;
 try{const row=await runTrial(config,spec,{beforeDecision:async(step)=>{self.postMessage({id,type:'decision-start',step});await new Promise(r=>setTimeout(r,0));},afterDecision:step=>self.postMessage({id,type:'decision-end',step})});self.postMessage({id,type:'result',row});}
 catch(error){self.postMessage({id,type:'error',message:error instanceof Error?error.message:String(error)});}
};
