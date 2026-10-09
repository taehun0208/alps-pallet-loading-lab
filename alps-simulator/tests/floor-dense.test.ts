import { describe, expect, it } from 'vitest';
import { compareDenseRank, denseRank, newColumnVoid } from '../src/engine/floorDense';
import { executePlanning } from '../src/engine/planner';
import { validateCandidate } from '../src/engine/validation';
import { defaultCapacityConfig } from '../src/engine/vendor/pallet/capacity/experiment';
import { inspectConstraints } from '../src/engine/vendor/pallet/constraints';
import type { Candidate, DecisionRequest, Observation, Placement, PlanningInput } from '../src/engine/types';

function block(id: string, x: number, y: number, z: number, w = 200, d = 200, h = 200): Placement {
  return { id, typeId: id, position: { x, y, z }, size: { w, d, h }, weight: 2,
    orientation: 0, supports: [], supportRatio: z === 0 ? 1 : 0, loadAbove: 0,
    material: 'paper', maxLoadKg: 100, maxLoadSource: 'synthetic', handling: 'upright', friction: .45 };
}
function input(placements: Placement[] = [], size = { w: 200, d: 200, h: 200 }, width = 400, depth = 200): PlanningInput {
  const config = defaultCapacityConfig();
  const current: Observation = { id: 'current', typeId: 'current', size, weight: 2, status: 'normal',
    orientationAllowed: [0, 90], maxLoadKg: 100, maxLoadSource: 'synthetic', material: 'paper', handling: 'upright', friction: .45 };
  return { runId: 'known-fixture', stepId: placements.length, current, placements,
    pallet: { width, depth, maxHeight: 800 }, constraints: structuredClone(config.scenario.constraints),
    types: [{ ...config.scenario.types[0], id: 'current', size, weight: 2, quantity: 1, maxLoadKg: 100 }],
    remaining: { current: 0 }, algorithm: 'greedy', settings: { ...structuredClone(config.settings), maxCandidates: 12 } };
}
function request(observed: PlanningInput): DecisionRequest {
  return { id: 'dense-fixture', algorithm: 'floor-dense', input: observed, availableMs: 9000, searchBudgetMs: 9000,
    mcts: { depth: 1, scenarios: 1, maxIterations: 1 } };
}
function currentPlacement(observed: PlanningInput, x: number, z: number): Placement {
  return { ...block('current', x, 0, z, observed.current.size.w, observed.current.size.d, observed.current.size.h),
    weight: observed.current.weight };
}

