/// <reference lib="webworker" />
import { runCapacityTrial, trialSpecs } from './experiment';
import type { CapacityConfig } from './experiment';
self.onmessage = (e: MessageEvent<CapacityConfig>) => {
  try {
    const specs = trialSpecs(e.data);
    const warm = structuredClone(e.data); warm.scenario.types.forEach(t => t.quantity = 1);
    for (const algorithm of warm.algorithms) {
      self.postMessage({ type: 'warmup', algorithm });
      runCapacityTrial(warm, { algorithm, mode: 'robot', height: 1200, seed: 9001, split: 'discovery' });
    }
    for (let i = 0; i < specs.length; i++) {
      self.postMessage({ type: 'start', spec: specs[i], index: i, total: specs.length });
      self.postMessage({ type: 'row', row: runCapacityTrial(e.data, specs[i]), done: i + 1, total: specs.length });
    }
    self.postMessage({ type: 'done' });
  } catch (e) { self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) }); }
};
