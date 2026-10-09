import type { EngineCommand, EngineEvent, ExperimentRequest } from './types';
export type { ExperimentRequest, ExperimentResult, TrialResult, Progress, SimulationConfig, AlgorithmId } from './types';
/** Lightweight UI entry point. All numerical engine code is loaded inside workers. */
export function createSimulationClient(onEvent: (event: EngineEvent) => void) {
  let worker: Worker | null = null, activeId = '';
  return {
    start(request: ExperimentRequest) {
      worker?.terminate();
      worker = new Worker(new URL('./coordinator.worker.ts', import.meta.url), { type: 'module' });
      activeId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const runId = activeId, instance = worker;
      worker.onmessage = (e: MessageEvent<EngineEvent>) => { if (worker === instance && activeId === runId && e.data.runId === runId) onEvent(e.data); };
      worker.onerror = e => { if (worker === instance && activeId === runId) onEvent({ type: 'error', runId, message: e.message }); };
      worker.postMessage({ type: 'start', runId: activeId, request } satisfies EngineCommand);
      return activeId;
    },
    cancel() { if (worker && activeId) worker.postMessage({ type: 'cancel', runId: activeId } satisfies EngineCommand); },
    dispose() { activeId = ''; worker?.terminate(); worker = null; },
  };
}
