import type { Board, Metrics, Strategy, StrategyMetrics } from './types';

export const STRATEGY_LABELS: Record<Strategy, string> = {
  balanced: '균형 / 생존',
  'well-right': '9–0 · 오른쪽 웰',
  'well-left': '0–9 · 왼쪽 웰',
  'well-63': '6–3 · 가운데 웰',
};
// A prepared row must outweigh a small immediate clear plus its height saving.
// The cap at four and danger term stop this from rewarding indefinite stacking.
export const WELL_READY_REWARD = 18;
export const WELL_BLOCK_PENALTY = 12;
export const DANGER_HEIGHT = 12;
export const DANGER_PENALTY = 12;
export function wellColumn(strategy: Strategy = 'balanced'): number | null {
  return strategy === 'well-right' ? 9 : strategy === 'well-left' ? 0 : strategy === 'well-63' ? 6 : null;
}

// An intentional, top-open well is different from a sealed hole. This is a
// teaching heuristic derived from stacking guides, not a trained player policy.
export function strategyMetrics(board: Board, metrics: Metrics, strategy: Strategy = 'balanced'): StrategyMetrics | null {
  const column = wellColumn(strategy);
  if (column === null) return null;
  const reservedHeight = metrics.heights[column];
  const open = reservedHeight === 0;
  let readyRows = 0;
  if (open) {
    for (let y = board.length - 1; y >= 0; y--) {
      if (!board[y].every((cell, x) => x === column ? cell === 0 : cell !== 0)) break;
      readyRows++;
    }
  }
  const stackBumpiness = metrics.heights.slice(1).reduce((total, h, x) =>
    x === column || x + 1 === column ? total : total + Math.abs(h - metrics.heights[x]), 0);
  const wellCells = Array.from({ length: board.length }, (_, y) => ({ x: column, y }))
    .filter(cell => board[cell.y][column] === 0);
  return { column, open, reservedHeight, readyRows, stackBumpiness,
    dangerLevels: Math.max(0, metrics.maxHeight - DANGER_HEIGHT), wellCells };
}
