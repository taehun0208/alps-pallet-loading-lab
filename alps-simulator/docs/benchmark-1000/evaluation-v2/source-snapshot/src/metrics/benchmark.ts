import { estimate, pairedEstimate, paretoIds, percentile, type Estimate } from './statistics';
import type { QualityMetrics } from './quality';

export interface DecisionTiming {
  index: number;
  plannerMs: number | null;
  workerRoundTripMs: number;
  budgetMs: number;
  cycleDeadlineMs: number;
  recognitionMs: number;
  validationMs: number;
  decisionReadyMs: number;
  validCycleDeadline: boolean;
  softDeadlineExceeded: boolean;
  workerTimedOut: boolean;
  fallbackUsed: boolean;
}

/** Rows preserve incomplete outcomes; only eligible outcomes enter quality rankings. */
export interface BenchmarkRow {
  id: string;
  algorithm: string;
  split: 'selection' | 'evaluation';
  seed: number;
  cycleSeconds: 10 | 12;
  planningBudgetMs: number;
  arrivalCount: number;
  processedCount: number;
  status: 'finished' | 'failed' | 'trial-timeout';
  violations: string[];
  quality: QualityMetrics;
  timing: DecisionTiming[];
  qualityEligible: boolean;
  deadlineEligible: boolean;
  rawPath?: string;
}

const QUALITY_KEYS = ['fill', 'count', 'cogOffsetMm', 'cogHeightMm', 'voidLiters', 'usedHeightMm',
  'columnVoidLiters', 'occupiedEnvelopeFraction', 'minSupport', 'maxLoadRatio'] as const;
export type QualityKey = typeof QUALITY_KEYS[number];

export interface BenchmarkSummary {
  id: string;
  algorithm: string;
  cycleSeconds: 10 | 12;
  n: number;
  expectedN: number;
  qualityEligibleN: number;
  deadlinePassN: number;
  allPassed: boolean;
  seeds: number[];
  failedIds: string[];
  metrics: Record<QualityKey, Estimate>;
  timing: {
    calls: number;
    softDeadlineMisses: number;
    workerTimeouts: number;
    fallbackCalls: number;
    plannerMeanMs: number | null;
    plannerP95Ms: number | null;
    plannerMaxMs: number | null;
    workerMeanMs: number | null;
    workerP95Ms: number | null;
    workerMaxMs: number | null;
  };
  pareto: boolean;
}

export function summarizeBenchmarks(rows: readonly BenchmarkRow[], algorithms: readonly string[], expectedSeeds: readonly number[], cycleSeconds: 10 | 12, split: 'selection' | 'evaluation' = 'evaluation'): BenchmarkSummary[] {
  const summaries = algorithms.map(algorithm => {
    const group = rows.filter(r => r.algorithm === algorithm && r.split === split && r.cycleSeconds === cycleSeconds).sort((a, b) => a.seed - b.seed);
    if (new Set(group.map(r => r.seed)).size !== group.length) throw new Error(`Duplicate seed for ${algorithm}`);
    if (group.some(r => !expectedSeeds.includes(r.seed))) throw new Error(`Unexpected seed for ${algorithm}`);
    const eligible = group.filter(r => r.qualityEligible && r.deadlineEligible);
    const timing = group.flatMap(r => r.timing);
    const planner = timing.map(t => t.plannerMs).filter((t): t is number => t != null && Number.isFinite(t));
    const worker = timing.map(t => t.workerRoundTripMs);
    const metrics = Object.fromEntries(QUALITY_KEYS.map(key => [key, estimate(eligible.map(r => r.quality[key]).filter((x): x is number => x !== null))])) as Record<QualityKey, Estimate>;
    return { id: `${cycleSeconds}:${algorithm}`, algorithm, cycleSeconds, n: eligible.length, expectedN: expectedSeeds.length,
      qualityEligibleN: group.filter(r => r.qualityEligible).length,
      deadlinePassN: group.filter(r => r.deadlineEligible).length,
      allPassed: eligible.length === expectedSeeds.length,
      seeds: group.map(r => r.seed), failedIds: group.filter(r => !r.qualityEligible || !r.deadlineEligible).map(r => r.id), metrics,
      timing: { calls: timing.length, softDeadlineMisses: timing.filter(t => t.softDeadlineExceeded).length,
        workerTimeouts: timing.filter(t => t.workerTimedOut).length, fallbackCalls: timing.filter(t => t.fallbackUsed).length,
        plannerMeanMs: estimate(planner).mean, plannerP95Ms: percentile(planner, .95), plannerMaxMs: planner.length ? Math.max(...planner) : null,
        workerMeanMs: estimate(worker).mean, workerP95Ms: percentile(worker, .95), workerMaxMs: worker.length ? Math.max(...worker) : null }, pareto: false };
  });
  const eligible = summaries.filter(s => s.allPassed && ['fill', 'cogOffsetMm', 'cogHeightMm'].every(k => s.metrics[k as QualityKey].mean !== null));
  const pareto = paretoIds(eligible, [{ direction: 'max', value: s => s.metrics.fill.mean! },
    { direction: 'min', value: s => s.metrics.cogOffsetMm.mean! }, { direction: 'min', value: s => s.metrics.cogHeightMm.mean! }]);
  return summaries.map(s => ({ ...s, pareto: pareto.includes(s.id) }));
}

export function pairedComparisons(rows: readonly BenchmarkRow[], algorithms: readonly string[], cycleSeconds: 10 | 12, expectedSeeds: readonly number[]) {
  const valid = rows.filter(r => r.cycleSeconds === cycleSeconds && r.split === 'evaluation' && r.qualityEligible && r.deadlineEligible);
  const pairs = [];
  for (let i = 0; i < algorithms.length; i++) for (let j = i + 1; j < algorithms.length; j++) {
    const left = valid.filter(r => r.algorithm === algorithms[i]), right = valid.filter(r => r.algorithm === algorithms[j]);
    for (const metric of ['fill', 'cogOffsetMm', 'cogHeightMm', 'voidLiters'] as const) {
      const availableLeft = left.filter(r => r.quality[metric] !== null), availableRight = right.filter(r => r.quality[metric] !== null);
      const result = pairedEstimate(availableLeft, availableRight, r => r.quality[metric]!);
      pairs.push({ cycleSeconds, left: algorithms[i], right: algorithms[j], metric, direction: 'left-minus-right', ...result,
        allSeedsPaired: result.n === expectedSeeds.length, multipleComparisonAdjusted: false });
    }
  }
  return pairs;
}
