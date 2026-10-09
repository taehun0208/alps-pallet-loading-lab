import { describe, expect, it } from 'vitest';
import { defaultCapacityConfig, runCapacityTrial, selectedAlgorithm, summarizeCapacity, trialSpecs, validateConfig } from '../src/pallet/capacity/experiment';
import type { CapacityTrial, TrialSpec } from '../src/pallet/capacity/experiment';
import type { AlgorithmEntry } from '../src/pallet/benchmark/model';
import { getAlgorithm } from '../src/pallet/benchmark/registry';

const spec: TrialSpec = { algorithm: 'blb', mode: 'robot', height: 600, seed: 42, split: 'discovery' };
function small() { const c = defaultCapacityConfig(); c.scenario.types = [c.scenario.types[0]]; c.scenario.types[0].quantity = 4; c.algorithms = ['blb']; c.heights = [600]; c.settings.maxCandidates = 24; c.bufferCapacity = 1; return c; }
describe('single-arm capacity comparison', () => {
  it('attains the exact volume upper bound on a known eight-cube packing', () => {
    const c = small(); c.scenario.pallet = { width: 400, depth: 400, maxHeight: 400 };
    c.scenario.types[0] = { ...c.scenario.types[0], size: { w: 200, d: 200, h: 200 }, weight: 1, quantity: 10 };
    const r = runCapacityTrial(c, { ...spec, height: 400, algorithm: 'capacity-compact' });
    expect(r.status).toBe('finished'); expect(r.placements).toHaveLength(8); expect(r.utilization).toBe(1);
    expect(r.unplaced).toHaveLength(2); expect(r.extraFit).toBe(0); expect(r.violations).toEqual([]);
  });
  it('attributes workspace failures to the robot in the counterfactual audit', () => {
    const c = small(); c.scenario.constraints.workspace.zMax = 300;
    const a = runCapacityTrial(c, { ...spec, mode: 'space' }), b = runCapacityTrial(c, spec);
    expect(a.robotAudit.length).toBe(a.placements.length); expect(b.placements).toHaveLength(0);
    expect(b.rejections['robot-path']).toBeGreaterThan(0);
  });
  it('never commits a decision that exceeds its deadline or labels its partial prefix a winner', () => {
    const c = small(); c.decisionMs = .000001;
    const r = runCapacityTrial(c, spec);
    expect(r.status).toBe('timeout'); expect(r.deadlineMisses).toBe(1); expect(r.placements).toHaveLength(0);
    expect(r.unplaced.length + r.unprocessed.length).toBe(r.total); expect(selectedAlgorithm([r], c, 600)).toBeNull();
  });
  it('uses identical arrivals and fixed capacity while only switching robot constraints', () => {
    const c = small(), a = runCapacityTrial(c, { ...spec, mode: 'space' }), b = runCapacityTrial(c, spec);
    expect(a.status).toBe('finished'); expect(b.status).toBe('finished');
    expect(a.arrivals).toEqual(b.arrivals); expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.scenario.constraints.heavyRule).toBe('off'); expect(a.robotSeconds).toBeNull(); expect(b.robotSeconds).toBeGreaterThan(0);
    for (const r of [a, b]) { expect(r.violations).toEqual([]); expect(r.placements.length + r.unplaced.length + r.unprocessed.length).toBe(r.total); expect(r.utilization).toBeCloseTo(r.volume / (1200 * 1000 * 600)); }
  });
  it('detects payload-infeasible space-only placements and retains all unplaced boxes', () => {
    const c = small(); c.scenario.constraints.gripper.payload = 10;
    const a = runCapacityTrial(c, { ...spec, mode: 'space' }), b = runCapacityTrial(c, spec);
    expect(a.placements.length).toBeGreaterThan(0); expect(a.robotAudit.length).toBe(a.placements.length);
    expect(b.placements).toHaveLength(0); expect(b.unplaced).toHaveLength(4); expect(b.bufferPeak).toBe(1);
    expect(b.rejections.payload).toBeGreaterThan(0);
  });
  it('never leaks actual future arrival order or creates phantom stock in the buffer', () => {
    const c = small(); c.scenario.types.push({ ...c.scenario.types[0], id: 'S2', quantity: 2 });
    let calls = 0;
    const adapter: AlgorithmEntry = { ...getAlgorithm('blb'), plan(input) {
      calls++; expect(input.available).toBeUndefined(); expect('arrivals' in input).toBe(false);
      expect(Object.values(input.remaining).every(n => n >= 0)).toBe(true);
      expect(Object.values(input.remaining).reduce((a, b) => a + b, 0) + input.placements.length + 1).toBeLessThanOrEqual(6);
      return getAlgorithm('blb').plan(input);
    } };
    const r = runCapacityTrial(c, spec, adapter); expect(calls).toBeGreaterThan(0); expect(r.violations).toEqual([]);
  });
  it('continues after a blocked large box, preserving one-pallet and height boundaries', () => {
    const c = small(); c.scenario.types[0].size.h = 800;
    c.scenario.types.push({ ...c.scenario.types[0], id: 'S2', quantity: 2, size: { w: 200, d: 200, h: 200 } });
    const r = runCapacityTrial(c, { ...spec, mode: 'space' });
    expect(r.placements).toHaveLength(2); expect(r.unplaced).toHaveLength(4); expect(r.usedHeight).toBeLessThanOrEqual(600);
    expect(r.unprocessed).toEqual([]); expect(new Set(r.placements.map(p => p.id)).size).toBe(2);
  });
  it('only selects on complete discovery runs and never uses holdout performance to choose', () => {
    const c = small(); c.algorithms = ['blb', 'capacity-compact'];
    const base = runCapacityTrial(c, spec);
    const fake = (algorithm: string, seed: number, utilization: number, split: TrialSpec['split'] = 'discovery'): CapacityTrial => ({ ...base, algorithm, seed, utilization, split });
    const rows = [fake('blb', 42, .4), fake('blb', 43, .5), fake('capacity-compact', 42, .9), fake('capacity-compact', 1042, 1, 'holdout')];
    expect(selectedAlgorithm(rows, c, 600)).toBe('blb');
    rows.push(fake('capacity-compact', 43, .3)); expect(selectedAlgorithm(rows, c, 600)).toBe('capacity-compact');
    rows[4].status = 'timeout'; expect(selectedAlgorithm(rows, c, 600)).toBe('blb');
    expect(summarizeCapacity(rows, c, 600, 'robot', 'discovery')[1].eligible).toBe(false);
  });
  it('validates disjoint evaluation seeds and finite input ranges', () => {
    const c = small(); expect(trialSpecs(c)).toHaveLength(12);
    c.holdoutSeeds = [42]; expect(() => validateConfig(c)).toThrow('분리');
    c.holdoutSeeds = [1042]; c.heights = [NaN]; expect(() => validateConfig(c)).toThrow('높이');
  });
  it('same seed and budget reproduce placement coordinates in all modes', () => {
    const c = small();
    for (const mode of ['space', 'robot', 'organized'] as const) {
      const a = runCapacityTrial(c, { ...spec, mode }), b = runCapacityTrial(c, { ...spec, mode });
      expect(a.placements).toEqual(b.placements); expect(a.unplaced).toEqual(b.unplaced);
    }
  });
});
