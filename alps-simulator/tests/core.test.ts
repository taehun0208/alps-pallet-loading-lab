import { describe, expect, it } from 'vitest';
import { createExperiment, runTrial } from '../src/engine/core';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { capacityAlgorithm } from '../src/engine/vendor/pallet/capacity/experiment';
import type { DecisionOutcome, DecisionRequest, PlanDecision, SimulationConfig, TrialResult } from '../src/engine/types';

const config = (): SimulationConfig => ({ ...structuredClone(DEFAULT_CONFIG), quantityPerSku: 1, maxCandidates: 24 });
function validOutcome(r: DecisionRequest, elapsedMs = 20): DecisionOutcome {
  const analysis = capacityAlgorithm('blb').plan(structuredClone(r.input));
  return { candidate: analysis.candidates.find(c => c.id === analysis.selectedId) ?? null,
    planningMs: elapsedMs, elapsedMs, fallback: false, fallbackReason: 'none', validDeadline: true,
    watchdog: false, simulations: 0, completeScenarios: 0, message: 'deterministic test planner' };
}
function conserved(row: TrialResult) {
  const all = [...row.placements, ...row.unplaced, ...row.unprocessed];
  expect(all).toHaveLength(row.arrivals.length);
  expect(new Set(all.map(b => b.id)).size).toBe(row.arrivals.length);
  expect(all.map(b => b.id).sort()).toEqual(row.arrivals.map(b => b.id).sort());
}

describe('common engine trials use causal observations and conserve all cargo', () => {
  it('reproduces the same six-box input without mutating caller configuration', async () => {
    const c = config(), snapshot = structuredClone(c);
    const row = await runTrial(c, 'blb', 1043, { planDecision: async r => validOutcome(r) });
    expect(row.status).toBe('finished'); expect(row.violations).toEqual([]); conserved(row);
    expect(row.metrics.count).toBe(6); expect(row.metrics.massKg).toBe(37);
    expect(row.metrics.volumeMm3).toBe(155076000);
    expect(row.metrics.fill).toBeCloseTo(155076000 / 1440000000, 12);
    expect(row.scenario.constraints.heavyRule).toBe('off'); expect(c).toEqual(snapshot);
    const repeat = await runTrial(c, 'blb', 1043, { planDecision: async r => validOutcome(r) });
    expect(repeat.arrivals).toEqual(row.arrivals); expect(repeat.placements).toEqual(row.placements);
  });

  it('exposes only current cargo, confirmed state and residual counts to planning', async () => {
    let seen = 0;
    const row = await runTrial(config(), 'blb', 741093, { planDecision: async r => {
      seen++;
      expect(r.input.runId).toBe('common-online-trial');
      expect(r.input.available).toBeUndefined(); expect(r.input.buffer).toBeUndefined();
      expect('arrivals' in r.input).toBe(false); expect('scenario' in r.input).toBe(false);
      expect('arrival' in r.input).toBe(false); expect('seed' in r.input).toBe(false);
      expect(r.id).not.toContain('741093');
      expect(r.input.settings.plannerSeed).not.toBe(741093);
      expect(Object.values(r.input.remaining).reduce((a, b) => a + b, 0)).toBe(6 - seen);
      expect(Object.values(r.input.remaining).every(n => n >= 0)).toBe(true);
      return validOutcome(r);
    } });
    expect(row.status).toBe('finished'); expect(seen).toBe(6); conserved(row);
  });

  it.each([10, 12] as const)('overlaps preparation with a %ss cycle and charges startup only once', async cycleSeconds => {
    const row = await runTrial({ ...config(), cycleSeconds }, 'blb', 1043,
      { planDecision: async r => validOutcome(r, 2000) });
    expect(row.metrics.count).toBe(6); expect(row.metrics.robotSeconds).toBe(cycleSeconds * 6);
    const startup = 2 + row.decisions[0].validationMs / 1000;
    expect(row.metrics.planningWaitSeconds).toBeCloseTo(startup, 9);
    expect(row.metrics.totalSeconds).toBeCloseTo(6 * cycleSeconds + startup, 9);
    for (const d of row.decisions.slice(1)) expect(d.timing.exposedWaitSeconds).toBeCloseTo(0, 9);
    for (const d of row.decisions) {
      const preparation = (d.recognitionMs + d.decisionMs + d.validationMs) / 1000;
      expect(d.timing.exposedWaitSeconds + d.timing.overlappedPlanningSeconds).toBeCloseTo(preparation, 9);
    }
  });

  it('uses the reserved verification margin for a valid watchdog fallback at the planner deadline', async () => {
    const row = await runTrial(config(), 'blb', 1043, { planDecision: async r => ({
      ...validOutcome(r, r.availableMs), fallback: true, fallbackReason: 'watchdog', watchdog: true,
    }) });
    expect(row.metrics.count).toBe(6); expect(row.metrics.deadlineMisses).toBe(0);
    expect(row.metrics.fallbackCount).toBe(6); conserved(row);
  });

  it('never commits a late result beyond the robot command deadline', async () => {
    const row = await runTrial(config(), 'blb', 1043,
      { planDecision: async r => validOutcome(r, 11000) });
    expect(row.metrics.count).toBe(0); expect(row.unplaced).toHaveLength(6);
    expect(row.metrics.deadlineMisses).toBe(6); expect(row.metrics.robotSeconds).toBe(0); conserved(row);
  });

  it('keeps no-result cargo explicit and rejects a proposed boundary violation at commit', async () => {
    const none = await runTrial(config(), 'blb', 1043, { planDecision: async r => ({
      ...validOutcome(r), candidate: null, fallback: true, fallbackReason: 'no_valid_candidate',
    }) });
    expect(none.placements).toHaveLength(0); expect(none.unplaced).toHaveLength(6); conserved(none);
    const bad = await runTrial(config(), 'blb', 1043, { planDecision: async r => {
      const output = validOutcome(r); output.candidate!.placement.position.x = -100; return output;
    } });
    expect(bad.status).toBe('error'); expect(bad.placements).toHaveLength(0);
    expect(bad.violations.some(v => v.includes('경계 밖'))).toBe(true); conserved(bad);
  });

  it('conserves unprocessed boxes on planner failure and user cancellation', async () => {
    const failed = await runTrial(config(), 'blb', 1043,
      { planDecision: async () => { throw Error('forced planning failure'); } });
    expect(failed.status).toBe('error'); expect(failed.unprocessed).toHaveLength(6); conserved(failed);
    const abort = new AbortController(); let count = 0;
    const cancel: PlanDecision = async r => { count++; if (count === 2) abort.abort(); return validOutcome(r); };
    const cancelled = await runTrial(config(), 'blb', 1043, { planDecision: cancel, signal: abort.signal });
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.placements).toHaveLength(1);
    expect(cancelled.unprocessed).toHaveLength(5); conserved(cancelled);
  });

  it('passes identical arrival data to competing algorithms and rejects duplicate trial keys', async () => {
    const request = { config: config(), algorithms: ['blb', 'mcts'] as const, seeds: [1043] };
    const result = await createExperiment({ ...request, algorithms: [...request.algorithms] },
      { planDecision: async r => validOutcome(r) });
    expect(result.rows).toHaveLength(2); expect(result.rows[0].arrivals).toEqual(result.rows[1].arrivals);
    expect(result.rows[0].inputFingerprint).toBe(result.rows[1].inputFingerprint);
    await expect(createExperiment({ ...request, algorithms: ['blb', 'blb'] },
      { planDecision: async r => validOutcome(r) })).rejects.toThrow('distinct');
  });
});
