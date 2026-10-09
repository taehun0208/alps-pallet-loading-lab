import { candidateSet } from '../candidates';
import { causalInput,approachClear } from './feasibility';
import { currentScore } from './currentScore';
import { makeEvaluator } from './evaluator';
import { isStrategy,strategyConfig,type PackingStrategy,type StrategyId } from './PackingStrategy';
import { GreedyStrategy } from './GreedyStrategy';
import { MacsStrategy } from './MacsStrategy';
import { TetrisReservationStrategy } from './TetrisReservationStrategy';
import { DynamicReservationStrategy } from './DynamicReservationStrategy';
import { LookaheadStrategy } from './LookaheadStrategy';
import { HybridStrategy } from './HybridStrategy';
import type { Analysis,PlanningInput } from '../types';
export const PACKING_STRATEGIES:Record<StrategyId,PackingStrategy>={
  'strategy-greedy':GreedyStrategy,macs:MacsStrategy,'tetris-reserved':TetrisReservationStrategy,
  'dynamic-reservation':DynamicReservationStrategy,lookahead:LookaheadStrategy,'future-hybrid':HybridStrategy,
};
export function planStrategy(input:PlanningInput):Analysis {
  if(input.available)throw Error('새 비교 전략은 현재 도착 박스만 배치합니다. 박스 공급 방식을 순차 투입으로 바꾸세요.');
  if(!isStrategy(input.algorithm))throw Error('등록되지 않은 적재 전략');
  if(!Number.isInteger(input.settings.maxCandidates)||input.settings.maxCandidates<4||input.settings.maxCandidates>256)throw Error('현재 후보 상한은 4~256 정수여야 합니다.');
  const start=performance.now(),config=strategyConfig(input.settings.strategy),evaluator=makeEvaluator(input,config,input.algorithm,PACKING_STRATEGIES[input.algorithm].score);
  const fixed=evaluator.fixed,extra=fixed?.typeId===input.current.typeId?[fixed.placement]:[];
  const root=candidateSet(causalInput(input),true,extra),rejections:Record<string,number>={};
  for(const c of root.candidates){
    if(c.valid&&!approachClear(c.placement,input.placements,config)){c.valid=false;c.reasons.push('수직 접근 여유 간섭');}
    for(const r of c.reasons)rejections[r.split(' · ')[0]]=(rejections[r.split(' · ')[0]]||0)+1;
  }
  const valid=root.candidates.filter(c=>c.valid);
  let choices=valid;
  if(input.algorithm==='lookahead'){
    const ranked=[...valid].sort((a,b)=>currentScore(b,input,config).score-currentScore(a,input,config).score),limit=config.lookaheadCandidates;
    choices=ranked.slice(0,Math.min(2,limit));
    // Preserve spatial diversity in a bounded root beam before filling by current quality.
    const seen=new Set(choices.map(c=>`${c.placement.position.z}:${c.placement.orientation}:${Math.floor(2*(c.placement.position.x+c.placement.size.w/2)/input.pallet.width)}:${Math.floor(2*(c.placement.position.y+c.placement.size.d/2)/input.pallet.depth)}`));
    for(const c of ranked){const p=c.placement,key=`${p.position.z}:${p.orientation}:${Math.floor(2*(p.position.x+p.size.w/2)/input.pallet.width)}:${Math.floor(2*(p.position.y+p.size.d/2)/input.pallet.depth)}`;if(!seen.has(key)&&choices.length<limit){choices.push(c);seen.add(key);}}
    for(const c of ranked)if(choices.length<limit&&!choices.includes(c))choices.push(c);
  }
  const decision=PACKING_STRATEGIES[input.algorithm].choosePlacement({input,config,candidates:choices,evaluate:evaluator.evaluate}),debug=decision.debugInfo,counts=evaluator.counts();
  return {runId:input.runId,stepId:input.stepId,selectedId:decision.candidateId,selectedBoxId:decision.placement?input.current.id:undefined,
    candidates:root.candidates,generated:root.generated,valid:valid.length,rejections,nodes:root.candidates.length+counts.nodes,rolloutCalls:counts.calls,milliseconds:performance.now()-start,capped:root.capped||choices.length<valid.length,
    strategyDebug:debug??undefined,strategyState:{algorithm:input.algorithm,slots:debug?.reservedSlots??[]},virtualSequences:evaluator.sequences,
    explanation:[`${PACKING_STRATEGIES[input.algorithm].name}: 현재 도착 ${input.current.id}만 배치합니다. 실제 미래 순서는 계획기에 전달하지 않습니다.`,
      input.algorithm==='strategy-greedy'?'미래 재고·예약을 평가하지 않는 현재 박스 기준선입니다.':input.algorithm==='macs'?'위에서 접근 가능한 최대 빈 직육면체로 MACS를 근사합니다. 미래 종류별 적합성은 평가하지 않습니다.':`남은 수량에서 미래 배치 후보를 검사합니다. 후보 수는 제한된 표본이며 전체 적재 가능성 보장이 아닙니다.`,
      debug?`선택 점수 ${debug.selectedScore.toFixed(3)} · FPL ${debug.futurePlacementLoss.toFixed(3)} · 미래 후보 소멸 ${debug.deadEnds}종 · 보호 위치 ${debug.reservedSlots.length}개`:'현재 박스의 유효 후보가 없습니다. 미입고 박스로 교체하지 않고 중단합니다.',
      '관통·경계·높이·방향·지지·누적 하중·정적 평형은 기존 공통 검사와 확정 시 재검사를 사용합니다.']};
}
