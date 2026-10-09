import { describe, expect, it } from 'vitest';
import { ALGORITHMS } from '../src/engine/config';
import { executePlanning } from '../src/engine/planner';
import { validateCandidate } from '../src/engine/validation';
import { defaultCapacityConfig } from '../src/engine/vendor/pallet/capacity/experiment';
import { ArrivalEnvironment } from '../src/engine/vendor/pallet/environment';
import { emptyFrame } from '../src/engine/vendor/pallet/types';
import type { AlgorithmId, Candidate, DecisionRequest } from '../src/engine/types';

function request(algorithm: AlgorithmId): DecisionRequest {
  const c = defaultCapacityConfig();
  c.scenario.types = c.scenario.types.slice(0, 2).map(t => ({ ...t, quantity: 1,
    size: { w: 200, d: 200, h: 200 }, weight: 1, maxLoadKg: 100 }));
  c.settings.maxCandidates = 12;
  const input = new ArrivalEnvironment(c.scenario).input(emptyFrame(), 'greedy', c.settings, 'two-cubes')!;
  return { id: algorithm, algorithm, input, availableMs: 9000, searchBudgetMs: 9000,
    mcts: { depth: 1, scenarios: 2, maxIterations: 48 } };
}

describe('all algorithm adapters share one observed input and validation contract', () => {
  it.each(ALGORITHMS.map(a => a.id))('%s returns common-constraint-valid immutable cargo', algorithm => {
    const r = request(algorithm), before = structuredClone(r), published: Candidate[] = [];
    const result = executePlanning(r, c => published.push(structuredClone(c)));
    expect(result.candidate).not.toBeNull(); expect(published.length).toBeGreaterThan(0);
    for (const c of [...published, result.candidate!]) {
      expect(validateCandidate(r.input, c).reasons).toEqual([]);
      expect(c.placement.id).toBe(r.input.current.id);
      expect(c.placement.weight).toBe(r.input.current.weight);
    }
    expect(r).toEqual(before);
    if (algorithm === 'mcts') {
      expect(result.simulations).toBeGreaterThan(0);
      expect(result.completeScenarios).toBeGreaterThan(0);
      expect(result.fallback).toBe(false);
    }
  });

  it('does not manufacture a placement when cargo plus gripper exceeds payload', () => {
    const r = request('mcts'); r.input.constraints.gripper.payload = r.input.constraints.gripper.mass;
    let published = 0;
    const result = executePlanning(r, () => published++);
    expect(published).toBe(0); expect(result.candidate).toBeNull();
    expect(result.fallbackReason).toBe('no_valid_candidate');
  });
});
