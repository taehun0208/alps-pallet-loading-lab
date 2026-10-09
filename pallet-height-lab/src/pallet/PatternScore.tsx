import { useMemo } from 'react';
import { evaluatePattern } from './patternEvaluation';
import type { Frame,Scenario } from './types';
export function PatternScore({frame,scenario}:{frame:Frame;scenario:Scenario}){
 const e=useMemo(()=>evaluatePattern(frame,scenario),[frame,scenario]);
 return <section className="pallet-pattern-score" aria-label="적재 패턴 평가"><div className="pallet-section-head"><h3>적재 패턴 평가</h3><b>{e.score===null?'미검증':`${e.score.toFixed(1)} / 100`}</b></div><p>전체 물량 적재 {(100*e.coverage).toFixed(1)}% · {e.complete?'완료':'미완료'} · {e.valid?(frame.placements.length?'확정 배치 검사 통과':'확정 배치 없음'):'확정 배치 제약 위반'}</p><dl className="pallet-dl"><dt>공간 활용 · 조밀성</dt><dd>{e.dimensions.packing.toFixed(1)}</dd><dt>하중 균형</dt><dd>{e.dimensions.balance.toFixed(1)}</dd><dt>전도 여유 · 하중 여유</dt><dd>{e.dimensions.stability.toFixed(1)}</dd><dt>로봇 작업 시간</dt><dd>{e.dimensions.robotTime===null?'미평가':e.dimensions.robotTime.toFixed(1)}</dd><dt>패턴 계산 시간</dt><dd>{e.dimensions.generationTime.toFixed(1)}</dd></dl><p className="pallet-note">물량 적재 비율 × 품질 점수입니다. 물리 실험과 관절·IK 검증은 별도이며, 실물 안전 확률이 아닙니다. {e.reasons.join(' / ')}{!e.capacityVerified&&'박스 강도 미검증'}</p></section>;
}
