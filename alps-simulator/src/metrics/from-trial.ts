import type { TrialResult } from '../engine/types';
import { materialInfo } from '../engine/vendor/pallet/materials';
import type { BenchmarkRow } from './benchmark';
import { qualityMetrics } from './quality';

function close(a: number, b: number, field: string) {
  if (Math.abs(a - b) > Math.max(1e-7, Math.abs(b) * 1e-8)) throw Error(`Independent metric mismatch: ${field} (${a} vs ${b})`);
}

/** Recompute geometry and cargo CoG directly from final placements. */
export function benchmarkRow(row: TrialResult, split: BenchmarkRow['split'], rawPath?: string): BenchmarkRow {
  const quality = qualityMetrics(row.placements.map(p => ({ ...p, effectiveMaxLoadKg: materialInfo(p, row.scenario.constraints.stability).capacity })), row.scenario.pallet);
  close(quality.fill, row.metrics.fill, 'fill');
  close(quality.count, row.metrics.count, 'count');
  close(quality.volumeLiters * 1e6, row.metrics.volumeMm3, 'volume');
  close(quality.usedHeightMm, row.metrics.usedHeightMm, 'height');
  close(quality.voidLiters * 1e6, row.metrics.envelopeEmptyMm3, 'envelope void');
  close(quality.columnVoidLiters * 1e6, row.metrics.columnVoidMm3, 'column void');
  if (quality.cogOffsetMm !== null) close(quality.cogOffsetMm, row.metrics.cogHorizontalOffsetMm, 'CoG offset');
  if (quality.cogHeightMm !== null) close(quality.cogHeightMm, row.metrics.cogHeightMm, 'CoG height');
  if (row.arrivals.length !== row.placements.length + row.unplaced.length + row.unprocessed.length) throw Error('Box conservation failed');
  if (new Set([...row.placements, ...row.unplaced, ...row.unprocessed].map(p => p.id)).size !== row.arrivals.length) throw Error('Box identity conservation failed');
  const timing = row.decisions.map(d => ({ index: d.index, plannerMs: d.planningMs, workerRoundTripMs: d.decisionMs,
    budgetMs: d.availableMs, softDeadlineExceeded: d.planningMs > d.searchBudgetMs,
    cycleDeadlineMs: row.config.cycleSeconds * 1000, recognitionMs: d.recognitionMs, validationMs: d.validationMs,
    decisionReadyMs: d.recognitionMs + d.decisionMs + d.validationMs, validCycleDeadline: d.validDeadline,
    workerTimedOut: d.watchdog, fallbackUsed: d.fallback }));
  return {
    id: row.id, algorithm: row.algorithm, split, seed: row.seed, cycleSeconds: row.config.cycleSeconds,
    planningBudgetMs: (row.config.cycleSeconds - row.config.recognitionDelaySeconds - row.config.reserveSeconds) * 1000,
    arrivalCount: row.arrivals.length, processedCount: row.arrivals.length - row.unprocessed.length,
    status: row.status === 'finished' ? 'finished' : 'failed', violations: row.violations, quality, timing,
    qualityEligible: row.status === 'finished' && row.unprocessed.length === 0 && row.violations.length === 0,
    deadlineEligible: row.status === 'finished' && row.decisions.every(d => d.validDeadline && d.recognitionMs + d.decisionMs + d.validationMs <= row.config.cycleSeconds * 1000), rawPath,
  };
}
