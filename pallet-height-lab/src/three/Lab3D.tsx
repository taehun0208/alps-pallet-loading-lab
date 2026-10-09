import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Scene3D } from './Scene3D';
import { DEFAULT_CONFIG3D, DEFAULT_WEIGHTS3D, PIECES3D, PIECE_NAMES3D, candidates3D, index3D, measure3D, orientationKey3D, orientations3D, rotate3D, scenario3D, shaftReady3D, supply3D, validateBoard3D, type Analysis3D, type Axis3D, type Board3D, type Candidate3D, type Config3D, type Piece3D, type Scenario3D, type Weights3D } from './engine';
import './three.css';

const EMPTY_ROWS:number[]=[];
const scenarios:{id:Scenario3D;title:string;description:string}[]=[
  {id:'shaft',title:'I 블록으로 4면 삭제',description:'한 칸의 세로 샤프트를 비워 둔 상태'},
  {id:'empty',title:'빈 공간부터 쌓기',description:'AI가 바닥부터 공간을 채우는 과정'},
  {id:'terrain',title:'울퉁불퉁한 표면',description:'가로·깊이 굴곡을 동시에 줄이기'},
  {id:'cavity',title:'층 안에 숨은 구멍',description:'겉에서 보이지 않는 빈칸 관찰'},
];
const pieceTokens:Record<Piece3D,string>={I:'I',O:'O',T:'T',L:'L',S:'S',V:'gold',R:'J',C:'Z'};
interface World {board:Board3D;index:number;planes:number;reward:number;custom:boolean;log:{piece:Piece3D;planes:number;q:number|null}[]}
const newWorld=(scenario:Scenario3D,size:number):World=>({board:scenario3D(scenario,size,size,size===4?10:size===6?14:12),index:0,planes:0,reward:0,custom:false,log:[]});
const score=(n:number|null)=>n===null?'미완료':n<=-1e8?'막힌 경로':n.toFixed(1);
export function PieceMini3D({piece,rotation=0}:{piece:Piece3D;rotation?:number}){
  const cells=[...(orientations3D(piece)[rotation]??orientations3D(piece)[0])].sort((a,b)=>a[1]-b[1]||a[0]+a[2]-b[0]-b[2]);
  const points=cells.map(([x,y,z])=>[(x-z)*12,(x+z)*6-y*14]);const minX=Math.min(...points.map(p=>p[0]))-13,maxX=Math.max(...points.map(p=>p[0]))+13,minY=Math.min(...points.map(p=>p[1]))-8,maxY=Math.max(...points.map(p=>p[1]))+22;
  return <svg className="three-piece-mini" viewBox={`${minX} ${minY} ${maxX-minX} ${maxY-minY}`} aria-hidden="true" style={{'--piece-color':`var(--color-${pieceTokens[piece]})`} as React.CSSProperties}>{points.map(([x,y],i)=><g key={i}><polygon className="cube-top" points={`${x},${y-6} ${x+12},${y} ${x},${y+6} ${x-12},${y}`}/><polygon className="cube-left" points={`${x-12},${y} ${x},${y+6} ${x},${y+20} ${x-12},${y+14}`}/><polygon className="cube-right" points={`${x},${y+6} ${x+12},${y} ${x+12},${y+14} ${x},${y+20}`}/></g>)}</svg>;
}
export default function Lab3D(){
  const [scenario,setScenario]=useState<Scenario3D>('shaft'),[size,setSize]=useState(5),[seed,setSeed]=useState(42),[world,setWorld]=useState<World>(()=>newWorld('shaft',5));
  const [config,setConfig]=useState<Config3D>({...DEFAULT_CONFIG3D}),[weights,setWeights]=useState<Weights3D>({...DEFAULT_WEIGHTS3D});
  const [analysis,setAnalysis]=useState<Analysis3D|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[mode,setMode]=useState<'ai'|'manual'>('ai');
  const [override,setOverride]=useState<Piece3D|null>(null),[manual,setManual]=useState({rotation:0,x:0,z:0}),[previewId,setPreviewId]=useState<string|null>(null);
  const [slice,setSlice]=useState(0),[cut,setCut]=useState(false),[holes,setHoles]=useState(false),[editing,setEditing]=useState(false),[json,setJson]=useState('');
  const [cameraView,setCameraView]=useState('iso'),[cameraVersion,setCameraVersion]=useState(0);
  const [dropping,setDropping]=useState<{candidate:Candidate3D;started:number}|null>(null),[clearing,setClearing]=useState(false);
  const locked=useRef(false),timers=useRef<ReturnType<typeof setTimeout>[]>([]),history=useRef<World[]>([]);
  const feed=useMemo(()=>scenario==='shaft'?['I' as Piece3D,...supply3D(seed)]:supply3D(seed),[scenario,seed]);
  const current=override??feed[world.index],next=useMemo(()=>feed.slice(world.index+1,world.index+4),[feed,world.index]);
  const metrics=useMemo(()=>measure3D(world.board),[world.board]);
  const manualCandidates=useMemo(()=>mode==='manual'?candidates3D(world.board,current,weights,config.strategy):[],[mode,world.board,current,weights,config.strategy]);
  const selected=mode==='manual'?manualCandidates.find(c=>c.action.rotation===manual.rotation&&c.action.x===manual.x&&c.action.z===manual.z)??null:
    analysis?.candidates.find(c=>c.id===(previewId??analysis.selectedId))??null;
  const preview=dropping?.candidate??selected;
  const cancelDrop=()=>{timers.current.forEach(clearTimeout);timers.current=[];locked.current=false;setDropping(null);setClearing(false);};
  useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
  useEffect(()=>{
    setBusy(true);setAnalysis(null);setPreviewId(null);setError('');let worker:Worker|undefined,active=true;
    const timer=setTimeout(()=>{
      worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=event=>{if(!active)return;if(event.data.error){setError(event.data.error);setPlaying(false);}else setAnalysis(event.data.result);setBusy(false);};
      worker.onerror=()=>{if(active){setError('3D 탐색을 실행하지 못했습니다. 새로고침 후 다시 시도해 주세요.');setBusy(false);setPlaying(false);}};
      worker.postMessage({board:world.board,piece:current,next,weights,config});
    },120);
    return()=>{active=false;clearTimeout(timer);worker?.terminate();};
  },[world.board,current,next,weights,config]);
  useEffect(()=>{setManual({rotation:0,x:0,z:0});},[current,world.board.width,world.board.depth]);
  function remember(){history.current.push(world);history.current=history.current.slice(-50);}
  function reset(nextScenario=scenario,nextSize=size){cancelDrop();setPlaying(false);setScenario(nextScenario);setSize(nextSize);setWorld(newWorld(nextScenario,nextSize));setOverride(null);setSlice(0);setEditing(false);history.current=[];}
  function apply(candidate=selected){
    if(!candidate||locked.current||busy||editing||world.index>=998)return;
    locked.current=true;remember();setDropping({candidate,started:performance.now()});setClearing(false);
    const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?130:560;
    if(candidate.cleared.length)timers.current.push(setTimeout(()=>setClearing(true),duration));
    timers.current.push(setTimeout(()=>{
      setWorld({...world,board:candidate.board,index:world.index+1,planes:world.planes+candidate.cleared.length,reward:world.reward+candidate.reward,
        log:[{piece:current,planes:candidate.cleared.length,q:candidate.q},...world.log].slice(0,8)});
      setOverride(null);setPreviewId(null);setDropping(null);setClearing(false);locked.current=false;timers.current=[];
    },duration+(candidate.cleared.length?430:80)));
  }
  useEffect(()=>{
    if(!playing||busy||dropping||editing||mode!=='ai')return;
    const chosen=analysis?.candidates.find(c=>c.id===analysis.selectedId);
    if(!chosen||world.index>=998){setPlaying(false);return;}
    const timer=setTimeout(()=>apply(chosen),1000/speed);return()=>clearTimeout(timer);
  },[playing,busy,dropping,editing,mode,analysis,world.index,speed]);
  function rotate(axis:Axis3D){
    const rotated=rotate3D(orientations3D(current)[manual.rotation]??orientations3D(current)[0],axis),rotation=orientations3D(current).findIndex(c=>orientationKey3D(c)===orientationKey3D(rotated));
    const maxX=Math.max(...rotated.map(c=>c[0])),maxZ=Math.max(...rotated.map(c=>c[2]));
    setManual({rotation,x:Math.min(manual.x,world.board.width-maxX-1),z:Math.min(manual.z,world.board.depth-maxZ-1)});
  }
  const manualCells=orientations3D(current)[manual.rotation]??orientations3D(current)[0],xMax=world.board.width-1-Math.max(...manualCells.map(c=>c[0])),zMax=world.board.depth-1-Math.max(...manualCells.map(c=>c[2]));
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if((event.target as HTMLElement).closest('input,select,textarea,button,a')||event.ctrlKey||event.metaKey||event.altKey||dropping||editing)return;
      if(mode==='manual'){
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setManual(m=>({...m,x:Math.max(0,Math.min(xMax,m.x+(event.key==='ArrowLeft'?-1:1)))}));}
        else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();setManual(m=>({...m,z:Math.max(0,Math.min(zMax,m.z+(event.key==='ArrowUp'?-1:1)))}));}
        else if(['q','w','e'].includes(event.key.toLowerCase())){event.preventDefault();rotate(({q:'x',w:'y',e:'z'} as const)[event.key.toLowerCase() as 'q'|'w'|'e']);}
        else if(event.code==='Space'){event.preventDefault();apply();}
      }else if(event.code==='Space'){event.preventDefault();if(!busy&&selected)setPlaying(p=>!p);}
    };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[mode,manual,current,xMax,zMax,dropping,editing,busy,selected]);
  function editCell(x:number,z:number){if(!editing||dropping)return;remember();const b={...world.board,cells:[...world.board.cells]},i=index3D(b,x,slice,z);b.cells[i]=b.cells[i]?0:9;setWorld({...world,board:b,custom:true});}
  function importBoard(){try{const value=JSON.parse(json);if(value.dimension!==3||value.version!==1)throw new Error('version: 1, dimension: 3인 보드 JSON이 필요합니다.');
    const b=validateBoard3D(value.board);if(value.piece!==undefined&&!PIECES3D.includes(value.piece))throw new Error('블록 종류가 올바르지 않습니다.');
    cancelDrop();setPlaying(false);remember();setWorld({...world,board:b,custom:true});setSlice(0);if(value.piece)setOverride(value.piece);setError('');
  }catch(e){setError(e instanceof Error?e.message:'JSON을 읽을 수 없습니다.');}}
  const displayedBoard=clearing&&dropping?dropping.candidate.beforeClear:world.board,displayedPreview=clearing?null:preview;
  const ghostCells=displayedPreview?orientations3D(displayedPreview.action.piece)[displayedPreview.action.rotation].map(([x,y,z])=>[x+displayedPreview.action.x,y+displayedPreview.action.y,z+displayedPreview.action.z]):[];
  const layerFilled=displayedBoard.cells.slice(slice*world.board.width*world.board.depth,(slice+1)*world.board.width*world.board.depth).filter(Boolean).length;
  const disabled=!!dropping||playing;
  return <div className="three-lab">
    <header className="three-header"><a className="three-brand" href="#" aria-label="2D 연구실로 돌아가기"><span className="three-brand-cube">◈</span><span>블록 AI 연구실<small>TETRIS AI LAB</small></span></a><nav aria-label="차원 선택"><a href="#">2D 연구실</a><a href="#3d" aria-current="page">3D 시뮬레이터 <span>3D</span></a><a href="#pallet">박스 적재</a></nav><div className="three-header-state"><i className={playing?'active':''}/>{busy?'탐색 중':dropping?'배치 중':playing?'자동 재생':'일시정지'}</div></header>
    <main className="three-main"><div className="three-heading"><div><h1>줄에서 면으로, 생각을 확장하세요.</h1><p>회전은 세 축으로, 배치는 가로와 깊이로. AI의 선택을 공간 안에서 관찰합니다.</p></div><span className="three-rule-tag">수평면 삭제 · 수직 낙하</span></div>
      <div className="three-layout">
        <aside className="three-settings panel">
          <section><h2>실험 조건</h2><label className="three-field">보드 크기<select aria-label="3D 보드 크기" value={size} disabled={disabled} onChange={e=>reset(scenario,+e.target.value)}><option value="4">4 × 4 × 10</option><option value="5">5 × 5 × 12</option><option value="6">6 × 6 × 14</option></select></label>
            <div className="three-scenarios">{scenarios.map(s=><button key={s.id} disabled={disabled} className={s.id===scenario?'active':''} onClick={()=>reset(s.id)}><strong>{s.title}</strong><small>{s.description}</small></button>)}</div>
            <label className="three-field three-seed">시드<input aria-label="3D 시드" type="number" min="0" max="4294967295" value={seed} disabled={disabled} onChange={e=>{setSeed(Math.max(0,Math.min(4294967295,Math.floor(+e.target.value))));reset();}}/></label>
          </section>
          <section><h2>탐색 알고리즘</h2><select aria-label="3D 알고리즘" value={config.algorithm} disabled={disabled} onChange={e=>setConfig({...config,algorithm:e.target.value as Config3D['algorithm']})}><option value="greedy">Greedy · 지금 한 수</option><option value="two">2-ply · 다음 한 수 전수 탐색</option><option value="beam">Beam · 남길 경로 선택</option></select>
            {config.algorithm==='beam'&&<div className="three-two-fields"><label>깊이<select aria-label="3D 탐색 깊이" value={config.depth} disabled={disabled} onChange={e=>setConfig({...config,depth:+e.target.value})}>{[1,2,3].map(n=><option key={n} value={n}>{n}수</option>)}</select></label><label>폭 K<select aria-label="3D 빔 폭" value={config.width} disabled={disabled} onChange={e=>setConfig({...config,width:+e.target.value})}>{[1,4,8,16].map(n=><option key={n}>{n}</option>)}</select></label></div>}
            <label className="three-field">쌓기 전략<select aria-label="3D 쌓기 전략" value={config.strategy} disabled={disabled} onChange={e=>setConfig({...config,strategy:e.target.value as Config3D['strategy']})}><option value="balanced">균형 있게 채우기</option><option value="shaft">모서리 샤프트 유지</option></select></label>
            <p className="three-hint">샤프트는 (x={world.board.width-1}, z={world.board.depth-1})의 세로 한 칸입니다. I 블록을 세워 여러 면을 한 번에 지울 수 있습니다.</p>
          </section>
          <section><div className="three-section-title"><h2>평가 가중치</h2><button disabled={disabled} className="three-text-button" onClick={()=>setWeights({...DEFAULT_WEIGHTS3D})}>기본값</button></div>
            {([{key:'height',label:'평균 높이',max:5,step:.1},{key:'holes',label:'수직 구멍',max:20,step:1},{key:'roughness',label:'표면 굴곡',max:5,step:.1},{key:'planes',label:'면 삭제 보상',max:40,step:1},...(config.strategy==='shaft'?[{key:'shaft',label:'샤프트 유지',max:10,step:.5}]:[])] as {key:keyof Weights3D;label:string;max:number;step:number}[]).map(w=><label className="three-weight" key={w.key}><span>{w.label}<b>{weights[w.key]}</b></span><input aria-label={`3D ${w.label} 가중치`} type="range" min="0" max={w.max} step={w.step} disabled={disabled} value={weights[w.key]} onChange={e=>setWeights({...weights,[w.key]:+e.target.value})}/></label>)}
          </section>
        </aside>
        <section className="three-stage panel"><div className="three-stage-heading"><div><i className="status-dot active-dot"/><strong>{clearing?'완성된 수평면 · 삭제 직전':dropping?'선택한 블록 낙하 중':'3D 공간 보드'}</strong>{world.custom&&<span>사용자 실험</span>}</div><span className="three-dimensions">{world.board.width} × {world.board.depth} × {world.board.height}</span></div>
          <div className="three-transport"><div className="three-control-mode"><button className={mode==='ai'?'active':''} disabled={disabled} onClick={()=>{setMode('ai');setEditing(false);}}>AI 선택</button><button className={mode==='manual'?'active':''} disabled={disabled} onClick={()=>{setMode('manual');setPlaying(false);setEditing(false);}}>직접 배치</button></div><div className="three-play-actions"><button className="three-play" disabled={!playing&&(busy||!selected||!!dropping||editing||mode==='manual')} onClick={()=>{setPreviewId(null);setPlaying(p=>!p);}}><Icon name={playing?'pause':'play'} size={16}/>{playing?'일시정지':'자동 재생'}</button><button disabled={busy||playing||!!dropping||editing||!selected} onClick={()=>apply()}><Icon name="skip" size={15}/>한 수 놓기</button><button className="three-icon-button" aria-label="3D 한 수 되돌리기" title="한 수 되돌리기" disabled={disabled||history.current.length===0} onClick={()=>{cancelDrop();setWorld(history.current.pop()!);setOverride(null);}}><Icon name="back" size={16}/></button><button className="three-icon-button" aria-label="3D 실험 초기화" title="실험 초기화" disabled={!!dropping} onClick={()=>reset()}><Icon name="reset" size={16}/></button></div></div>
          <div className="three-view-frame"><div className="three-camera-controls" aria-label="카메라 시점">{[{id:'iso',label:'입체'},{id:'top',label:'위에서'},{id:'front',label:'정면'}].map(v=><button key={v.id} aria-pressed={cameraView===v.id} className={cameraView===v.id?'active':''} onClick={()=>{setCameraView(v.id);setCameraVersion(v=>v+1);}}>{v.label}</button>)}<button aria-label="카메라 초기화" title="카메라 초기화" onClick={()=>{setCameraView('iso');setCameraVersion(v=>v+1);}}><Icon name="reset" size={15}/></button></div>
          <Scene3D board={displayedBoard} preview={displayedPreview} slice={slice} cut={cut} holes={holes} shaft={config.strategy==='shaft'} clearRows={clearing&&dropping?dropping.candidate.cleared:EMPTY_ROWS} dropStarted={dropping?.started??null} cameraView={cameraView} cameraVersion={cameraVersion}/>
          {busy&&<div className="three-search-indicator" role="status"><span className="loading-bars"><i/><i/><i/></span>회전 · x · z 후보 계산 중</div>}
          </div><div className="three-legend"><span><i className="existing"/>쌓인 블록</span><span><i className="preview"/>착지 미리보기</span><span><i className="shaft"/>샤프트</span><label><input type="checkbox" checked={holes} onChange={e=>setHoles(e.target.checked)}/>구멍 표시</label></div>
          <div className="three-world-stats" aria-label="실제 보드 통계"><div><span>놓은 블록</span><b data-testid="three-placed">{world.index}</b></div><div><span>지운 면</span><b data-testid="three-cleared">{world.planes}</b></div><div><span>최고 높이</span><b>{metrics.maxHeight}<small> / {world.board.height}</small></b></div><div><span>수직 구멍</span><b data-testid="three-holes">{metrics.holes}</b></div></div>
          <div className="three-queue"><div className="three-current"><PieceMini3D piece={current} rotation={mode==='manual'?manual.rotation:preview?.action.rotation??0}/><span><small>현재 블록</small><b>{current} · {PIECE_NAMES3D[current]}</b><small>{orientations3D(current).length}가지 고유 회전</small></span></div><div className="three-next"><span>NEXT <small>공개된 3개</small></span>{next.map((p,i)=><div key={i}><PieceMini3D piece={p}/><small>{p}</small></div>)}</div></div>
          {mode==='manual'&&<div className="three-manual"><div className="three-manual-top"><label>블록<select aria-label="직접 배치 블록" value={current} disabled={disabled} onChange={e=>{setOverride(e.target.value as Piece3D);setWorld({...world,custom:true});}}>{PIECES3D.map(p=><option key={p} value={p}>{p} · {PIECE_NAMES3D[p]}</option>)}</select></label><div><span>90° 회전</span><div className="three-rotation-buttons">{(['x','y','z'] as const).map((axis,i)=><button disabled={disabled} key={axis} aria-label={`${axis.toUpperCase()}축 회전`} onClick={()=>rotate(axis)}>{axis.toUpperCase()}<small>{['Q','W','E'][i]}</small></button>)}</div></div></div><div className="three-two-fields"><label>x · 가로 <b>{manual.x}</b><input aria-label="직접 배치 x" type="range" min="0" max={xMax} value={manual.x} disabled={disabled} onChange={e=>setManual({...manual,x:+e.target.value})}/></label><label>z · 깊이 <b>{manual.z}</b><input aria-label="직접 배치 z" type="range" min="0" max={zMax} value={manual.z} disabled={disabled} onChange={e=>setManual({...manual,z:+e.target.value})}/></label></div><p className="three-hint">방향키: x·z 이동 · Q/W/E: 축 회전 · Space: 놓기</p>{!selected&&<p role="status" className="three-warning">이 위치로는 상단에서 낙하할 수 없습니다. 회전 또는 위치를 바꿔 주세요.</p>}</div>}
          <div className="three-play-foot"><span>{mode==='ai'?'회전과 x·z를 결정한 뒤 수직 낙하':'상공에서 위치·회전을 정하는 직접 배치'}</span><label>재생 속도<select aria-label="3D 재생 속도" value={speed} onChange={e=>setSpeed(+e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label></div>
        </section>
        <aside className="three-inspector">
          <section className="three-slice panel"><div className="three-section-title"><h2>층별 단면</h2><span className="three-mono">y = {slice}</span></div><p>내부의 빈칸과 미리보기 위치를 확인하세요.</p><div className="three-slice-toolbar"><label>층<input aria-label="3D 단면 층" type="range" min="0" max={world.board.height-1} value={slice} onChange={e=>setSlice(+e.target.value)}/></label><span>{slice+1}층 / {world.board.height}</span></div>
            <div className="three-slice-grid" style={{gridTemplateColumns:`repeat(${world.board.width},minmax(0,1fr))`}} aria-label={`${slice+1}층 수평면`}>
              {Array.from({length:world.board.depth},(_,z)=>Array.from({length:world.board.width},(_,x)=>{
                const value=displayedBoard.cells[index3D(displayedBoard,x,slice,z)],ghost=ghostCells.some(c=>c[0]===x&&c[1]===slice&&c[2]===z),shaft=config.strategy==='shaft'&&x===world.board.width-1&&z===world.board.depth-1;
                return <button key={`${x}:${z}`} className={`${value?'filled':''} ${ghost?'ghost':''} ${shaft?'shaft':''}`} style={value?{'--cell-color':`var(--color-${value===9?'existing':pieceTokens[PIECES3D[value-1]]})`} as React.CSSProperties:undefined} aria-label={`셀 x=${x} y=${slice} z=${z} ${value?'채움':'비움'}${ghost?' 착지 미리보기':''}`} disabled={!editing||!!dropping} onClick={()=>editCell(x,z)}>{ghost?'◇':shaft?'·':''}</button>;
              }))}
            </div><div className="three-slice-labels"><span>x → 가로 · z ↓ 깊이</span><b>{layerFilled} / {world.board.width*world.board.depth}칸</b></div>
            <label className="three-checkbox"><input type="checkbox" checked={cut} onChange={e=>setCut(e.target.checked)}/>선택한 층 위를 잘라 보기</label>
            <label className="three-checkbox"><input type="checkbox" checked={editing} disabled={disabled} onChange={e=>{setEditing(e.target.checked);setPlaying(false);}}/>이 층 직접 편집</label>{editing&&<p className="three-hint">단면의 칸을 누르면 큐브를 채우거나 지웁니다. 되돌리기로 복구할 수 있습니다.</p>}
          </section>
          <section className="three-evaluation panel"><div className="three-section-title"><h2>착지 후보의 평가</h2><span className="three-mono">{config.algorithm==='greedy'?'F + R':'Q'}</span></div>{preview?<><div className="three-score"><strong data-testid="three-score">{score(mode==='manual'?preview.immediate:preview.q)}</strong><span>{mode==='manual'?'한 수 평가':analysis?.depth===1?'한 수 평가':'미래 포함 경로 점수'}</span></div><div className="three-placement">회전 {preview.action.rotation+1} · x={preview.action.x} · z={preview.action.z} · y={preview.action.y}</div><dl className="three-score-terms">{[{key:'height',label:'평균 높이'},{key:'holes',label:'수직 구멍'},{key:'roughness',label:'두 방향 굴곡'},{key:'shaft',label:'샤프트 유지'},{key:'danger',label:'상단 위험'}].map(t=><div key={t.key}><dt>{t.label}</dt><dd>{score(preview.terms[t.key as keyof typeof preview.terms])}</dd></div>)}<div className="three-score-sum"><dt>보드 평가 F</dt><dd>{score(preview.f)}</dd></div><div><dt>면 삭제 보상 R <small>{preview.cleared.length}면</small></dt><dd className="three-accent">+{score(preview.reward)}</dd></div></dl><p className="three-hint">Q = 경로의 삭제 보상 합 + 마지막 보드 평가. 다른 깊이의 점수를 직접 비교하면 안 됩니다.</p>{preview.path.length>1&&<div className="three-path" aria-label="선택한 미래 경로">{preview.path.map((a,i)=><span key={i}>{i+1}수 <b>{a.piece}</b><small>x{a.x} z{a.z}</small></span>)}</div>}</>:<p className="three-hint">{busy?'배치 후보를 계산하고 있습니다.':'현재 선택에 가능한 착지가 없습니다.'}</p>}</section>
        </aside>
        <section className="three-candidates panel"><div className="three-section-title"><h2>AI가 비교한 착지</h2><span className="three-search-summary" data-testid="three-search-summary">{analysis?`${analysis.candidates.length}개 첫 수 · ${analysis.nodes.toLocaleString()}개 탐색 · ${analysis.milliseconds.toFixed(0)} ms`:'계산 중'}</span></div><p>고유 회전 × x 위치 × z 위치를 생성한 뒤 충돌 없는 착지만 평가합니다.{config.algorithm==='beam'?' Beam은 매 깊이 전체 후보에서 상위 K개 경로를 남깁니다.':''}</p><div className="three-candidate-list">{analysis?.candidates.slice(0,6).map((c,i)=><button key={c.id} disabled={disabled||mode==='manual'||editing} className={`${c.id===analysis.selectedId?'chosen':''} ${c.id===preview?.id?'previewed':''}`} onClick={()=>setPreviewId(c.id)} aria-label={`3D 후보 ${i+1} 회전 ${c.action.rotation+1} x ${c.action.x} z ${c.action.z}`}><span className="three-candidate-top"><small>{c.id===analysis.selectedId?'AI 선택':`후보 ${i+1}`}</small><b>{score(c.q)}</b></span><div><PieceMini3D piece={c.action.piece} rotation={c.action.rotation}/><span>x={c.action.x} z={c.action.z}<small>회전 {c.action.rotation+1}</small></span></div><span className="three-candidate-bottom">삭제 {c.cleared.length}면 · 구멍 {c.metrics.holes}</span></button>)}</div>{analysis&&<p className="three-hint">깊이 {analysis.depth}수{config.algorithm==='beam'?` · 잘라낸 경로 ${analysis.pruned.toLocaleString()}개 · ‘미완료’는 설정한 깊이까지 탐색하지 않은 후보`:''} · 시간은 이 기기의 실제 계산값입니다.</p>}{!busy&&analysis&&!analysis.selectedId&&<p role="status" className="three-warning">게임 오버 · 현재 블록을 놓을 공간이 없습니다. 되돌리거나 새 실험을 시작하세요.</p>}</section>
        <section className="three-lesson panel"><div><h2>2D 알고리즘은 무엇이 바뀌나요?</h2><p>2D의 열 높이는 3D의 <b>높이 지도 h(x,z)</b>가 됩니다. 굴곡은 x·z 두 방향에서 이웃 높이 차이를 더하고, 구멍은 같은 (x,z) 열의 큐브 아래 빈칸으로 셉니다. 높이와 굴곡은 바닥 크기로 정규화합니다.</p><p>2D의 우물은 3D의 <b>세로 샤프트</b>로 확장했습니다. 지금 보드에 준비된 면은 <b data-testid="three-shaft-ready">{shaftReady3D(world.board)}개</b>입니다. 폭 한 칸을 비워 놓고 I 블록을 세우면 최대 4개 면을 한 번에 지웁니다.</p></div><div><h3>이 시뮬레이터의 규칙</h3><ul><li>큐브 4개로 이루어진 8종 블록 · 세 축 90° 회전</li><li>수평면의 모든 칸이 차면 삭제, 위의 면은 아래로 이동</li><li>상공에서 회전·x·z를 정한 뒤 수직 낙하</li><li>HOLD·벽차기·착지 후 슬라이드 없이 공개 NEXT만 탐색</li></ul><p>Blockout의 3D 낙하 블록 개념을 참고한 교육용 규칙입니다. 원작의 전체 블록 세트나 점수 규칙을 그대로 재현하지는 않습니다. <a href="https://www.blockout.net/" target="_blank" rel="noreferrer">Blockout 공식 커뮤니티 ↗</a></p></div></section>
        <section className="three-history panel"><div className="three-section-title"><h2>배치 기록</h2><span>최근 8수</span></div>{world.log.length?<ol>{world.log.map((entry,i)=><li key={i}><span>{world.index-i}수</span><b>{entry.piece}</b><span>{entry.planes}면 삭제</span><small>Q {score(entry.q)}</small></li>)}</ol>:<p>한 수를 놓으면 실제 배치와 삭제 기록이 여기에 남습니다.</p>}</section>
      </div>
      {error&&<p role="alert" className="three-error">{error}</p>}
      <details className="three-json panel"><summary>3D 보드 JSON 저장 / 불러오기</summary><p>실험 보드와 현재 블록을 내보냅니다. 불러온 보드는 사용자 실험으로 표시됩니다.</p><textarea aria-label="3D 보드 JSON" rows={7} value={json} disabled={!!dropping} onChange={e=>setJson(e.target.value)} placeholder="보드 내보내기를 누르거나 3D 보드 JSON을 붙여 넣으세요."/><div><button disabled={!!dropping} onClick={()=>setJson(JSON.stringify({version:1,dimension:3,board:world.board,piece:current},null,2))}>보드 내보내기</button><button disabled={disabled} onClick={importBoard}>보드 불러오기</button></div></details>
      <footer className="three-footer"><strong>하나의 빈칸이, 네 개의 면을 바꿉니다.</strong><span>계산·렌더링은 브라우저 안에서 · 시드 {seed} · 최대 1,000블록 시퀀스</span></footer>
    </main>
  </div>;
}



