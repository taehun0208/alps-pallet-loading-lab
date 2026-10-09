/// <reference lib="webworker" />
import { runAlpsTrial } from './experiment';
import type { AlpsConfig, AlpsTrial, Routing } from './experiment';
self.onmessage=(event:MessageEvent<{config:AlpsConfig;algorithm:string;route:Routing;seed:number;split:AlpsTrial['split']}>)=>{
 try{const {config,algorithm,route,seed,split}=event.data;self.postMessage({type:'result',row:runAlpsTrial(config,algorithm,route,seed,split)});}
 catch(e){self.postMessage({type:'error',message:e instanceof Error?e.message:String(e)});}
};
