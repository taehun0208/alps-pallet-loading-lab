import { useState } from 'react';
import { formatScore } from '../engine/evaluate';
import type { Lab } from '../hooks/useLab';
import { Board } from './Board';
import { Icon } from './Icon';
export function Candidates({lab}:{lab:Lab}) {
  const [all,setAll]=useState(false);
  const list=lab.analysis?.candidates??[];
  const shown=all?list:list.slice(0,3);
  const selected=lab.selected;
  const illustrative=list.find(c=>c.metrics.holes>(selected?.metrics.holes??0));
  if(!all&&illustrative&&!shown.some(c=>c.id===illustrative.id))shown.push(illustrative);
  const pinned=lab.pins.map(id=>list.find(c=>c.id===id)!).filter(Boolean);
  return <section className="candidate-section"><div className="section-heading"><h2>후보 미리보기 <span>{list.length}</span></h2><button className="text-button" onClick={()=>setAll(!all)} aria-expanded={all}>{all?'대표만 보기':'전체 보기'}<Icon name="down" size={14}/></button></div>
    <div className={`candidate-grid ${all?'expanded':''}`}>{shown.map(c=>{const chosen=c.id===lab.analysis?.selectedId;const active=(lab.step>=2||lab.previewId)&&c.id===lab.preview?.id;return <article className={`candidate-card ${active?'focused':''} ${chosen?'chosen':''} ${c.status!=='kept'?'pruned':''}`} key={c.id}><button className="candidate-body" onClick={()=>lab.setPreviewId(c.id)} aria-label={`후보 회전 ${c.action.rotation} x ${c.action.x} 선택`} aria-pressed={!!active}><div className="candidate-heading"><span>{chosen?<><span className="gold-dot"/>선택</>:c.status==='pruned'?'가지 제외':c.status==='dead'?'후속 불가':`후보 ${list.indexOf(c)+1}`}</span><b>{formatScore(lab.config.algorithm==='greedy'?c.immediate:c.pathScore)}</b></div><div className="candidate-content"><Board board={c.board} mini showCoordinates={false} label={`회전 ${c.action.rotation}, x ${c.action.x} 결과 보드`}/><div><strong>회전 {c.action.rotation} · x {c.action.x}</strong><span>줄 삭제 <b>{c.metrics.lines}</b></span><span>구멍 <b className={c.metrics.holes?'warning-text':''}>{c.metrics.holes}</b></span>{c.strategy&&<span>웰 {c.strategy.open?'열림':'막힘'} · 준비 {c.strategy.readyRows}줄</span>}<span className="immediate-score">즉시 {formatScore(c.immediate)}</span></div></div></button><button className={`pin-button ${lab.pins.includes(c.id)?'active':''}`} onClick={()=>lab.pin(c.id)} aria-label={`후보 ${c.id} ${lab.pins.includes(c.id)?'고정 해제':'고정'}`} title="두 후보 고정 비교"><Icon name="pin" size={13}/>{lab.pins.includes(c.id)?'고정됨':'비교 고정'}</button></article>;})}</div>
    {pinned.length>0&&<div className="pinned-comparison"><div className="section-heading"><h3>고정한 후보 비교</h3><span>{pinned.length}/2</span></div><div className="pinned-grid">{pinned.map(c=><div key={c.id}><Board board={c.board} mini/><b>회전 {c.action.rotation} · x={c.action.x}</b><p>L {c.metrics.lines} / H {c.metrics.height}<br/>O {c.metrics.holes} / B {c.metrics.bumpiness}<br/>Q {formatScore(c.immediate)}<br/>경로 {formatScore(c.pathScore)}</p><button onClick={()=>lab.chooseBranch(c)}>이 수로 새 분기</button></div>)}</div>{pinned.length===2&&<p className="hint">앞 후보 − 뒤 후보: 줄 {formatScore(pinned[0].contributions.lines-pinned[1].contributions.lines)}, 높이 {formatScore(pinned[0].contributions.height-pinned[1].contributions.height)}, 구멍 {formatScore(pinned[0].contributions.holes-pinned[1].contributions.holes)}, 표면 {formatScore(pinned[0].contributions.bumpiness-pinned[1].contributions.bumpiness)}점</p>}</div>}
  </section>;
}

