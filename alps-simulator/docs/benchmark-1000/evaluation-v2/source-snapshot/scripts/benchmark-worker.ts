import { parentPort } from 'node:worker_threads';
import { executePlanning } from '../src/engine/planner';
import type { PlannerCommand, PlannerEvent } from '../src/engine/types';

if (!parentPort) throw Error('Benchmark planner requires a worker thread');
const port = parentPort;
const send = (event: PlannerEvent) => port.postMessage(event);
port.on('message', (message: PlannerCommand) => {
  if (message.type !== 'plan') return;
  const { request } = message;
  try {
    const outcome = executePlanning(request, (candidate, planningMs) => send({ type: 'incumbent', id: request.id, candidate, planningMs }));
    send({ type: 'result', id: request.id, outcome });
  } catch (error) {
    send({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
});
send({ type: 'ready' });
