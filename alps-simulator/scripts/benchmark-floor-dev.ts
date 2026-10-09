/** Development seeds only. Never consumes the independent 12042–12046 set. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { runTrial } from '../src/engine/core';
import { createPlannerSupervisor, type WorkerPort } from '../src/engine/supervisor';
import { benchmarkRow } from '../src/metrics/from-trial';
import { footprintMetrics } from '../src/metrics/footprint';
import type { AlgorithmId, PlannerEvent, TrialResult } from '../src/engine/types';

const root = process.cwd(), startedAt = new Date().toISOString(), stamp = startedAt.replaceAll(/[:.]/g, '-');
const out = resolve(root, 'public/results/development-floor', stamp), algorithm = 'floor-dense' as AlgorithmId;
mkdirSync(out, { recursive: true });
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]).sort(); }
const sourceFiles = [...files(resolve(root, 'src/engine')), ...files(resolve(root, 'src/metrics'))].map(path => ({ path: relative(root, path), sha256: sha(readFileSync(path)) }));
const sourceSha256 = sha(JSON.stringify(sourceFiles));
function factory(): WorkerPort {
  const thread = new Worker(new URL('./benchmark-worker.mjs', import.meta.url));
  const p: WorkerPort = { onmessage: null, onerror: null, postMessage: m => thread.postMessage(m), terminate: () => { void thread.terminate(); } };
  thread.on('message', (data: PlannerEvent) => p.onmessage?.({ data })); thread.on('error', e => p.onerror?.({ message: e.message })); return p;
}
const supervisor = createPlannerSupervisor(factory), rows: TrialResult[] = [];
async function main() {
  const warm = await runTrial({ ...DEFAULT_CONFIG, quantityPerSku: 1 }, algorithm, 99300, { planDecision: supervisor.planDecision });
  if (warm.status !== 'finished' || warm.violations.length) throw Error('Warm-up failed');
  for (const seed of [11040, 11041]) {
    const started = performance.now(), row = await runTrial({ ...DEFAULT_CONFIG, cycleSeconds: 10 }, algorithm, seed, { planDecision: supervisor.planDecision,
      onProgress: p => { if (p.processed % 12 === 0) process.stdout.write(`dev ${seed}: ${p.processed}/72 processed ${p.placements.length} placed\n`); } });
    const geometry = footprintMetrics(row.placements, row.scenario.pallet); benchmarkRow(row, 'selection'); rows.push(row);
    writeFileSync(resolve(out, `${seed}.json`), JSON.stringify(row, null, 2));
    const baseline = JSON.parse(readFileSync(resolve(root, `public/results/trials/10s-${seed}-capacity-compact.json`), 'utf8')) as TrialResult;
    const baseGeometry = footprintMetrics(baseline.placements, baseline.scenario.pallet);
    process.stdout.write(JSON.stringify({ seed, elapsedMs: performance.now() - started, floorDense: { fill: row.metrics.fill, count: row.metrics.count,
      floor: geometry.floorContactCoverage, columnVoidL: row.metrics.columnVoidMm3 / 1e6, maxMs: row.metrics.maxDecisionMs,
      misses: row.metrics.deadlineMisses, violations: row.violations }, preservedCompact: { fill: baseline.metrics.fill, count: baseline.metrics.count,
      floor: baseGeometry.floorContactCoverage, columnVoidL: baseline.metrics.columnVoidMm3 / 1e6 } }) + '\n');
  }
  for (const source of sourceFiles) if (sha(readFileSync(resolve(root, source.path))) !== source.sha256) throw Error(`Development source changed: ${source.path}`);
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ schema: 'alps-floor-development/1', startedAt, completedAt: new Date().toISOString(),
    evaluationStatus: 'development-only', independentEvaluationSeedsConsumed: [], sourceSha256, sourceFiles,
    config: DEFAULT_CONFIG, rows, limitations: ['Development seeds may guide subsequent tuning; no independent improvement claim.'] }, null, 2));
  process.stdout.write(`DEVELOPMENT_SAVED ${out}\n`);
}
main().catch(e => { process.stderr.write(String(e.stack ?? e) + '\n'); process.exitCode = 1; }).finally(() => supervisor.dispose());
