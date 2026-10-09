import type { DecisionOutcome, DecisionRequest, PlanDecision, PlannerEvent } from './types';
import { validateCandidate } from './validation';
export interface WorkerPort {
  onmessage: ((event: { data: PlannerEvent }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}
export interface SupervisorOptions {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  startupTimeoutMs?: number;
}
/** One sequential planner; deadline is measured from dispatch, after worker readiness. */
export function createPlannerSupervisor(factory: () => WorkerPort, options: SupervisorOptions = {}) {
  const now = options.now ?? (() => performance.now()), setTimer = options.setTimer ?? setTimeout, clearTimer = options.clearTimer ?? clearTimeout;
  let worker: WorkerPort | null = null, ready: Promise<void> | null = null, activeCancel: (() => void) | null = null, cancelStartup: (() => void) | null = null;
  const stop = () => { worker?.terminate(); worker = null; ready = null; };
  const ensureReady = () => {
    if (ready) return ready;
    const w = factory(); worker = w;
    ready = new Promise<void>((resolve, reject) => {
      const timer = setTimer(() => { stop(); reject(Error('Planner worker startup timeout')); }, options.startupTimeoutMs ?? 15000);
      cancelStartup = () => { clearTimer(timer); cancelStartup = null; stop(); reject(new DOMException('Cancelled', 'AbortError')); };
      w.onmessage = event => { if (worker === w && event.data.type === 'ready') { clearTimer(timer); cancelStartup = null; resolve(); } };
      w.onerror = event => { if (worker !== w) return; clearTimer(timer); cancelStartup = null; stop(); reject(Error(event.message)); };
    });
    return ready;
  };
  const planDecision: PlanDecision = async (request, signal) => {
    if (activeCancel) throw Error('Only one decision may be in flight');
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const readiness = ensureReady();
    const abortStartup = () => { cancelStartup?.(); stop(); };
    activeCancel = abortStartup;
    signal?.addEventListener('abort', abortStartup, { once: true });
    try { await readiness; } finally { signal?.removeEventListener('abort', abortStartup); activeCancel = null; }
    if (signal?.aborted || !worker) { stop(); throw new DOMException('Cancelled', 'AbortError'); }
    return new Promise<DecisionOutcome>((resolve, reject) => {
      const w = worker!, started = now(), budget = Math.min(request.availableMs, request.searchBudgetMs);
      let closed = false, incumbent: DecisionOutcome['candidate'] = null, incumbentMs = 0;
      const clean = () => { closed = true; clearTimer(timer); signal?.removeEventListener('abort', cancel); activeCancel = null; if (worker === w) { w.onmessage = null; w.onerror = null; } };
      const finish = (result: DecisionOutcome, terminate = false) => { if (closed) return; clean(); if (terminate) stop(); resolve(result); };
      const fallback = (reason: DecisionOutcome['fallbackReason'], message: string) => {
        finish({ candidate: incumbent, planningMs: incumbentMs, elapsedMs: now() - started, fallback: true, fallbackReason: reason,
          validDeadline: incumbent !== null, watchdog: reason === 'watchdog' || reason === 'search_budget', simulations: 0, completeScenarios: 0, message }, true);
      };
      const cancel = () => { if (closed) return; clean(); stop(); reject(new DOMException('Cancelled', 'AbortError')); };
      activeCancel = cancel;
      const timer = setTimer(() => fallback(request.searchBudgetMs < request.availableMs ? 'search_budget' : 'watchdog', 'Worker stopped at the search deadline; only an earlier validated incumbent can be used.'), budget);
      signal?.addEventListener('abort', cancel, { once: true });
      w.onmessage = ({ data }) => {
        if (closed || worker !== w || data.type === 'ready' || data.id !== request.id) return;
        const elapsed = now() - started;
        // A queued result after the deadline cannot beat the watchdog merely because its timer is delayed.
        if (elapsed > budget) { fallback(request.searchBudgetMs < request.availableMs ? 'search_budget' : 'watchdog', 'Late worker message discarded.'); return; }
        if (data.type === 'incumbent') {
          if (!validateCandidate(request.input, data.candidate).reasons.length) { incumbent = data.candidate; incumbentMs = data.planningMs; }
        } else if (data.type === 'result') {
          const errors = data.outcome.candidate ? validateCandidate(request.input, data.outcome.candidate).reasons : [];
          if (errors.length) { fallback('planner_error', errors.join(' / ')); return; }
          finish({ ...data.outcome, elapsedMs: elapsed, validDeadline: true, watchdog: false });
        } else fallback('planner_error', data.message);
      };
      w.onerror = event => { if (!closed && worker === w) fallback('planner_error', event.message); };
      w.postMessage({ type: 'plan', request });
    });
  };
  return { planDecision, dispose() { activeCancel?.(); stop(); } };
}
