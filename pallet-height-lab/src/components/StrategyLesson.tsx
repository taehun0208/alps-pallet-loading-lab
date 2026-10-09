import { measure } from '../engine/board';
import { STRATEGY_LABELS, strategyMetrics } from '../engine/strategy';
import type { Lab } from '../hooks/useLab';
import { Board } from './Board';
import { formatScore } from '../engine/evaluate';

export function StrategyLesson({lab}:{lab:Lab}) {
  const strategy=lab.config.strategy??'balanced';
  if(strategy==='balanced')return null;
  const before=lab.decision?.board??lab.board,metrics=measure(before),well=strategyMetrics(before,metrics,strategy)!;
  const next=lab.decision?.next??lab.next,current=lab.decision?.current??lab.current;
  const nextI=current==='I'?0:next.indexOf('I')<0?null:next.indexOf('I')+1;
  const baseline=lab.decision?.baseline,standard=baseline?.candidates.find(c=>c.id===baseline.selectedId),chosen=lab.selected;
  return <section className="strategy-lesson panel" aria-label="선수 전략 학습">
    <div className="section-heading"><h2>{STRATEGY_LABELS[strategy]}</h2><span className={`tiny-badge ${well.dangerLevels?'warning-text':''}`}>{well.dangerLevels?'위험 높이 · 낮추기 우선':'쌓기 / 4줄 준비'}</span></div>
    <p className="strategy-intro">{well.dangerLevels?`최대 높이 ${metrics.maxHeight}칸입니다. I를 기다리며 계속 쌓기보다 줄을 지워 높이를 낮추는 평가가 강해집니다.`:`x=${well.column}을 I의 수직 통로로 남깁니다. 이 열 옆의 의도적인 높이 차는 표면 패널티에서 보정합니다.`}</p>
    <dl className="strategy-readings"><div><dt>예약 열 x</dt><dd>{well.column}</dd></div><div><dt>통로</dt><dd>{well.open?'열림':'막힘'}</dd></div><div><dt>연속 준비 줄</dt><dd>{well.readyRows}<small> / 4</small></dd></div><div><dt>공개된 I</dt><dd>{nextI===0?'지금':nextI===null?'NEXT 밖':`NEXT ${nextI}`}</dd></div></dl>
    <p className="hint">위로 열린 빈 열은 구멍 O가 아닙니다. 아래부터 다른 9칸이 모두 찬 연속 행만 준비 줄로 셉니다. NEXT 밖의 I 도착 시점은 알 수 없습니다.</p>
    {standard&&chosen&&<><h3>같은 보드 · 같은 블록 · 같은 탐색</h3><div className="strategy-counterfactual">{[{name:'균형 / 생존',candidate:standard},{name:STRATEGY_LABELS[strategy],candidate:chosen}].map(({name,candidate})=><div key={name}><Board board={candidate.board} mini showCoordinates={false}/><div><strong>{name}</strong><p>회전 {candidate.action.rotation} · x={candidate.action.x}<br/>이번 삭제 {candidate.metrics.lines}줄 · 구멍 {candidate.metrics.holes}칸<br/>예약 열 높이 {candidate.metrics.heights[well.column]}칸</p></div></div>)}</div><p className="strategy-difference" data-testid="strategy-difference">{standard.id===chosen.id?'두 전략이 같은 행동을 선택했습니다.':`평가 전략을 바꾸면 ${standard.id} → ${chosen.id}로 첫 행동이 달라집니다.`}</p><p className="hint">두 선택은 실제로 다시 계산한 결과입니다. 서로 다른 평가식의 점수는 직접 비교하지 않습니다. 대조 계산 {formatScore(baseline!.elapsedMs)} ms.</p></>}
    <details><summary>전략의 근거와 구현 범위</summary><p>실제 플레이에서는 9–0, 6–3, T-spin, 콤보, HOLD 등 목적과 규칙에 맞는 전략을 씁니다. 여기서는 열린 웰·4줄 회수·높이 관리의 원리를 휴리스틱으로 구현했습니다. 6–3은 예약 열의 위치 실험이며 선수의 전체 빌드를 재현한 정책은 아닙니다.</p><p>4줄 추가 보상은 4 × 줄 가중치, 준비 줄 보상은 18 × min(4, 준비 줄), 예약 열 패널티는 −12 × 예약 열 높이, 위험 패널티는 −12 × max(0, 최대 높이 − 12)²입니다. 교육용 설계값이며 실제 게임 점수표가 아닙니다.</p><p><a href="https://www.ryanheise.com/tetris/tetris_stacking.html" target="_blank" rel="noreferrer">Ryan Heise · 쌓기 가이드</a> · <a href="https://chihsienyen.github.io/pdf/Tetris_AI.pdf" target="_blank" rel="noreferrer">Tetris AI · 선수 전략 연구</a> · <a href="https://cdn.akamai.steamstatic.com/steam/apps/1259790/manuals/tenpex_WM_210216_Steam_en.pdf" target="_blank" rel="noreferrer">SEGA · 4줄 삭제와 B2B 설명</a></p><p>B2B·콤보 점수와 T-spin·HOLD는 현재 엔진에 포함하지 않았습니다. 웰을 보존하는 것은 선호이며, 배치 금지 규칙이 아닙니다.</p></details>
  </section>;
}
