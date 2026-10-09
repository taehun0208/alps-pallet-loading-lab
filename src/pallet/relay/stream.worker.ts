/// <reference lib="webworker" />
import {planStream} from './streamPlanner';
self.onmessage=e=>{try{const {scenario,world,busy}=e.data;self.postMessage({decision:planStream(scenario,world,busy)});}catch(error){self.postMessage({error:String(error)});}};
