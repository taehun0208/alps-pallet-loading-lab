import type { Lab } from '../hooks/useLab';
import { useEffect, useState } from 'react';
import { Board } from './Board';
import { formatScore } from '../engine/evaluate';
import { Icon } from './Icon';
export function Explorer({lab}:{lab:Lab}) {
  const analysis=lab.analysis;
  const [open,setOpen]=useState(false);
  const [phase,setPhase]=useState(3);
  useEffect(()=>{if(lab.step===5&&lab.config.algorithm!=='greedy')setOpen(true);},[lab.step,lab.config.algorithm]);
  useEffect(()=>{
    if(lab.step!==5){setPhase(3);return;}
    if(!lab.playing||lab.config.algorithm!=='beam')return;
    setPhase(0);const timers=[1,2,3].map(p=>setTimeout(()=>setPhase(p),1800/lab.speed*p/4));
    return()=>timers.forEach(clearTimeout);
  },[lab.step,lab.playing,lab.config.algorithm,lab.speed]);
  return <details className="explorer panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary><span><Icon name="tree" size={17}/>탐색 트리 펼치기</span><span>{analysis?.evaluated??0}개 계산 · {analysis?.nodes.length??0}개 표시<Icon name="down" size={15}/></span></summary><div className="explorer-content">
    <p className="hint">실제 계산한 노드 일부를 표시합니다. 각 노드의 부모 ID로 경로를 확인하세요. 제외된 가지는 이후 깊이에서 계산하지 않습니다.</p>
    {lab.config.algorithm==='beam'&&<div className="beam-phases" aria-label="빔 탐색 설명 순서">{['가지 확장','점수 평가','전체 정렬',`K=${lab.config.width} 유지`].map((label,i)=><span key={label} className={i===phase?'active':''}>{label}</span>)}</div>}
    {analysis?.stats.map(stat=><div className="tree-depth" key={stat.depth}><div className="depth-label"><strong>{stat.depth}수 · {analysis.visiblePieces[stat.depth-1]}</strong><span>생성 {stat.generated} → 유지 {stat.kept} / 제외 {stat.pruned} · 배치 불가 {stat.failures}</span></div><div className="tree-nodes">{analysis.nodes.filter(n=>n.depth===stat.depth).sort((a,b)=>phase<2?+a.id.slice(1)-+b.id.slice(1):b.score-a.score).map(n=><button key={n.id} className={`tree-node ${phase===3?n.kept?'kept':'cut':'pending'} ${lab.treeNode?.id===n.id?'active':''}`} onClick={()=>lab.setTreeNodeId(n.id)}><Board board={n.board} mini showCoordinates={false}/><span>{n.id} ← {n.parentId??'시작'}</span><b>{phase>0?formatScore(n.score):'평가 전'}</b><small>{phase<3?'설명 중':n.kept?'유지':`제외 · 경계 ${formatScore(n.cutoff)}`}</small><small>r{n.action.rotation} · x{n.action.x}</small></button>)}</div></div>)}
    {analysis?.reason==='budget'&&<p className="error">요청 {analysis.requestedDepth}수 / 완료 {analysis.completedDepth}수 · 계산 예산으로 중단했습니다.</p>}
    {lab.config.algorithm==='beam'&&<p className="hint">모든 미래를 검사하지 않아 더 좋은 경로를 놓칠 수 있습니다. 깊이·너비가 커져도 게임 성적이 항상 좋아지지는 않습니다.</p>}
  </div></details>;
}