describe('floor-dense geometric priorities and shared feasibility', () => {
  it('places on a valid floor gap before a valid upper layer', () => {
    const observed = input([block('foundation', 0, 0, 0)]);
    const floor = currentPlacement(observed, 200, 0), upper = currentPlacement(observed, 0, 200);
    for (const proposal of [floor, upper]) expect(inspectConstraints(proposal, observed.current, observed.placements, observed.pallet, observed.constraints).reasons).toEqual([]);
    expect(compareDenseRank(denseRank(floor, observed), denseRank(upper, observed))).toBeLessThan(0);
    const before = structuredClone(observed), published: Candidate[] = [];
    const result = executePlanning(request(observed), c => published.push(structuredClone(c)));
    expect(result.candidate).not.toBeNull(); expect(result.candidate!.placement.position.z).toBe(0);
    expect(result.candidate!.placement.position.x).toBe(200);
    expect(validateCandidate(observed, result.candidate!).reasons).toEqual([]);
    expect(result.candidate!.placement.size).toEqual(observed.current.size);
    expect(observed).toEqual(before);
    for (const candidate of published) expect(validateCandidate(observed, candidate).reasons).toEqual([]);
  });

  it('integrates a known one-liter bridge gap and does not count an old cavity a second time', () => {
    const pillars = [block('left', 0, 0, 0, 100, 100, 100), block('right', 200, 0, 0, 100, 100, 100)];
    const bridge = block('bridge', 0, 0, 100, 300, 100, 100);
    expect(newColumnVoid(bridge, pillars)).toBe(1_000_000);
    const upper = block('upper', 0, 0, 200, 300, 100, 100);
    expect(newColumnVoid(upper, [...pillars, bridge])).toBe(0);
    expect(newColumnVoid(block('floor', 400, 0, 0, 100, 100, 100), pillars)).toBe(0);
  });

  it('prefers a full bearing surface to a feasible bridge that buries 0.8 liters of new space', () => {
    const supports = [block('solid', 0, 0, 0, 400), block('left', 500, 0, 0, 190), block('right', 710, 0, 0, 190)];
    const observed = input(supports, { w: 400, d: 200, h: 100 }, 1000, 200);
    const solid = currentPlacement(observed, 0, 200), bridge = currentPlacement(observed, 500, 200);
    for (const proposal of [solid, bridge]) expect(inspectConstraints(proposal, observed.current, supports, observed.pallet, observed.constraints).reasons).toEqual([]);
    expect(newColumnVoid(solid, supports)).toBe(0); expect(newColumnVoid(bridge, supports)).toBe(800_000);
    expect(compareDenseRank(denseRank(solid, observed), denseRank(bridge, observed))).toBeLessThan(0);
  });

  it('favors flush same-height side contact over an isolated floor placement', () => {
    const observed = input([block('neighbor', 0, 0, 0)], { w: 200, d: 200, h: 200 }, 1000, 200);
    const adjacent = currentPlacement(observed, 200, 0), isolated = currentPlacement(observed, 400, 0);
    const near = denseRank(adjacent, observed), far = denseRank(isolated, observed);
    expect(near.slice(0, 3)).toEqual(far.slice(0, 3));
    expect(near[3]).toBe(-200); expect(far[3]).toBeCloseTo(0, 12);
    expect(compareDenseRank(near, far)).toBeLessThan(0);
  });

  it('rotates a wide next box onto two connected support boxes without changing its volume', () => {
    const observed = input([block('left', 0, 0, 0), block('right', 200, 0, 0)], { w: 200, d: 400, h: 100 });
    const result = executePlanning(request(observed));
    expect(result.candidate).not.toBeNull();
    const placed = result.candidate!.placement;
    expect(placed.orientation).toBe(90); expect(placed.size).toEqual({ w: 400, d: 200, h: 100 });
    expect(placed.position).toEqual({ x: 0, y: 0, z: 200 });
    expect(placed.size.w * placed.size.d * placed.size.h).toBe(200 * 400 * 100);
    expect(placed.supports.map(s => s.id).sort()).toEqual(['left', 'right']);
    expect(placed.supportRatio).toBe(1); expect(validateCandidate(observed, result.candidate!).reasons).toEqual([]);
  });

  it.each(['payload', 'height', 'support-load'] as const)('returns no unsafe fallback when %s makes all placements impossible', failure => {
    const foundation = block('foundation', 0, 0, 0);
    const observed = input([foundation], { w: 200, d: 200, h: 200 }, 200, 200);
    if (failure === 'payload') observed.constraints.gripper.payload = observed.constraints.gripper.mass;
    if (failure === 'height') observed.pallet.maxHeight = 200;
    if (failure === 'support-load') foundation.maxLoadKg = 1;
    const published: Candidate[] = [], result = executePlanning(request(observed), c => published.push(c));
    expect(result.candidate).toBeNull(); expect(published).toEqual([]);
    expect(result.fallbackReason).toBe('no_valid_candidate');
  });

  it('does not alter its choice when hidden order metadata changes outside the observation contract', () => {
    const observed = input([block('foundation', 0, 0, 0)]);
    const a = request(structuredClone(observed)), b = request(structuredClone(observed));
    // The current observation, confirmed geometry and known inventory remain identical.
    // These adversarial suffix fields are not part of PlanningInput and must be ignored.
    Object.assign(a.input, { actualFutureOrder: ['S6', 'S1'], actualArrivalSeed: 42 });
    Object.assign(b.input, { actualFutureOrder: ['S1', 'S6'], actualArrivalSeed: 9999 });
    a.id = 'opaque-a'; b.id = 'opaque-b';
    const first = executePlanning(a), second = executePlanning(b);
    expect(first.candidate!.placement).toEqual(second.candidate!.placement);
    expect(first.searchDiagnostics?.rank).toEqual(second.searchDiagnostics?.rank);
  });
});
