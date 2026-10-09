import {useEffect,useRef,useState} from 'react';
import {createStream,advanceStream,applyDecision} from './streamEngine';
import {observedProblem} from './streamPlanner';
import {frameClock} from './frameClock';
import type {Scenario} from '../types';
import {initializeStreamHistory,captureStreamHistory} from './streamHistory';
import type {StreamSnapshot} from './streamHistory';
import type {FlowDecision} from './streamPlanner';
import type {OrchestrationMode,OrchestrationObjective} from './orchestrator';

function initialSnapshot(scenario:Scenario,mode:OrchestrationMode,objective:OrchestrationObjective):StreamSnapshot {
 const world=createStream(scenario);world.stream!.orchestrationMode=mode;world.stream!.orchestrationObjective=objective;
 return initializeStreamHistory(world);
}
export function useStream(scenario:Scenario,active:boolean){
 const [version,setVersion]=useState(0),[playing,setPlayingState]=useState(false),[speed,setSpeed]=useState(4),[error,setError]=useState('');
 const [orchestrationMode,setMode]=useState<OrchestrationMode>('central');
 const [orchestrationObjective,setObjective]=useState<OrchestrationObjective>('throughput');
 const [replayIndex,setReplayState]=useState<number|null>(null);
 const [snapshot,setSnapshot]=useState(()=>initialSnapshot(scenario,orchestrationMode,orchestrationObjective));
 const live=useRef(snapshot),control=useRef({playing,active,speed});control.current={playing,active,speed};
 const setPlaying=(update:boolean|((previous:boolean)=>boolean))=>{const value=typeof update==='function'?update(control.current.playing):update;control.current.playing=value;setPlayingState(value);if(value)setReplayState(null);};
 useEffect(()=>{
  const initial=initialSnapshot(scenario,orchestrationMode,orchestrationObjective);live.current=initial;setSnapshot(initial);setError('');setReplayState(null);
  const worker=new Worker(new URL('./stream.worker.ts',import.meta.url),{type:'module'});let disposed=false,raf=0,last=performance.now(),lastPublish=0,lastPlan=-Infinity;
  const fail=(e:unknown)=>{setError(String(e));control.current.playing=false;setPlayingState(false);live.current={...live.current,busy:false};};
  worker.onerror=e=>{if(!disposed)fail(e.message);};
  worker.onmessage=e=>{if(disposed)return;live.current={...live.current,busy:false};if(e.data.error){fail(e.data.error);return;}
   const d=e.data.decision as FlowDecision;if(d.runId!==live.current.world.runId||!control.current.playing||!control.current.active)return;
   try{const next=applyDecision(scenario,live.current.world,live.current.motions,d);
    live.current=captureStreamHistory({...live.current,...next,ms:d.checks?d.milliseconds:live.current.ms,checks:live.current.checks+d.checks,
     latencySamples:d.checks?[...live.current.latencySamples,d.milliseconds].slice(-10000):live.current.latencySamples,
     peak:Math.max(live.current.peak,next.motions.length)},d.checks>0);
   }catch(error){fail(error);}
  };
  const tick=(now:number)=>{
   if(disposed)return;
   const frame=frameClock(now,last),dt=frame.delta;last=frame.last;const ctl=control.current;
   if(ctl.playing&&ctl.active&&!live.current.world.stream!.complete){
    try{const next=advanceStream(scenario,live.current.world,live.current.motions,live.current.world.time+dt*ctl.speed);live.current=captureStreamHistory({...live.current,...next});
     if(!live.current.busy&&live.current.world.time-lastPlan>.65){lastPlan=live.current.world.time;live.current={...live.current,busy:true};worker.postMessage({...observedProblem(scenario,live.current.world),busy:live.current.motions.map(m=>m.action.robot)});}
    }catch(error){fail(error);}
   }
   if(now-lastPublish>65){lastPublish=now;setSnapshot({...live.current});}raf=requestAnimationFrame(tick);
  };raf=requestAnimationFrame(tick);
  return()=>{disposed=true;cancelAnimationFrame(raf);worker.terminate();};
 },[scenario,version,orchestrationMode,orchestrationObjective]);
 const reset=(autoplay=false)=>{setPlaying(autoplay);setReplayState(null);setVersion(v=>v+1);};
 const setOrchestrationMode=(mode:OrchestrationMode)=>{if(mode===orchestrationMode)return;setPlaying(false);setReplayState(null);setMode(mode);};
 const setOrchestrationObjective=(objective:OrchestrationObjective)=>{if(objective===orchestrationObjective)return;setPlaying(false);setReplayState(null);setObjective(objective);};
 const setReplayIndex=(index:number|null)=>{setPlaying(false);setReplayState(index===null?null:Math.max(0,Math.min(snapshot.history.length-1,index)));};
 const selected=replayIndex===null?null:snapshot.history[replayIndex];
 return {...snapshot,...selected,liveWorld:snapshot.world,liveTime:snapshot.world.time,playing,speed,error,setPlaying,setSpeed,reset,
  orchestrationMode,setOrchestrationMode,orchestrationObjective,setOrchestrationObjective,replayIndex,setReplayIndex};
}
