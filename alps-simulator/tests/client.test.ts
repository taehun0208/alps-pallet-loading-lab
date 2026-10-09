import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulationClient } from '../src/engine/client';
import { DEFAULT_CONFIG } from '../src/engine/config';
import type { ExperimentRequest } from '../src/engine/types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor(_url: URL, _options: WorkerOptions) { FakeWorker.instances.push(this); }
  postMessage(value: unknown) { this.posted.push(value); }
  terminate() { this.terminated = true; }
  // Deliberately allow a previously queued event after termination to test stale-event guards.
  emit(value: unknown) { this.onmessage?.({ data: value } as MessageEvent); }
  error(message: string) { this.onerror?.({ message } as ErrorEvent); }
}
const request = (): ExperimentRequest => ({ config: structuredClone(DEFAULT_CONFIG), algorithms: ['blb'], seeds: [1043] });

describe('simulation client run isolation', () => {
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => vi.unstubAllGlobals());

  it('replaces an old worker and only accepts events for the current run', () => {
    const receive = vi.fn(), client = createSimulationClient(receive);
    const oldId = client.start(request()), first = FakeWorker.instances[0];
    const newId = client.start(request()), second = FakeWorker.instances[1];
    expect(first.terminated).toBe(true);
    first.emit({ type: 'error', runId: oldId, message: 'old run' });
    expect(receive).not.toHaveBeenCalled();
    second.emit({ type: 'error', runId: newId, message: 'current run' });
    expect(receive).toHaveBeenCalledExactlyOnceWith({ type: 'error', runId: newId, message: 'current run' });
    client.dispose(); expect(second.terminated).toBe(true);
  });

  it('does not relabel a queued error from a replaced worker as the new run', () => {
    const receive = vi.fn(), client = createSimulationClient(receive);
    client.start(request()); const first = FakeWorker.instances[0];
    client.start(request()); first.error('late error from terminated worker');
    expect(receive).not.toHaveBeenCalled(); client.dispose();
  });

  it('sends cancellation to the current coordinator and disconnects callbacks on disposal', () => {
    const receive = vi.fn(), client = createSimulationClient(receive);
    const id = client.start(request()), worker = FakeWorker.instances[0];
    client.cancel(); expect(worker.posted.at(-1)).toEqual({ type: 'cancel', runId: id });
    client.dispose(); expect(worker.terminated).toBe(true);
    worker.emit({ type: 'error', runId: id, message: 'queued message' });
    worker.error('queued error'); expect(receive).not.toHaveBeenCalled();
  });
});
