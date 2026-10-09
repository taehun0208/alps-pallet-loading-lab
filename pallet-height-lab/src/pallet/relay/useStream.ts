import {useEffect,useRef,useState} from 'react';
import {createStream,advanceStream,applyDecision} from './streamEngine';
import {observedProblem} from './streamPlanner';
import {frameClock} from './frameClock';
import type {Scenario} from '../types';
import type {RelayMotion} from './types';
import type {FlowDecision} from './streamPlanner';
export function useStream(scenario:Scenario,active:boolean,central=true){
 const [version,setVersion]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(4),[error,setError]=useState('');const stepTarget=useRef<number|null>(null);
 const [snapshot,setSnapshot]=useState(()=>({world:createStream(scenario),motions:[] as RelayMotion[],peak:0,ms:0,checks:0,busy:false,dispatch:null as FlowDecision['dispatch']|null,decision:null as FlowDecision|null}));
 const live=useRef(snapshot),control=useRef({playing,active,speed});control.current={playing,active,speed};
 useEffect(()=>{
  const initial={world:createStream(scenario),motions:[] as RelayMotion[],peak:0,ms:0,checks:0,busy:false,dispatch:null as FlowDecision['dispatch']|null,decision:null as FlowDecision|null};live.current=initial;setSnapshot(initial);setError('');stepTarget.current=null;
  const worker=new Worker(new URL('./stream.worker.ts',import.meta.url),{type:'module'});let disposed=false,raf=0,last=performance.now(),lastPublish=0,lastPlan=-Infinity;
  const fail=(e:unknown)=>{setError(String(e));setPlaying(false);live.current.busy=false;};
  worker.onerror=e=>{if(!disposed)fail(e.message);};
  worker.onmessage=e=>{if(disposed)return;live.current.busy=false;if(e.data.error){fail(e.data.error);return;}
   const d=e.data.decision as FlowDecision;if(d.runId!==live.current.world.runId||!control.current.playing||!control.current.active)return;
   try{const next=applyDecision(scenario,live.current.world,live.current.motions,d);live.current={...live.current,...next,ms:d.checks?d.milliseconds:live.current.ms,checks:live.current.checks+d.checks,peak:Math.max(live.current.peak,next.motions.length),decision:d.proposals.length?d:live.current.decision,dispatch:d.proposals.length?d.dispatch||null:live.current.dispatch};}catch(error){fail(error);}
  };
  const tick=(now:number)=>{
   if(disposed)return;
   const frame=frameClock(now,last),dt=frame.delta;last=frame.last;const ctl=control.current;
   if(ctl.playing&&ctl.active&&!live.current.world.stream!.complete){
    try{const next=advanceStream(scenario,live.current.world,live.current.motions,live.current.world.time+dt*ctl.speed);live.current={...live.current,...next};
     if(stepTarget.current!==null&&live.current.world.records.length>=stepTarget.current){stepTarget.current=null;control.current.playing=false;setPlaying(false);}
     if(control.current.playing&&!live.current.busy&&live.current.world.time-lastPlan>.65){lastPlan=live.current.world.time;live.current.busy=true;worker.postMessage({...observedProblem(scenario,live.current.world),busy:live.current.motions.map(m=>m.action.robot),central});}
    }catch(error){fail(error);}
   }
   if(now-lastPublish>65){lastPublish=now;setSnapshot({...live.current});}raf=requestAnimationFrame(tick);
  };raf=requestAnimationFrame(tick);
  return()=>{disposed=true;cancelAnimationFrame(raf);worker.terminate();};
 },[scenario,version,central]);
 const reset=(autoplay=false)=>{stepTarget.current=null;control.current.playing=autoplay;setPlaying(autoplay);setVersion(v=>v+1);};
 const step=()=>{stepTarget.current=live.current.world.records.length+1;control.current.playing=true;setPlaying(true);};
 const play=(value:boolean|((previous:boolean)=>boolean))=>{stepTarget.current=null;setPlaying(value);};
 return {...snapshot,playing,speed,error,setPlaying:play,setSpeed,reset,step};
}
