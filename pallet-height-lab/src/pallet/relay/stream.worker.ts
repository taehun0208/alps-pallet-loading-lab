/// <reference lib="webworker" />
import {planStream} from './streamPlanner';
self.onmessage=e=>{try{const {scenario,world,busy,central=true}=e.data;self.postMessage({decision:planStream(scenario,world,busy,central)});}catch(error){self.postMessage({error:String(error)});}};
