import { useRef, useState } from 'react';
import { SCENARIOS } from '../engine/scenarios';
import { DEFAULT_WEIGHTS, PIECES, STRATEGIES, type Strategy, type Weights } from '../engine/types';
import { STRATEGY_LABELS } from '../engine/strategy';
import { parseExperiment } from '../engine/io';
import type { Lab } from '../hooks/useLab';
import { Icon } from './Icon';
const WEIGHTS = [{key:'lines',name:'줄 삭제 보상',symbol:'L',step:1,max:40},{key:'height',name:'높이 패널티',symbol:'H',step:.1,max:4},{key:'holes',name:'구멍 패널티',symbol:'O',step:.5,max:24},{key:'bumpiness',name:'울퉁불퉁함 패널티',symbol:'B',step:.1,max:4}] as const;
const PRESETS:Record<string,Weights>={'기본값':DEFAULT_WEIGHTS,'구멍을 매우 싫어함':{lines:10,height:.5,holes:20,bumpiness:.7},'높이를 낮추는 데 집중':{lines:10,height:2,holes:8,bumpiness:.7},'줄 삭제를 중시':{lines:30,height:.5,holes:4,bumpiness:.7}};
export function Sidebar({lab}:{lab:Lab}) {
  const [tab,setTab]=useState('scenarios'),[ioError,setIoError]=useState(''),file=useRef<HTMLInputElement>(null);
  const exportJSON=()=>{
    const data={version:1,board:lab.board,seed:lab.seed,current:lab.current,next:lab.next,weights:lab.weights,config:lab.config,supply:{pieces:lab.feed,index:lab.index}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='블록-AI-실험.json';a.click();URL.revokeObjectURL(url);
  };
  return <aside className="sidebar panel" aria-label="실험 설정">
    <div className="sidebar-tabs"><button className={tab==='scenarios'?'active':''} onClick={()=>setTab('scenarios')}><Icon name="book" size={14}/>시나리오</button><button className={tab==='strategies'?'active':''} onClick={()=>setTab('strategies')}>선수 전략</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Icon name="settings" size={14}/>설정</button></div>
    {tab==='scenarios'&&<div className="scenario-list">{SCENARIOS.map((s,i)=><button key={s.id} className={`scenario-item ${lab.scenarioId===s.id?'active':''}`} onClick={()=>lab.chooseScenario(s.id)}><span className="scenario-number">{String(i+1).padStart(2,'0')}</span><span><strong>{s.title}</strong><small>{s.subtitle}</small></span>{lab.scenarioId===s.id&&<span className="active-dot"/>}</button>)}</div>}
    {tab==='strategies'&&<div className="sidebar-section strategy-guide"><h2>한 열을 남기고 쌓기</h2><p className="hint">가로 한 줄이 아니라 세로 한 열을 비워 I 블록의 통로로 씁니다. 네 줄이 준비되면 한 번에 회수하고, 너무 높아지면 작은 삭제로 낮춥니다.</p><div className="strategy-exercises">{SCENARIOS.filter(s=>s.id.startsWith('well-')).map(s=><button key={s.id} className={lab.scenarioId===s.id?'active':''} onClick={()=>lab.chooseScenario(s.id)}><strong>{s.title}</strong><small>{s.subtitle}</small></button>)}</div></div>}
    <div className="sidebar-section strategy-settings"><h2><Icon name="grid" size={16}/>플레이 전략</h2><select aria-label="플레이 전략" value={lab.config.strategy??'balanced'} onChange={e=>lab.updateConfig({...lab.config,strategy:e.target.value as Strategy})}>{STRATEGIES.map(s=><option key={s} value={s}>{STRATEGY_LABELS[s]}</option>)}</select><p className="hint">{!lab.config.strategy||lab.config.strategy==='balanced'?'기존 네 지표로 높이·구멍·표면과 줄 삭제를 평가합니다.':'예약 열을 비우고 4줄 삭제를 우대합니다. 높이 12칸 초과는 추가 위험 패널티를 받습니다.'}</p></div>
    <div className="sidebar-section"><h2><Icon name="tree" size={16}/>{lab.mode==='compare'?'빔 탐색 설정':'탐색 알고리즘'}</h2>
      {lab.mode!=='compare'&&<select aria-label="탐색 알고리즘" value={lab.config.algorithm} onChange={e=>lab.updateConfig({...lab.config,algorithm:e.target.value as Lab['config']['algorithm']})}><option value="greedy">한 수 선택 · Greedy</option><option value="two">2수 완전탐색</option><option value="beam">가지 남기기 · Beam Search</option></select>}
      <p className="hint">{lab.mode==='compare'?'세 알고리즘을 함께 실행합니다. 아래 값은 빔 탐색의 깊이·너비입니다.':lab.config.algorithm==='greedy'?'지금 이 블록을 놓은 직후만 비교합니다.':lab.config.algorithm==='two'?'현재 블록 + NEXT 첫 블록을 모두 검사합니다.':'각 깊이에서 전체 경로의 상위 K개를 남깁니다.'}</p>
      {(lab.config.algorithm==='beam'||lab.mode==='compare')&&<div className="two-controls"><label>탐색 깊이<select aria-label="탐색 깊이" value={lab.config.depth} onChange={e=>lab.updateConfig({...lab.config,depth:+e.target.value})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}수</option>)}</select></label><label>빔 너비 K<select aria-label="빔 너비" value={lab.config.width} onChange={e=>lab.updateConfig({...lab.config,width:+e.target.value})}>{[1,5,10,20,50].map(n=><option key={n}>{n}</option>)}</select></label></div>}
    </div>
    <div className="sidebar-section weights"><div className="section-heading"><h2><Icon name="settings" size={16}/>가중치 실험</h2><button className="icon-button" title="기본 가중치 복원" aria-label="기본 가중치 복원" onClick={()=>lab.updateWeights({...DEFAULT_WEIGHTS})}><Icon name="reset" size={14}/></button></div>
      <select aria-label="가중치 프리셋" value={Object.keys(PRESETS).find(k=>JSON.stringify(PRESETS[k])===JSON.stringify(lab.weights))??'custom'} onChange={e=>{if(PRESETS[e.target.value])lab.updateWeights({...PRESETS[e.target.value]});}}><option value="custom">직접 조정</option>{Object.keys(PRESETS).map(k=><option key={k}>{k}</option>)}</select>
      {WEIGHTS.map(w=><div className={`weight-row ${w.key==='holes'?'hole-weight':''}`} key={w.key}><label htmlFor={`range-${w.key}`}><span className="metric-letter">{w.symbol}</span>{w.name}</label><input aria-label={`${w.name} 숫자`} type="number" min="0" max="40" step={w.step} value={lab.weights[w.key]} onChange={e=>{if(e.target.value!==''&&Number.isFinite(+e.target.value))lab.updateWeights({...lab.weights,[w.key]:Math.max(0,Math.min(40,+e.target.value))});}}/><input id={`range-${w.key}`} aria-label={`${w.name} 슬라이더`} type="range" min="0" max={Math.max(w.max,lab.weights[w.key])} step={w.step} value={lab.weights[w.key]} onChange={e=>lab.updateWeights({...lab.weights,[w.key]:+e.target.value})}/></div>)}
      <p className="hint">교육용 초기값입니다. 패널티 크기를 입력하면 수식에서 뺍니다.</p>
    </div>
    {(tab==='settings'||lab.mode==='free')&&<div className="sidebar-section experiment-settings"><h2><Icon name="flask" size={16}/>자유 실험</h2><label className="switch-line"><span>보드 편집</span><input type="checkbox" checked={lab.editing} disabled={lab.playing} onChange={e=>lab.setEditing(e.target.checked)}/></label><p className="hint">편집을 켜고 셀을 누르거나 드래그하세요. 첫 셀의 채우기·지우기가 이어집니다. 키보드는 보드 아래 셀 좌표 도구를 사용하세요.</p><div className="button-pair"><button onClick={lab.clear}>빈 보드</button><button onClick={lab.restore}>시나리오 복원</button></div>
      <label className="seed-label">공급 시드<input aria-label="공급 시드" type="number" min="0" max="4294967295" value={lab.seed} onChange={e=>{if(e.target.value!==''&&Number.isInteger(+e.target.value))lab.changeSeed(Math.min(4294967295,Math.max(0,+e.target.value)));}}/></label>
      <label className="piece-select">현재 블록<select value={lab.current} aria-label="현재 블록 변경" onChange={e=>lab.changePiece(0,e.target.value as typeof PIECES[number])}>{PIECES.map(p=><option key={p}>{p}</option>)}</select></label>
      <div className="next-selects">{lab.next.map((p,i)=><label key={i}>N{i+1}<select aria-label={`NEXT ${i+1} 변경`} value={p} onChange={e=>lab.changePiece(i+1,e.target.value as typeof PIECES[number])}>{PIECES.map(v=><option key={v}>{v}</option>)}</select></label>)}</div>
      <p className="hint">사용자 정의 보드의 완성 행은 즉시 지우지 않습니다. 다음 블록 고정 시 함께 삭제합니다.</p>
      <div className="button-pair"><button onClick={exportJSON}><Icon name="download" size={14}/>내보내기</button><button onClick={()=>file.current?.click()}><Icon name="upload" size={14}/>불러오기</button></div><input ref={file} type="file" hidden accept=".json,application/json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>100000)throw Error('파일은 100 KB 이하로 가져올 수 있습니다.');const v=parseExperiment(await f.text());lab.load(v.board,v.weights,v.config,v.seed,v.current,v.next,v.supply);setIoError('');}catch(err){setIoError(err instanceof Error?err.message:'파일 형식을 확인해 주세요.');}e.target.value='';}}/>{ioError&&<p className="error" role="alert">{ioError}</p>}
    </div>}
    <div className="sidebar-foot"><Icon name="info" size={14}/><span>신경망 학습 없이<br/>평가 규칙과 탐색으로 선택합니다.</span></div>
  </aside>;
}
