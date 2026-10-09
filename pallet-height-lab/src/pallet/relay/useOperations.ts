import { hasBeltTransit } from './conveyor';
import {useEffect,useRef,useState} from 'react';
import {phaseSeconds,nextPhase,canRelease,manifest} from './operations';
import type {ContextId,ProcessPhase} from './operations';
import type {useRelay} from './useRelay';
export function useOperations(sim:ReturnType<typeof useRelay>,context:ContextId,active:boolean,phase:ProcessPhase,setPhase:(p:ProcessPhase)=>void){
 const [elapsed,setElapsed]=useState(0),[running,setRunning]=useState(false),[processTime,setProcessTime]=useState(0);
 const latest=useRef({phase,running,speed:sim.speed,active,context,total:sim.world.boxes.length});latest.current={phase,running,speed:sim.speed,active,context,total:sim.world.boxes.length};
 useEffect(()=>{setPhase('ready');setElapsed(0);setRunning(false);setProcessTime(0);},[sim.world.runId]);
 useEffect(()=>{setElapsed(0);if(phase==='packing'&&running)sim.play();if(phase==='complete')setRunning(false);},[phase]);
 useEffect(()=>{if(phase!=='packing'||!running||sim.error||!sim.decisionReady)return;if(canRelease(sim.world,sim.motions.length,sim.busy,sim.decision))setPhase('checking');else if(!hasBeltTransit(sim.world)&&!sim.motions.length&&!sim.busy&&sim.decision&&!sim.decision.actions.length)setRunning(false);},[phase,running,sim.world,sim.motions.length,sim.busy,sim.decision,sim.error,sim.decisionReady]);
 useEffect(()=>{if(sim.error||!active){setRunning(false);sim.pause();}},[sim.error,active]);
 useEffect(()=>{let id=0,last=performance.now(),local=0,lastPhase:ProcessPhase='ready';const tick=(now:number)=>{const r=latest.current,dt=Math.min(.1,(now-last)/1000);last=now;if(lastPhase!==r.phase){local=0;lastPhase=r.phase;}if(r.active&&r.running&&!['ready','complete','packing'].includes(r.phase)){local+=dt*r.speed;setElapsed(local);setProcessTime(t=>t+dt*r.speed);if(local>=phaseSeconds(r.phase,r.total,r.context)){setPhase(nextPhase(r.phase));local=0;}}id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[]);
 const duration=phaseSeconds(phase,sim.world.boxes.length,context),progress=duration?Math.min(1,elapsed/duration):0;
 return {phase,elapsed,progress,running,processTime,manifest:manifest(sim.world),
 start:()=>{if(phase==='complete')return;setRunning(true);if(phase==='ready')setPhase('receiving');else if(phase==='packing')sim.play();},
 pause:()=>{setRunning(false);sim.pause();},
 reset:()=>{setRunning(false);setPhase('ready');setElapsed(0);setProcessTime(0);sim.reset();}};
}
