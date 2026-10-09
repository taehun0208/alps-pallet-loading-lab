import { advanceConveyor,hasBeltTransit } from './conveyor';
import { useEffect,useRef,useState } from 'react';
import { ROBOT_COUNT } from './layout';
import { createRelay,commitRelay } from './engine';
import type { Scenario } from '../types';
import type { RelayAlgorithm,RelayDecision,RelayMotion,RelayWorld } from './types';
export function useRelay(s:Scenario,algorithm:RelayAlgorithm,seed:number,shuffle:boolean,transfers:boolean,active:boolean,planningEnabled=true){
 const [world,setWorld]=useState(()=>createRelay(s,seed,shuffle,crypto.randomUUID())),[history,setHistory]=useState<RelayWorld[]>([world]),[cursor,setCursor]=useState<number|null>(null),[decision,setDecision]=useState<RelayDecision|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[motions,setMotions]=useState<RelayMotion[]>([]),[auto,setAuto]=useState(false),[paused,setPaused]=useState(false),[speed,setSpeed]=useState(4),[epoch,setEpoch]=useState(0),[time,setTime]=useState(0),[peak,setPeak]=useState(0);
 const [compute,setCompute]=useState({jobs:0,totalMs:0,lastMs:0,maxMs:0,checked:0,generated:0,cacheHits:0});
 const live=useRef({world,motions,active,paused,speed,time});live.current={world,motions,active,paused,speed,time};const worker=useRef<Worker|null>(null),generation=useRef(0),lastLaunch=useRef<RelayDecision|null>(null),decisionContext=useRef({revision:-1,motionKey:''});
 const reset=()=>{generation.current++;worker.current?.terminate();worker.current=null;const fresh=createRelay(s,seed,shuffle,crypto.randomUUID());live.current.world=fresh;live.current.motions=[];live.current.time=0;setWorld(fresh);setHistory([fresh]);setCursor(null);setDecision(null);setMotions([]);setTime(0);setPeak(0);setAuto(false);setPaused(false);setError('');setCompute({jobs:0,totalMs:0,lastMs:0,maxMs:0,checked:0,generated:0,cacheHits:0});};
 const previous=useRef({s,algorithm,seed,shuffle,transfers});
 useEffect(()=>{const p=previous.current;if(p.s!==s||p.algorithm!==algorithm||p.seed!==seed||p.shuffle!==shuffle||p.transfers!==transfers){previous.current={s,algorithm,seed,shuffle,transfers};reset();}},[s,algorithm,seed,shuffle,transfers]);
 useEffect(()=>{if(!active){setAuto(false);setPaused(true);}},[active]);
 useEffect(()=>()=>{worker.current?.terminate();worker.current=null;},[]);
 const motionKey=motions.map(m=>`${m.action.robot}:${m.action.boxId}:${m.action.kind}`).join('|');
 useEffect(()=>{const token=++generation.current;if(!planningEnabled){setDecision(null);setBusy(false);return;}setDecision(null);setBusy(false);if(!active||cursor!==null||motions.length===ROBOT_COUNT)return;
  const job=worker.current??new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});worker.current=job;setBusy(true);
  job.onmessage=e=>{const m=e.data;if(m.requestId!==token||token!==generation.current||m.runId!==live.current.world.runId||m.revision!==live.current.world.revision)return;setBusy(false);if(m.error){setError(m.error);setAuto(false);}else{decisionContext.current={revision:world.revision,motionKey};setDecision(m.decision);const d=m.decision;setCompute(c=>({jobs:c.jobs+1,totalMs:c.totalMs+d.milliseconds,lastMs:d.milliseconds,maxMs:Math.max(c.maxMs,d.milliseconds),checked:c.checked+(d.compute?.checked??0),generated:c.generated+(d.compute?.generated??0),cacheHits:c.cacheHits+(d.compute?.cacheHits??0)}));}};job.onerror=e=>{if(token!==generation.current)return;setError(e.message);setBusy(false);setAuto(false);};job.postMessage({requestId:token,scenario:s,world,algorithm,transfers,running:live.current.motions.map(m=>m.action)});return()=>{generation.current++;};
 },[s,world,algorithm,transfers,active,planningEnabled,cursor,motionKey,epoch]);
 const decisionFresh=()=>decisionContext.current.revision===live.current.world.revision&&decisionContext.current.motionKey===live.current.motions.map(m=>`${m.action.robot}:${m.action.boxId}:${m.action.kind}`).join('|');
 const launch=()=>{if(!decisionFresh()||!active||!planningEnabled||busy||cursor!==null||!decision?.actions.length||lastLaunch.current===decision)return;lastLaunch.current=decision;const next=[...live.current.motions,...decision.actions.map(action=>({action,started:live.current.time,elapsed:0,progress:0}))];live.current.motions=next;setMotions(next);setPeak(n=>Math.max(n,next.length));setDecision(null);setPaused(false);};
 useEffect(()=>{if(active&&auto&&!paused&&!busy&&cursor===null){if(decisionFresh()&&decision&&!decision.actions.length&&!motions.length&&!hasBeltTransit(world))setAuto(false);else launch();}},[active,auto,paused,busy,decision,cursor,motionKey,world]);
 useEffect(()=>{let id=0,last=performance.now();const tick=(now:number)=>{const r=live.current,dt=Math.min(.1,(now-last)/1000);last=now;
  if(r.active&&!r.paused&&(r.motions.length||hasBeltTransit(r.world))){const time=r.time+dt*r.speed,updated=r.motions.map(m=>({...m,elapsed:time-m.started,progress:Math.min(1,(time-m.started)/m.action.seconds)})),done=updated.filter(m=>m.progress>=1).sort((a,b)=>(a.started+a.action.seconds)-(b.started+b.action.seconds)),remaining=updated.filter(m=>m.progress<1),snapshots:RelayWorld[]=[];
   let world=r.world;try{for(const m of done){world=commitRelay(s,world,m.action,m.started,m.started+m.action.seconds);snapshots.push(world);}const arrived=advanceConveyor(world,time,remaining);if(arrived!==world){world=arrived;snapshots.push(world);}}catch(e){setError((e as Error).message);setAuto(false);setPaused(true);remaining.length=0;}
   r.world=world;r.time=time;r.motions=remaining;setWorld(world);setTime(time);setMotions(remaining);if(snapshots.length)setHistory(h=>[...h,...snapshots]);
  }id=requestAnimationFrame(tick);
 };id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[s]);
 return {world,view:cursor===null?world:history[cursor],history,cursor,decision,busy,error,motions,auto,paused,speed,time,peak,compute,decisionReady:!!decision&&decisionFresh(),setSpeed,reset,
  play:()=>{setCursor(null);setPaused(false);setAuto(true);},pause:()=>{setPaused(true);setAuto(false);},step:()=>{setAuto(false);setPaused(false);launch();},
  cancel:()=>{generation.current++;worker.current?.terminate();worker.current=null;live.current.motions=[];setMotions([]);setAuto(false);setPaused(true);setDecision(null);setEpoch(v=>v+1);},
  seek:(n:number|null)=>{if(motions.length)return;setAuto(false);setPaused(true);setCursor(n);},
 };
}
