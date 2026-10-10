import type { AlgorithmId, SimulationConfig } from './types';
export const ALGORITHMS: { id: AlgorithmId; name: string }[] = [
  { id: 'blb', name: 'Bottom-Left-Back' }, { id: 'capacity-compact', name: 'Compact' },
  { id: 'strategy-greedy', name: 'Greedy' }, { id: 'lookahead', name: 'Lookahead' },
  { id: 'future-hybrid', name: 'Future Hybrid' }, { id: 'mcts', name: 'UCT MCTS' },
  { id: 'floor-dense', name: 'ALPS Tetris · 바닥 밀집' },
  { id: 'cluster-floor', name: 'ALPS 군집 · 층 우선' },
  { id: 'cluster-layer', name: 'ALPS 군집 · 연결 우선' },
  { id: 'dispersed', name: '분산 적재 · 대조군' },
];
export const DEFAULT_CONFIG: SimulationConfig = {
  cycleSeconds: 10, recognitionDelaySeconds: 0, reserveSeconds: 1,
  maxHeightMm: 1200, quantityPerSku: 12, searchBudgetMs: null, maxCandidates: 48,
  mcts: { depth: 3, scenarios: 3, maxIterations: 384 },
};
export function availablePlanningMs(c: SimulationConfig) { return (c.cycleSeconds - c.recognitionDelaySeconds - c.reserveSeconds) * 1000; }
export function validateConfig(c: SimulationConfig) {
  if (![10, 12].includes(c.cycleSeconds)) throw Error('로봇 운영 목표는 10초 또는 12초입니다.');
  if (![c.recognitionDelaySeconds, c.reserveSeconds].every(n => Number.isFinite(n) && n >= 0) || availablePlanningMs(c) <= 0) throw Error('인지·검증 여유를 제외한 계산 시간이 양수여야 합니다.');
  if (!Number.isInteger(c.quantityPerSku) || c.quantityPerSku < 1 || c.quantityPerSku > 24) throw Error('품목당 수량은 1~24개입니다.');
  if (!Number.isFinite(c.maxHeightMm) || c.maxHeightMm < 400 || c.maxHeightMm > 2400) throw Error('높이 범위는 400~2400mm입니다.');
  if (c.searchBudgetMs !== null && (!Number.isFinite(c.searchBudgetMs) || c.searchBudgetMs < 1 || c.searchBudgetMs > availablePlanningMs(c))) throw Error('탐색 예산은 가용 시간 이하여야 합니다.');
  if (!Number.isInteger(c.maxCandidates) || c.maxCandidates < 1 || c.maxCandidates > 128) throw Error('후보 수는 1~128개입니다.');
  if (![c.mcts.depth,c.mcts.scenarios,c.mcts.maxIterations].every(Number.isInteger) || c.mcts.depth<1 || c.mcts.depth>6 || c.mcts.scenarios<1 || c.mcts.scenarios>8 || c.mcts.maxIterations<1 || c.mcts.maxIterations>2048) throw Error('MCTS 탐색 범위를 확인하세요.');
}
