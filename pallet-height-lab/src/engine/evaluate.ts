import type { Contributions, Metrics, StrategyMetrics, Weights } from './types';
import { DANGER_PENALTY, WELL_BLOCK_PENALTY, WELL_READY_REWARD } from './strategy';
export const contributions = (m: Metrics, w: Weights, strategy: StrategyMetrics | null = null): Contributions => ({
  lines: m.lines * w.lines, height: -m.height * w.height, holes: -m.holes * w.holes, bumpiness: -m.bumpiness * w.bumpiness,
  ...(strategy ? {
    // Refund only the bumpiness beside the intentional well. Keep both stack surfaces smooth.
    well: (m.bumpiness - strategy.stackBumpiness) * w.bumpiness
      + Math.min(4, strategy.readyRows) * WELL_READY_REWARD - strategy.reservedHeight * WELL_BLOCK_PENALTY,
    tetris: m.lines === 4 ? 4 * w.lines : 0,
    danger: -DANGER_PENALTY * strategy.dangerLevels ** 2,
  } : {}),
});
export const sum = (c: Contributions): number => c.lines + c.height + c.holes + c.bumpiness + (c.well ?? 0) + (c.tetris ?? 0) + (c.danger ?? 0);
export const clearReward = (c: Contributions): number => c.lines + (c.tetris ?? 0);
export const boardValue = (m: Metrics, w: Weights, strategy: StrategyMetrics | null = null): number => {
  const c = contributions(m, w, strategy);
  return sum(c) - clearReward(c);
};
export const formatScore = (n: number | null): string => n === null || !Number.isFinite(n) ? '—' : n.toFixed(1);
