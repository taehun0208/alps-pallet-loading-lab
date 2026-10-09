import { useEffect,useMemo,useRef,useState } from 'react';
import { ArrivalEnvironment,advance,replay } from './environment';
import { emptyFrame } from './types';
import { replanFrame } from './replanning';
import type { Scenario,Algorithm,SearchSettings,Frame,Analysis,PlanningInput,GripPath } from './types';
export interface Archive { id:string;scenario:Scenario;algorithm:Algorithm;settings:SearchSettings;frame:Frame }
export function usePallet(scenario:Scenario,algorithm:Algorithm,settings:SearchSettings,enabled=true){
 const env=useMemo(()=>new ArrivalEnvironment(scenario),[scenario]),[frame,setFrame]=useState(emptyFrame),[runId,setRunId]=useState(()=>crypto.randomUUID() as string),[analysis,setAnalysis]=useState<Analysis|null>(null),[busy,setBusy]=useState(false),[auto,setAuto]=useState(false),[paused,setPaused]=useState(false),[cursor,setCursor]=useState<number|null>(null),[archives,setArchives]=useState<Archive[]>([]),[speed,setSpeed]=useState(8),[motion,setMotion]=useState<{input:PlanningInput;analysis:Analysis;path:GripPath}|null>(null),[progress,setProgress]=useState(0),[error,setError]=useState('');
 const [suspended,setSuspended]=useState(false),[pendingStep,setPendingStep]=useState(false);
 const live=useRef({frame,runId,scenario,algorithm,settings,auto,paused,speed,motion,analysis});live.current={frame,runId,scenario,algorithm,settings,auto,paused,speed,motion,analysis};const locked=useRef(false),previous=useRef({scenario,algorithm,settings});
 const retained=useRef<{scenario:Scenario;frame:Frame}|null>(null);
 const resetPending=previous.current.scenario!==scenario||previous.current.algorithm!==algorithm||previous.current.settings!==settings,effectiveFrame=resetPending?(retained.current?.scenario===scenario?retained.current.frame:emptyFrame()):frame;
 const reset=(branch?:Frame)=>{const l=live.current;if(l.frame.records.length)setArchives(a=>[{id:l.runId,scenario:l.scenario,algorithm:l.algorithm,settings:l.settings,frame:l.frame},...a]);locked.current=false;setSuspended(false);setPendingStep(false);setAuto(false);setPaused(false);setMotion(null);setProgress(0);setCursor(null);setAnalysis(null);setFrame(branch||emptyFrame());setRunId(crypto.randomUUID());setError('');};
 useEffect(()=>{if(previous.current.scenario!==scenario||previous.current.algorithm!==algorithm||previous.current.settings!==settings){const old=previous.current;if(live.current.frame.records.length)setArchives(a=>[{id:live.current.runId,...old,frame:live.current.frame},...a]);locked.current=false;setAuto(false);setMotion(null);setPaused(false);setCursor(null);setFrame(retained.current?.scenario===scenario?retained.current.frame:emptyFrame());retained.current=null;setAnalysis(null);setRunId(crypto.randomUUID());setSuspended(false);setPendingStep(false);previous.current={scenario,algorithm,settings};}},[scenario,algorithm,settings]);
 useEffect(()=>{
  setAnalysis(null);setError('');if(resetPending){setBusy(false);return;}const input=env.input(frame,algorithm,settings,runId);if(!enabled||suspended||!input||['damaged','missing'].includes(input.current.status)){setBusy(false);return;}
  setBusy(true);const worker=new Worker(new URL('./planner.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=e=>{const a=e.data;if(a.runId!==live.current.runId||a.stepId!==live.current.frame.processed&&a.kind!=='error')return;setBusy(false);if(a.kind==='error')setError(a.message);else setAnalysis(a);};worker.onerror=e=>{setBusy(false);setError(e.message);};worker.postMessage({kind:'plan',input});return()=>worker.terminate();
 },[env,frame,algorithm,settings,runId,suspended,resetPending,enabled]);
 const step=()=>{
  const l=live.current;if(!enabled||resetPending||locked.current||l.frame.blocked||cursor!==null)return;const input=env.input(l.frame,l.algorithm,l.settings,l.runId);if(!input)return;
  if(['damaged','missing'].includes(input.current.status)){setFrame(advance(l.frame,input,null));return;}
  const a=l.analysis;if(!a||a.runId!==l.runId||a.stepId!==l.frame.processed)return;const candidate=a.candidates.find(c=>c.id===a.selectedId);
  if(!candidate){setFrame(advance(l.frame,input,a));setAuto(false);return;}
  input.current=env.currentFor(l.frame,a)!;locked.current=true;setPaused(false);setProgress(0);setMotion({input,analysis:a,path:candidate.path});
 };
 useEffect(()=>{if(!enabled||resetPending)return;if(auto&&!motion&&!busy&&cursor===null){if(!env.currentFor(frame,analysis)||frame.blocked){setAuto(false);return;}step();}},[auto,motion,busy,analysis,frame,cursor,resetPending,enabled]);
 useEffect(()=>{if(!motion)return;let raf=0,last=performance.now(),elapsed=0;const tick=(now:number)=>{const l=live.current,dt=Math.min(.1,(now-last)/1000);last=now;if(!l.paused)elapsed+=dt*l.speed;const p=Math.min(1,elapsed/motion.path.seconds);setProgress(p);if(p>=1){if(l.runId===motion.input.runId&&l.frame.processed===motion.input.stepId){setFrame(advance(l.frame,motion.input,motion.analysis));}locked.current=false;setMotion(null);return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[motion]);
 useEffect(()=>{if(!enabled){setAuto(false);setMotion(null);setAnalysis(null);setProgress(0);setPaused(true);locked.current=false;}},[enabled]);
 const view=useMemo(()=>cursor===null?effectiveFrame:replay(effectiveFrame.records,cursor),[effectiveFrame,cursor]),current=useMemo(()=>env.currentFor(view,cursor===null?analysis:null),[env,view,analysis,cursor]);
 const play=()=>{setSuspended(false);setCursor(null);setPaused(false);setAuto(true);};const pause=()=>{setAuto(false);setPaused(true);};
 const one=()=>{if(suspended){setSuspended(false);setPendingStep(true);}else if(motion){setPaused(false);setAuto(false);}else{setAuto(false);step();}};
 useEffect(()=>{if(pendingStep&&!busy&&analysis){setPendingStep(false);step();}},[pendingStep,busy,analysis]);
 const cancel=()=>{setAuto(false);setPaused(true);setSuspended(true);setPendingStep(false);setMotion(null);setAnalysis(null);setProgress(0);locked.current=false;setRunId(crypto.randomUUID());};
 const prepareReplan=(next:Scenario)=>{if(cursor!==null)throw Error('현재 프레임으로 돌아온 뒤 재계획하세요.');retained.current={scenario:next,frame:replanFrame(live.current.frame,live.current.scenario,next)};};
 return {prepareReplan,frame:effectiveFrame,view,current,env,runId,analysis,busy,error,auto,paused,motion,progress,speed,setSpeed,cursor,setCursor,archives,reset,play,pause,cancel,step:one,branch:()=>reset(view)};
}
