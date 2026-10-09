import { useEffect, useRef, useState } from 'react';
import { cloneBoard, measure } from '../engine/board';
import { supply } from '../engine/supply';
import type { Action, Analysis, Board, Metrics, SearchConfig, Weights } from '../engine/types';
export type RunPoint = { n:number; board:Board; lines:number; holes:number; maxHeight:number; nodes:number; ms:number; tetrises:number };
export type Run = { board:Board; count:number; lines:number; nodes:number; ms:number; metrics:Metrics; ended:'gameover'|'limit'|null; records:RunPoint[]; clearCounts:number[] };
export type Divergence = { n:number; board:Board; actions:(Action|null)[]; scores:(number|null)[] };
const createRuns=(board:Board):Run[]=>[0,1,2].map(()=>({board:cloneBoard(board),count:0,lines:0,nodes:0,ms:0,metrics:measure(board),ended:null,clearCounts:[0,0,0,0,0],records:[{n:0,board:cloneBoard(board),lines:0,holes:measure(board).holes,maxHeight:measure(board).maxHeight,nodes:0,ms:0,tetrises:0}]}));
export function useComparison(initial:Board,seed:number,weights:Weights,beam:SearchConfig) {
  const [runs,setRuns]=useState(()=>createRuns(initial)),[running,setRunning]=useState(false),[limit,setLimit]=useState(200),[divergence,setDivergence]=useState<Divergence|null>(null),[view,setView]=useState<number|null>(null),[stopReason,setStopReason]=useState('준비'),[error,setError]=useState('');
  const latest=useRef(runs),generation=useRef(0),progress=useRef(0),found=useRef(false),worker=useRef<Worker|null>(null);
  latest.current=runs;
  const reset=()=>{worker.current?.terminate();worker.current=null;generation.current++;progress.current=0;found.current=false;setRunning(false);setRuns(createRuns(initial));setDivergence(null);setView(null);setStopReason('준비');setError('');};
  useEffect(()=>{reset();return()=>{worker.current?.terminate();};},[initial,seed,weights,beam.depth,beam.width,beam.strategy]);
  useEffect(()=>{
    if(!running)return;
    const id=++generation.current;
    const instance=new Worker(new URL('../engine/worker.ts',import.meta.url),{type:'module'});worker.current=instance;
    const feed=supply(seed,limit+6);
    let active=latest.current, timer:ReturnType<typeof setTimeout>;
    const dispatch=()=>{
      if(progress.current>=limit || active.every(r=>r.ended)) {setRunning(false);setStopReason(active.every(r=>r.ended==='gameover')?'게임 오버':'설정한 상한 도달');return;}
      const n=progress.current;
      instance.postMessage({id,type:'compare',boards:active.map(r=>r.ended?null:r.board),current:feed[n],next:feed.slice(n+1,n+6),weights,beam:{...beam,algorithm:'beam'}});
    };
    instance.onmessage=e=>{
      if(e.data.id!==generation.current)return;
      if(e.data.error){setError(e.data.error);setRunning(false);return;}
      const analyses=e.data.result as (Analysis|null)[];
      const sameState=active.every(r=>JSON.stringify(r.board)===JSON.stringify(active[0].board));
      const chosen=analyses.map(a=>a?.candidates.find(c=>c.id===a.selectedId));
      if(!found.current&&sameState&&new Set(chosen.map(c=>c?.id??null)).size>1){found.current=true;setDivergence({n:progress.current+1,board:cloneBoard(active[0].board),actions:chosen.map(c=>c?.action??null),scores:chosen.map(c=>c?.immediate??null)});}
      active=active.map((run,i)=>{
        if(run.ended)return run;
        const analysis=analyses[i]!,candidate=chosen[i];
        if(!candidate)return {...run,ended:'gameover',nodes:run.nodes+analysis.evaluated,ms:run.ms+analysis.elapsedMs};
        const count=run.count+1,lines=run.lines+candidate.metrics.lines,nodes=run.nodes+analysis.evaluated,ms=run.ms+analysis.elapsedMs;
        const clearCounts=[...run.clearCounts];if(candidate.metrics.lines>=1&&candidate.metrics.lines<=4)clearCounts[candidate.metrics.lines]++;
        return {...run,board:candidate.board,count,lines,nodes,ms,clearCounts,metrics:candidate.metrics,ended:count>=limit?'limit':null,records:[...run.records,{n:count,board:candidate.board,lines,holes:candidate.metrics.holes,maxHeight:candidate.metrics.maxHeight,nodes,ms,tetrises:clearCounts[4]}]};
      });
      progress.current++;latest.current=active;setRuns(active);timer=setTimeout(dispatch,25);
    };
    instance.onerror=()=>{setError('비교 계산을 시작하지 못했습니다. 다시 실행해 주세요.');setRunning(false);};
    dispatch();return()=>{clearTimeout(timer);instance.terminate();worker.current=null;};
  },[running,limit,seed,weights,beam]);
  return {runs,running,limit,setLimit:(n:number)=>{reset();setLimit(n);},divergence,view,setView,stopReason,error,reset,start:()=>{setView(null);setStopReason('실행 중');setRunning(true);},stop:()=>{generation.current++;setRunning(false);setStopReason('사용자 중지');},progress:progress.current};
}
