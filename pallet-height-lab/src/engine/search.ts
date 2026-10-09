import { landings, lock, measure } from './board';
import { boardValue, clearReward, contributions, sum } from './evaluate';
import { strategyMetrics } from './strategy';
import type { Action, Analysis, Board, Candidate, DepthStats, Metrics, Piece, SearchConfig, SearchNode, Weights } from './types';
type Path = { id: string; parentId: string | null; rootId: string; board: Board; metrics: Metrics; reward: number; lineReward: number; tetrisReward: number; score: number; actions: Action[] };
export function actionOrder(a: Action, b: Action): number { return a.rotation - b.rotation || a.x - b.x; }
export function rank(a: { score: number; metrics: Metrics; actions: Action[] }, b: { score: number; metrics: Metrics; actions: Action[] }): number {
  const base = b.score - a.score || a.metrics.holes - b.metrics.holes || a.metrics.maxHeight - b.metrics.maxHeight;
  if (base) return base;
  for (let i = 0; i < Math.min(a.actions.length, b.actions.length); i++) { const order = actionOrder(a.actions[i], b.actions[i]); if (order) return order; }
  return a.actions.length - b.actions.length;
}
export function generate(board: Board, piece: Piece, weights: Weights, config?: SearchConfig) {
  const drops = landings(board, piece);
  const candidates: Candidate[] = drops.actions.map(action => {
    const result = lock(board, action)!;
    const metrics = measure(result.board, result.clearedRows.length), strategy = strategyMetrics(result.board, metrics, config?.strategy), scores = contributions(metrics, weights, strategy);
    return { id: `${action.rotation}:${action.x}`, action, ...result, metrics, strategy, contributions: scores, immediate: sum(scores), pathScore: sum(scores), path: [action], finalMetrics: metrics, pathContributions: scores, status: 'kept' };
  });
  return { candidates, failures: drops.failures };
}
// Only public pieces cross this boundary. No supply/PRNG object is accepted.
export function search(board: Board, current: Piece, publicNext: Piece[], weights: Weights, config: SearchConfig): Analysis {
  const start = performance.now();
  const requestedDepth = config.algorithm === 'greedy' ? 1 : config.algorithm === 'two' ? 2 : Math.max(1, Math.min(5, config.depth));
  const pieces = [current, ...publicNext.slice(0, 5)].slice(0, requestedDepth);
  const depth = pieces.length;
  const { candidates, failures } = generate(board, current, weights, config);
  let serial = 0, evaluated = candidates.length, completedDepth = 1;
  const nodes: SearchNode[] = [], stats: DepthStats[] = [];
  let frontier: Path[] = candidates.map(c => ({ id: `n${serial++}`, parentId: null, rootId: c.id, board: c.board, metrics: c.metrics, reward: clearReward(c.contributions), lineReward: c.contributions.lines, tetrisReward: c.contributions.tetris ?? 0, score: c.immediate, actions: [c.action] }));
  let reason: Analysis['reason'] = candidates.length ? 'complete' : 'gameover';
  const roots = new Map(candidates.map(c => [c.id, c]));
  const retain = (paths: Path[], d: number, fail: number): Path[] => {
    paths.sort(rank);
    const keptCount = config.algorithm === 'beam' ? Math.min(Math.max(1, Math.floor(config.width)), paths.length) : paths.length;
    const keptIds = new Set(paths.slice(0, keptCount).map(p => p.id));
    const cutoff = keptCount < paths.length ? paths[keptCount - 1].score : null;
    // A bounded sample of real nodes: kept paths and the closest rejected paths.
    const sample = paths.slice(0, Math.max(Math.min(keptCount, 50), 10) + 10);
    sample.forEach(p => nodes.push({ id: p.id, parentId: p.parentId, rootId: p.rootId, depth: d, action: p.actions[d - 1], board: p.board, metrics: p.metrics, reward: p.reward, score: p.score, kept: keptIds.has(p.id), cutoff }));
    stats.push({ depth: d, generated: paths.length, kept: keptCount, pruned: paths.length - keptCount, failures: fail });
    return paths.slice(0, keptCount);
  };
  frontier = retain(frontier, 1, failures);
  if (config.algorithm !== 'greedy') candidates.forEach(c => { c.pathScore = null; c.status = 'pruned'; c.path = []; c.finalMetrics=null; c.pathContributions=null; });
  for (let d = 1; d < depth && frontier.length; d++) {
    const expanded: Path[] = [];
    let failed = 0;
    for (const parent of frontier) {
      const generated = generate(parent.board, pieces[d], weights, config);
      failed += generated.failures;
      for (const child of generated.candidates) {
        const reward = parent.reward + clearReward(child.contributions);
        expanded.push({ id: `n${serial++}`, parentId: parent.id, rootId: parent.rootId, board: child.board, metrics: child.metrics, reward, lineReward: parent.lineReward + child.contributions.lines, tetrisReward: parent.tetrisReward + (child.contributions.tetris ?? 0), score: reward + boardValue(child.metrics, weights, child.strategy), actions: [...parent.actions, child.action] });
      }
    }
    evaluated += expanded.length;
    completedDepth = d + 1;
    frontier = retain(expanded, d + 1, failed);
    if (!frontier.length) reason = 'gameover';
    // Current supported bounds need at most ~7k nodes. Defensive budget is explicit.
    if (evaluated > 60000 && d + 1 < depth) { reason = 'budget'; break; }
  }
  frontier.sort(rank);
  if (config.algorithm !== 'greedy') {
    for (const path of frontier) { const root = roots.get(path.rootId)!; if (root.pathScore === null || path.score > root.pathScore) { root.pathScore = path.score; root.path = path.actions; root.finalMetrics=path.metrics; root.pathContributions={...contributions(path.metrics,weights,strategyMetrics(path.board,path.metrics,config.strategy)),lines:path.lineReward,...(config.strategy&&config.strategy!=='balanced'?{tetris:path.tetrisReward}:{})}; root.status = 'kept'; } }
    candidates.forEach(c => { if (c.pathScore === null && config.algorithm === 'two') c.status = 'dead'; });
  }
  const best = frontier[0];
  candidates.sort((a, b) => rank({ score: a.pathScore ?? -Infinity, metrics: a.finalMetrics??a.metrics, actions: a.path.length?a.path:[a.action] }, { score: b.pathScore ?? -Infinity, metrics: b.finalMetrics??b.metrics, actions: b.path.length?b.path:[b.action] }));
  return { candidates, selectedId: best?.rootId ?? null, path: best?.actions ?? [], nodes, stats, evaluated, elapsedMs: performance.now() - start, requestedDepth, completedDepth: candidates.length ? completedDepth : 0, reason, visiblePieces: pieces };
}
