import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlannerSupervisor, type WorkerPort } from '../src/engine/supervisor';
import { capacityAlgorithm, defaultCapacityConfig } from '../src/engine/vendor/pallet/capacity/experiment';
import { ArrivalEnvironment } from '../src/engine/vendor/pallet/environment';
import { emptyFrame } from '../src/engine/vendor/pallet/types';
import type { Candidate, DecisionOutcome, DecisionRequest, PlannerEvent } from '../src/engine/types';

class PlannerWorker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  commands: unknown[] = [];
  terminated = false;
  postMessage(message: unknown) { this.commands.push(message); }
  terminate() { this.terminated = true; }
  emit(data: PlannerEvent) { this.onmessage?.({ data }); }
}
function request(): DecisionRequest {
  const c = defaultCapacityConfig(), env = new ArrivalEnvironment(c.scenario);
  return { id: 'decision-1', algorithm: 'blb', input: env.input(emptyFrame(), 'greedy', c.settings, 'test')!,
    availableMs: 100, searchBudgetMs: 100, mcts: { depth: 1, scenarios: 1, maxIterations: 1 } };
}
function candidate(r: DecisionRequest): Candidate {
  const a = capacityAlgorithm('blb').plan(r.input);
  return a.candidates.find(c => c.id === a.selectedId)!;
}
const outcome = (c: Candidate | null): DecisionOutcome => ({ candidate: c, planningMs: 1, elapsedMs: 1,
  fallback: false, fallbackReason: c ? 'none' : 'no_valid_candidate', validDeadline: true,
  watchdog: false, simulations: 1, completeScenarios: 1, message: 'fixture' });
function setup() {
  const workers: PlannerWorker[] = [];
  const supervisor = createPlannerSupervisor(() => { const w = new PlannerWorker(); workers.push(w); return w; },
    { now: () => Date.now(), startupTimeoutMs: 50 });
  return { supervisor, workers };
}
async function ready(w: PlannerWorker) { w.emit({ type: 'ready' }); await Promise.resolve(); }

describe('deadline supervisor uses only a previously validated result', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('terminates a stalled worker and returns its previously checked incumbent', async () => {
    const r = request(), c = candidate(r), { supervisor, workers } = setup();
    const result = supervisor.planDecision(r); await ready(workers[0]);
    workers[0].emit({ type: 'incumbent', id: r.id, candidate: c, planningMs: 2 });
    await vi.advanceTimersByTimeAsync(100);
    const got = await result;
    expect(workers[0].terminated).toBe(true); expect(got.candidate?.placement.id).toBe(r.input.current.id);
    expect(got).toMatchObject({ fallback: true, fallbackReason: 'watchdog', validDeadline: true, watchdog: true });
    expect(got.elapsedMs).toBe(100); supervisor.dispose();
  });

  it('rejects a late best result even when the deadline timer has not run yet', async () => {
    const r = request(), c = candidate(r), { supervisor, workers } = setup();
    const result = supervisor.planDecision(r); await ready(workers[0]);
    workers[0].emit({ type: 'incumbent', id: r.id, candidate: c, planningMs: 2 });
    vi.setSystemTime(101);
    workers[0].emit({ type: 'result', id: r.id, outcome: { ...outcome(c), simulations: 999 } });
    expect(await result).toMatchObject({ fallback: true, fallbackReason: 'watchdog', simulations: 0 });
    expect(workers[0].terminated).toBe(true); supervisor.dispose();
  });

  it('returns no placement when the deadline arrives without a valid incumbent', async () => {
    const r = request(), invalid = candidate(r), { supervisor, workers } = setup();
    invalid.placement.position.x = -100;
    const result = supervisor.planDecision(r); await ready(workers[0]);
    workers[0].emit({ type: 'incumbent', id: r.id, candidate: invalid, planningMs: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ candidate: null, fallback: true, validDeadline: false });
    expect(workers[0].terminated).toBe(true); supervisor.dispose();
  });

  it('preserves the difference between a 100ms ablation budget and the robot deadline', async () => {
    const r = { ...request(), availableMs: 9000, searchBudgetMs: 100 }, { supervisor, workers } = setup();
    const result = supervisor.planDecision(r); await ready(workers[0]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ fallbackReason: 'search_budget', elapsedMs: 100 }); supervisor.dispose();
  });

  it('rejects identity-spoofed output and terminates the erroneous worker', async () => {
    const r = request(), invalid = candidate(r), { supervisor, workers } = setup();
    invalid.placement.id = 'another-box';
    const result = supervisor.planDecision(r); await ready(workers[0]);
    workers[0].emit({ type: 'result', id: r.id, outcome: outcome(invalid) });
    expect(await result).toMatchObject({ candidate: null, fallbackReason: 'planner_error' });
    expect(workers[0].terminated).toBe(true); supervisor.dispose();
  });

  it('ignores foreign decision IDs and treats worker failure as an explicit fallback', async () => {
    const r = request(), { supervisor, workers } = setup();
    const result = supervisor.planDecision(r); await ready(workers[0]);
    workers[0].emit({ type: 'result', id: 'previous-decision', outcome: outcome(null) });
    workers[0].onerror?.({ message: 'forced worker failure' });
    expect(await result).toMatchObject({ candidate: null, fallbackReason: 'planner_error' });
    expect(workers[0].terminated).toBe(true); supervisor.dispose();
  });

  it('cancels an active computation and refuses subsequent queued results', async () => {
    const r = request(), { supervisor, workers } = setup(), abort = new AbortController();
    const result = supervisor.planDecision(r, abort.signal); await ready(workers[0]);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await rejected;
    expect(workers[0].terminated).toBe(true); expect(workers[0].onmessage).toBeNull(); supervisor.dispose();
  });

  it('also cancels while waiting for initial worker readiness', async () => {
    const { supervisor, workers } = setup(), abort = new AbortController();
    const result = supervisor.planDecision(request(), abort.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await Promise.resolve();
    const stoppedBeforeReady = workers[0].terminated;
    workers[0].emit({ type: 'ready' });
    await rejected; expect(stoppedBeforeReady).toBe(true); supervisor.dispose();
  });

  it('terminates a worker that never becomes ready', async () => {
    const { supervisor, workers } = setup();
    const result = supervisor.planDecision(request());
    const rejected = expect(result).rejects.toThrow('startup timeout');
    await vi.advanceTimersByTimeAsync(50); await rejected;
    expect(workers[0].terminated).toBe(true); supervisor.dispose();
  });
});
