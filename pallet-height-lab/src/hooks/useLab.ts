import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloneBoard, emptyBoard } from '../engine/board';
import { replayEvents } from '../engine/narration';
import { supply } from '../engine/supply';
import { SCENARIOS } from '../engine/scenarios';
import { freezeSnapshot } from '../engine/snapshot';
import { DEFAULT_WEIGHTS, type Analysis, type Board, type Candidate, type Piece, type SearchConfig, type Weights } from '../engine/types';
import type { AnalysisRequest } from '../engine/worker';
type Decision = { board: Board; index: number; current: Piece; next: Piece[]; analysis: Analysis; baseline: Analysis | null; weights: Weights; config: SearchConfig; applied: boolean };
export type Mode = 'anatomy' | 'free' | 'compare';
const makeFeed = (seed: number, current: Piece, next: Piece[]) => [current, ...next, ...supply(seed, 240)];
function storedWeights(): Weights { try { const w = JSON.parse(localStorage.getItem('block-lab-weights') ?? 'null'); return w && ['lines','height','holes','bumpiness'].every(k=>Number.isFinite(w[k]) && w[k]>=0 && w[k]<=40) ? w : {...DEFAULT_WEIGHTS}; } catch { return {...DEFAULT_WEIGHTS}; } }
export function useLab() {
  const initial = SCENARIOS[1];
  const [mode,setMode] = useState<Mode>('anatomy');
  const [scenarioId,setScenarioId] = useState(initial.id);
  const [board,setBoard] = useState<Board>(()=>cloneBoard(initial.board));
  const [weights,setWeights] = useState<Weights>(storedWeights);
  const [config,setConfig] = useState<SearchConfig>(initial.config);
  const [seed,setSeed] = useState(42);
  const [feed,setFeed] = useState<Piece[]>(()=>makeFeed(42,initial.current,initial.next));
  const [index,setIndex] = useState(0);
  const [decision,setDecision] = useState<Decision | null>(null);
  const [history,setHistory] = useState<Decision[]>([]);
  const [step,setStep] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [speed,setSpeed] = useState(1);
  const [continuous,setContinuous] = useState(false);
  const [fast,setFast] = useState(false);
  const [editing,setEditing] = useState(false);
  const [custom,setCustom] = useState(false);
  const [branch,setBranch] = useState(false);
  const [busy,setBusy] = useState(true);
  const [error,setError] = useState('');
  const [previewId,setPreviewId] = useState<string | null>(null);
  const [autoPreviewId,setAutoPreviewId]=useState<string|null>(null);
  const [pins,setPins] = useState<string[]>([]);
  const [treeNodeId,setTreeNodeId] = useState<string | null>(null);
  const [replaySeconds,setReplaySeconds] = useState(0);
  const [revision,setRevision] = useState(0);
  const [weightFeedback,setWeightFeedback] = useState('');
  const previousSelection=useRef<{state:string;weights:string;selectedId:string|null}|null>(null);
  const requestId = useRef(0), appliedIds = useRef(new Set<string>());
  const current = feed[index] ?? 'T', next = feed.slice(index+1,index+6);
  const scenario = SCENARIOS.find(s=>s.id===scenarioId)!;
  const invalidate = useCallback(()=>{ setPlaying(false); setResume(false); setDecision(null); setStep(0); setPreviewId(null); setTreeNodeId(null); setPins([]); setReplaySeconds(0); setHistory([]); appliedIds.current.clear(); setBusy(true); setError(''); setRevision(v=>v+1); },[]);
  useEffect(()=>{
    setPlaying(false); setBusy(true); setDecision(null);
    const id = ++requestId.current;
    const worker = new Worker(new URL('../engine/worker.ts',import.meta.url),{type:'module'});
    const timeout = window.setTimeout(()=>{
      const request: AnalysisRequest = {id,type:'analysis',board,current,next,weights,config};
      worker.postMessage(request);
    },150);
    worker.onmessage = event => {
      if (event.data.id !== requestId.current) return;
      setBusy(false);
      if (event.data.error) {setError(event.data.error); return;}
      const analysis: Analysis = freezeSnapshot(event.data.result);
      const signature=JSON.stringify({board,current,next,config}),weightSignature=JSON.stringify(weights),previous=previousSelection.current;
      setWeightFeedback(previous&&previous.state===signature&&previous.weights!==weightSignature?(previous.selectedId===analysis.selectedId?'점수는 변했지만 선택은 같습니다.':'가중치가 바뀌어 다른 후보를 선택했습니다.'):'');
      previousSelection.current={state:signature,weights:weightSignature,selectedId:analysis.selectedId};
      setDecision(freezeSnapshot({board:cloneBoard(board),index,current,next:[...next],weights:{...weights},config:{...config},analysis,baseline:event.data.baseline??null,applied:false}));
      setPreviewId(null); setTreeNodeId(null); setPins([]); setStep(0); setReplaySeconds(0);
    };
    worker.onerror = () => { if(id===requestId.current) {setBusy(false); setError('탐색 계산을 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요.');} };
    return ()=>{clearTimeout(timeout); worker.terminate();};
    // Applied game state is intentionally not a dependency. A new decision requires an explicit advance.
  },[revision,weights,config]);
  useEffect(()=>{try{localStorage.setItem('block-lab-weights',JSON.stringify(weights));}catch{}},[weights]);
  const events = useMemo(()=>decision ? replayEvents(decision.board,decision.current,decision.analysis,decision.config,decision.weights,scenarioId) : [],[decision,scenarioId]);
  const analysis = decision?.analysis;
  const selected = analysis?.candidates.find(c=>c.id===analysis.selectedId);
  const preview = analysis?.candidates.find(c=>c.id===(previewId ?? (step===2?autoPreviewId:null) ?? events[step]?.candidateId)) ?? selected;
  useEffect(()=>{
    if(step!==2){setAutoPreviewId(null);return;}
    if(!playing||fast||!events[2]?.sequence.length)return;
    const sequence=events[2].sequence,duration=1800/speed;
    setAutoPreviewId(sequence[0]);
    const timers=sequence.slice(1).map((id,i)=>setTimeout(()=>setAutoPreviewId(id),duration*(i+1)/sequence.length));
    return()=>timers.forEach(clearTimeout);
  },[step,playing,fast,speed,events]);
  const treeNode = analysis?.nodes.find(n=>n.id===treeNodeId);
  const commit = useCallback(()=>{
    if(!decision || !selected) return;
    const key = `${revision}:${decision.index}`;
    if(appliedIds.current.has(key)) return;
    appliedIds.current.add(key);
    if(decision.index+7>=feed.length)setFeed(f=>[...f,...supply(seed,f.length+224).slice(f.length-6)]);
    setBoard(cloneBoard(selected.board)); setIndex(decision.index+1);
    setDecision({...decision,applied:true});
    setHistory(h=>[...h,{...decision,applied:true}].slice(-40));
  },[decision,selected,revision,feed.length,seed]);
  const seek = useCallback((s:number)=>{setPlaying(false); setResume(false); setStep(Math.max(0,Math.min(7,s))); setPreviewId(null); setTreeNodeId(null); if(s>=7) commit();},[commit]);
  const advance = useCallback(()=>{
    if(!decision || !selected) {setPlaying(false); return;}
    commit(); setStep(0); setPreviewId(null); setTreeNodeId(null); setPins([]); setRevision(v=>v+1);
  },[decision,selected,commit]);
  const advanceRef = useRef(advance); advanceRef.current = advance;
  useEffect(()=>{
    if(!playing || busy || !decision) return;
    const duration = (fast ? 160 : 1800) / speed;
    const timer = setTimeout(()=>{
      setReplaySeconds(t=>t+duration/1000);
      if(fast || step===7) {
        commit();
        if(continuous) { advanceRef.current(); /* resume after asynchronous analysis */ setResume(true); }
        else {setStep(7); setPlaying(false);}
      } else {setStep(step+1); setPreviewId(null); setTreeNodeId(null); if(step+1===7) commit();}
    },duration);
    return ()=>clearTimeout(timer);
  },[playing,busy,decision,step,speed,fast,continuous,commit]);
  const [resume,setResume] = useState(false);
  useEffect(()=>{if(resume && !busy && decision){setResume(false); if(decision.analysis.selectedId) setPlaying(true);}},[resume,busy,decision]);
  useEffect(()=>{
    const keyboard=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement)?.closest('input,select,textarea,button,[contenteditable="true"]')) return;
      if(mode==='compare' || editing) return;
      if(e.code==='Space'){e.preventDefault();if(resume){setResume(false);setPlaying(false);}else if(!busy && selected) setPlaying(p=>!p);}
      if(e.code==='ArrowRight'){e.preventDefault();seek(step+1);}
      if(e.code==='ArrowLeft'){e.preventDefault();seek(step-1);}
    }; window.addEventListener('keydown',keyboard); return ()=>window.removeEventListener('keydown',keyboard);
  },[step,seek,busy,selected,mode,editing,resume]);
  const chooseScenario=(id:string)=>{
    const s=SCENARIOS.find(s=>s.id===id)!;
    invalidate(); setResume(false); setScenarioId(id); setBoard(cloneBoard(s.board)); setFeed(makeFeed(seed,s.current,s.next)); setIndex(0); setWeights({...s.weights}); setConfig({...s.config}); setCustom(false);setBranch(false);setEditing(false);
  };
  const updateWeights=(w:Weights)=>{invalidate();setResume(false);setWeights(w);};
  const updateConfig=(c:SearchConfig)=>{invalidate();setResume(false);setConfig(c);};
  const editBoard=(b:Board)=>{invalidate();setBoard(b);setCustom(true);setBranch(false);};
  const changePiece=(offset:number,piece:Piece)=>{invalidate(); const source=[...feed];source[index+offset]=piece;setFeed(source);setCustom(true);};
  const changeSeed=(s:number)=>{invalidate();setSeed(s);setFeed(makeFeed(s,current,next));setIndex(0);};
  const chooseBranch=(candidate:Candidate)=>{if(!decision)return; invalidate();setBoard(cloneBoard(candidate.board));setIndex(decision.index+1);setBranch(true);setCustom(true);setEditing(false);};
  const pin=(id:string)=>setPins(p=>p.includes(id)?p.filter(x=>x!==id):[...p.slice(-1),id]);
  const rewind=()=>{setPlaying(false);setResume(false);setStep(0);setPreviewId(null);setTreeNodeId(null);setReplaySeconds(0);};
  return { mode,setMode:(m:Mode)=>{setPlaying(false);setResume(false);setEditing(false);setMode(m);},scenario,scenarioId,chooseScenario,
    board,weights,updateWeights,weightFeedback,config,updateConfig,seed,changeSeed,current,next,index,feed,decision,analysis,selected,preview,events,step,seek,
    playing:playing||resume,setPlaying:(value:boolean)=>{setResume(false);setPlaying(value);},speed,setSpeed,continuous,setContinuous,fast,setFast,editing,setEditing,custom,branch,busy,error,pins,pin,previewId,
    setPreviewId:(id:string)=>{setPreviewId(id);setTreeNodeId(null);setPlaying(false);},treeNode,setTreeNodeId:(id:string|null)=>{setTreeNodeId(id);setPlaying(false);},
    advance,rewind,editBoard,changePiece,chooseBranch,history,replaySeconds,clear:()=>editBoard(emptyBoard()),restore:()=>chooseScenario(scenarioId),
    load:(b:Board,w:Weights,c:SearchConfig,s:number,p:Piece,n:Piece[],source?:{pieces:Piece[];index:number})=>{invalidate();setResume(false);setBoard(b);setWeights(w);setConfig(c);setSeed(s);setFeed(source?[...source.pieces]:makeFeed(s,p,n));setIndex(source?.index??0);setCustom(true);setBranch(false);setEditing(false);setMode('free');}
  };
}
export type Lab = ReturnType<typeof useLab>;
