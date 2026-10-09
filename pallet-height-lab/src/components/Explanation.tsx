import { useState } from 'react';
import { contributions, formatScore, sum } from '../engine/evaluate';
import { explainChoice } from '../engine/narration';
import { measure } from '../engine/board';
import { strategyMetrics } from '../engine/strategy';
import type { Lab } from '../hooks/useLab';
import { Icon } from './Icon';

const labels={lines:'제거한 줄',height:'높이 합',holes:'구멍',bumpiness:'울퉁불퉁함'};
export function Explanation({lab}:{lab:Lab}) {
  const [details,setDetails]=useState(false);
  const candidate=lab.preview,observing=lab.step<2&&!lab.previewId&&!lab.treeNode;
  const shownBoard=observing?lab.decision?.board??lab.board:lab.treeNode?.board??candidate?.board??lab.board;
  const metrics=observing?measure(shownBoard):lab.treeNode?.metrics??candidate?.metrics;
  const strategy=metrics?strategyMetrics(shownBoard,metrics,lab.config.strategy):null;
  const scores=observing||lab.treeNode?metrics?contributions(metrics,lab.weights,strategy):undefined:candidate?.contributions;
  const event=lab.events[lab.step],opponent=lab.analysis?.candidates.find(c=>c.id!==lab.selected?.id);
  const pathReward=(candidate?.pathContributions?.lines??0)+(candidate?.pathContributions?.tetris??0);
  return <aside className="explanation" aria-label="현재 단계 해설">
    <section className="panel lesson-card">
      <div className="section-heading"><span className="eyebrow">지금 AI는</span><span className="step-badge">{String(lab.step+1).padStart(2,'0')} / 08</span></div>
      <h2>{lab.treeNode?'탐색 노드를 살펴봅니다':lab.previewId?'이 후보의 결과를 살펴봅니다':event?.title??'가능한 수를 계산하고 있습니다'}</h2>
      <p className="lesson-copy" aria-live="polite">{lab.busy?'새 설정으로 후보와 점수를 계산합니다.':lab.treeNode
        ?`${lab.treeNode.depth}수째의 실제 탐색 노드입니다. 구멍 ${metrics?.holes}칸, 누적 줄 보상 ${lab.treeNode.reward.toFixed(1)}점, 경로 평가 ${lab.treeNode.score.toFixed(1)}점입니다.`
        :(lab.previewId||lab.step===2)&&candidate
          ?`회전 ${candidate.action.rotation}, x=${candidate.action.x}의 가상 결과입니다. ${candidate.metrics.lines}줄을 지운 뒤 구멍 ${candidate.metrics.holes}칸이 남아 ${formatScore(candidate.contributions.holes)}점이 반영됩니다.`
          :event?.text}</p>
      {lab.weightFeedback&&<p className="weight-feedback" role="status">{lab.weightFeedback}</p>}
      <div className="lesson-note"><Icon name="eye" size={16}/><span>{lab.step===0?'재생을 눌러 선택 과정을 따라가세요.':lab.step===3
        ?strategy?'금색 세로 열은 I를 위한 웰, 빗금은 막힌 구멍입니다.':'빗금 + × 표시는 위가 막힌 구멍입니다.'
        :lab.step===5?'탐색 트리의 노드를 눌러 보드를 확인하세요.':'후보를 누르면 다른 결과도 살펴볼 수 있습니다.'}</span></div>
    </section>
    <section className="panel score-card">
      <div className="section-heading"><h2>이 보드의 평가</h2><span className="tiny-badge">{observing?'현재 상태':'줄 삭제 후'}</span></div>
      {metrics&&scores?<>
        <table className="score-table">
          <thead><tr><th>지표</th><th>측정값</th><th>가중치</th><th>기여 점수</th></tr></thead>
          <tbody>
            {(['lines','height','holes','bumpiness'] as const).map(key=><tr key={key} className={key==='holes'?'hole-row':''}>
              <td><span className="metric-letter">{{lines:'L',height:'H',holes:'O',bumpiness:'B'}[key]}</span>{labels[key]}</td>
              <td>{metrics[key]}</td><td>{key==='lines'?'+':'−'}{lab.weights[key]}</td>
              <td>{scores[key]>0?'+':''}{formatScore(scores[key])}<span className={`contribution-bar ${scores[key]>0?'positive':''}`} style={{width:`${Math.min(100,Math.abs(scores[key])*2)}%`}}/></td>
            </tr>)}
            {strategy&&<>
              <tr className="strategy-score-row" data-testid="well-contribution"><td><span className="metric-letter">W</span>웰 보존</td><td>준비 {strategy.readyRows}</td><td>보정</td><td>{formatScore(scores.well??0)}</td></tr>
              <tr className="strategy-score-row" data-testid="tetris-contribution"><td><span className="metric-letter">T4</span>4줄 추가</td><td>{metrics.lines===4?1:0}회</td><td>+{4*lab.weights.lines}</td><td>{formatScore(scores.tetris??0)}</td></tr>
              <tr className="strategy-score-row" data-testid="danger-contribution"><td><span className="metric-letter">D</span>위험 높이</td><td>{strategy.dangerLevels}²</td><td>−12</td><td>{formatScore(scores.danger??0)}</td></tr>
            </>}
          </tbody>
        </table>
        <div className="total-score"><span>{observing?'현재 보드 평가 F':'한 수 평가 Q'}</span><strong data-testid="score-total">{formatScore(sum(scores))}<small>점</small></strong></div>
        <div className="path-score"><span>{lab.analysis?.completedDepth??1}수까지 본 경로 평가</span><b>{lab.treeNode?formatScore(lab.treeNode.score):lab.config.algorithm==='greedy'?'미래 탐색 없음':formatScore(candidate?.pathScore??null)}</b></div>
        {lab.step===5&&candidate?.pathContributions&&lab.config.algorithm!=='greedy'&&<p className="path-breakdown">
          누적 R {formatScore(pathReward)} + 마지막 F {formatScore(candidate.pathScore!-pathReward)}
          {strategy&&<><br/>누적 4줄 추가 {formatScore(candidate.pathContributions.tetris??0)}</>}
          <br/>최종 H {candidate.finalMetrics?.height} · O {candidate.finalMetrics?.holes} · B {candidate.finalMetrics?.bumpiness}
        </p>}
        <p className="score-caution">게임 점수나 성공 확률이 아닙니다.<br/>음수여도 정상이며, 큰 값을 선호합니다.</p>
      </>:<p className="hint">합법적인 후보가 없어 평가할 수 없습니다.</p>}
    </section>
    <section className="choice-reason"><span className="gold-square"/><div><h3>선택의 이유</h3><p>{lab.selected?explainChoice(lab.selected,opponent,lab.weights,lab.analysis?.completedDepth??1):lab.busy?'계산 중입니다.':'배치할 수 있는 경로가 없습니다.'}</p></div></section>
    <button className="details-button" onClick={()=>setDetails(!details)} aria-expanded={details}>수식과 규칙 자세히<Icon name="down" size={14}/></button>
    {details&&<div className="details panel">
      <p>{strategy?'기본 줄 보상':'R'} = {lab.weights.lines} × L</p>
      <p>{strategy?'기본 F':'F'} = −{lab.weights.height}H −{lab.weights.holes}O −{lab.weights.bumpiness}B</p>
      {strategy&&<>
        <p>T4 = 4줄 삭제 때 {4*lab.weights.lines}, 그 외 0<br/>R = 기본 줄 보상 + T4</p>
        <p>W = {lab.weights.bumpiness} × (B − 웰 밖 B) + 18 × min(4, 준비 줄) − 12 × 예약 열 높이</p>
        <p>D = −12 × max(0, 최대 높이 − 12)²<br/>F = 기본 F + W + D</p>
      </>}
      <p>Q = R + F</p><p>경로 평가 = Σ R + 마지막 F<br/>할인율 = 1 · 높이 = 열별 높이의 합</p>
      <p>동점: 평가 → 끝 보드 구멍 → 끝 보드 최대 높이 → 경로의 회전 번호와 x 순서</p>
      <p>수직 낙하 규칙으로 벽차기·슬라이드·T-spin은 지원하지 않습니다. HOLD는 꺼져 있습니다.</p>
    </div>}
  </aside>;
}

