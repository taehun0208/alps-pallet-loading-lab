import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { platform, arch, cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { ALGORITHMS, DEFAULT_CONFIG } from '../src/engine/config';
import { runTrial } from '../src/engine/core';
import { createPlannerSupervisor, type WorkerPort } from '../src/engine/supervisor';
import type { AlgorithmId, PlannerEvent, SimulationConfig, TrialResult } from '../src/engine/types';
import { benchmarkRow } from '../src/metrics/from-trial';
import { summarizeBenchmarks, pairedComparisons, type BenchmarkRow } from '../src/metrics/benchmark';
import { QUALITY_DEFINITIONS } from '../src/metrics/quality';

const ROOT = process.cwd(), OUT = resolve(ROOT, 'public/results');
const selectionSeeds = [11040, 11041], evaluationSeeds = [11042, 11043, 11044, 11045, 11046];
const algorithms = ALGORITHMS.map(a => a.id);
const startedAt = new Date().toISOString();
const pilot = process.argv.includes('--pilot');
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)]).sort();
}
const sourcePaths = [...sourceFiles(resolve(ROOT, 'src/engine')), ...sourceFiles(resolve(ROOT, 'src/metrics')), resolve(ROOT, 'scripts/benchmark.ts'), resolve(ROOT, 'scripts/benchmark-worker.ts')];
const hashes = sourcePaths.map(path => ({ path: relative(ROOT, path), sha256: hash(readFileSync(path)) }));
const sourceSha256 = hash(JSON.stringify(hashes));
const assumptions = [
  'New sequential executions in the same shared engine; no previous experiment rows reused.',
  'Synthetic 72-box input: 12 per SKU × 6 SKUs; maximum cargo height 1200 mm; one pallet; temporary buffer 0.',
  'Robot cycle targets 10 and 12 seconds are assumed operating targets, not measured robot cycle times.',
  'Recognition delay 0 seconds and validation/communication reserve 1 second are assumptions: available planner windows 9000 and 11000 ms.',
  'Heavy-over-light ordering prohibition excluded by mentor agreement; support, allowable top load and robot proxy checks remain active.',
  'Same shared candidate-search configuration and physical validation; algorithms may search/rank candidates differently. MCTS models future sequences from remaining counts, not actual future arrival order.',
  'Warm-up is a separate 6-box trial per algorithm and is excluded from benchmark rows.',
  'Single shared machine; wall-clock timings include scheduler effects. These are not CPU-time or real-robot sensing/IK measurements.',
  'Planner elapsed and worker dispatch elapsed are preserved separately; worker startup is excluded by the shared supervisor.',
  'A watchdog can stop search at 9/11 seconds and still deliver an earlier validated incumbent within the 10/12-second full cycle. Search termination is recorded separately from cycle deadline failure.',
  'Confidence intervals use independent arrival seeds (n=5 evaluation), Student t; pairwise intervals are exploratory and not multiplicity-adjusted.',
  'Static CoG and envelope void are descriptive proxies, not experimentally validated transport stability or trapped void.',
];

function workerFactory(): WorkerPort {
  const thread = new Worker(new URL('./benchmark-worker.mjs', import.meta.url));
  const port: WorkerPort = { onmessage: null, onerror: null, postMessage: message => thread.postMessage(message), terminate: () => { void thread.terminate(); } };
  thread.on('message', (data: PlannerEvent) => port.onmessage?.({ data }));
  thread.on('error', error => port.onerror?.({ message: error.message }));
  return port;
}
const supervisor = createPlannerSupervisor(workerFactory);
const metadata = { newSimulationExecuted: true, sourceSha256, sourceFiles: hashes,
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
  engineTransport: 'Node worker_threads with shared createPlannerSupervisor and canonical executePlanning',
  warmup: 'separate 6-box seed 99100 per algorithm; excluded', timingUnit: 'wall-clock milliseconds' };
const config = { ...DEFAULT_CONFIG, selectionSeeds, evaluationSeeds, cycles: [10, 12], algorithms,
  heavyRule: 'off', bufferCapacity: 0, arrivalCount: 72 };

type IndexedTrial = Omit<TrialResult, 'scenario' | 'arrivals' | 'placements' | 'unplaced' | 'unprocessed' | 'decisions'> & { split: 'discovery' | 'holdout'; traceUrl: string };
const indexRows: IndexedTrial[] = [], derived: BenchmarkRow[] = [];
function saveJSON(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
function csv(records: Record<string, unknown>[]) {
  const fields = [...new Set(records.flatMap(r => Object.keys(r)))];
  const cell = (value: unknown) => value == null ? '' : /[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  return fields.join(',') + '\n' + records.map(record => fields.map(f => cell(record[f])).join(',')).join('\n') + '\n';
}
function persist(final: boolean) {
  const summaries = ([10, 12] as const).flatMap(cycle => summarizeBenchmarks(derived, algorithms, evaluationSeeds, cycle));
  const selection = ([10, 12] as const).map(cycle => {
    const candidates = summarizeBenchmarks(derived, algorithms, selectionSeeds, cycle, 'selection').filter(s => s.allPassed);
    candidates.sort((a, b) => (b.metrics.fill.mean ?? -1) - (a.metrics.fill.mean ?? -1)
      || (a.metrics.cogOffsetMm.mean ?? Infinity) - (b.metrics.cogOffsetMm.mean ?? Infinity));
    return { cycleSeconds: cycle, algorithm: candidates[0]?.algorithm ?? null,
      rule: 'Among algorithms passing all selection seeds: highest mean fill, tie broken by lower mean horizontal CoG offset; evaluation seeds never used for selection.',
      summaries: candidates };
  });
  const completedAt = final ? new Date().toISOString() : null;
  saveJSON(resolve(OUT, 'index.json'), { schema: 'alps-sim-index/1', createdAt: startedAt, completedAt, complete: final,
    provenance: metadata, trials: indexRows, assumptions,
    downloads: { png: '/results/benchmark-10s-quality.png', svg: '/results/benchmark-10s-quality.svg', csv: '/results/trials.csv', json: '/results/summary.json' } });
  saveJSON(resolve(OUT, 'summary.json'), { schema: 'alps-benchmark/1', createdAt: startedAt, completedAt, complete: final, config, provenance: metadata,
    rows: derived, summaries, selection,
    pairedComparisons: ([10, 12] as const).flatMap(cycle => pairedComparisons(derived, algorithms, cycle, evaluationSeeds)),
    definitions: QUALITY_DEFINITIONS, assumptions });
  writeFileSync(resolve(OUT, 'trials.csv'), csv(derived.map(r => ({ id: r.id, algorithm: r.algorithm, split: r.split, seed: r.seed,
    cycleSeconds: r.cycleSeconds, planningBudgetMs: r.planningBudgetMs, arrivalCount: r.arrivalCount, processedCount: r.processedCount,
    status: r.status, qualityEligible: r.qualityEligible, deadlineEligible: r.deadlineEligible, ...r.quality,
    softDeadlineMisses: r.timing.filter(d => d.softDeadlineExceeded).length, workerTimeouts: r.timing.filter(d => d.workerTimedOut).length,
    rawPath: r.rawPath }))));
  writeFileSync(resolve(OUT, 'decisions.csv'), csv(derived.flatMap(r => r.timing.map(d => ({ trialId: r.id, algorithm: r.algorithm, split: r.split,
    seed: r.seed, cycleSeconds: r.cycleSeconds, ...d })))));
}

async function main() {
  mkdirSync(resolve(OUT, 'trials'), { recursive: true });
  const warmRows = [];
  for (const algorithm of algorithms) {
    const t = performance.now();
    const result = await runTrial({ ...DEFAULT_CONFIG, quantityPerSku: 1 }, algorithm, 99100, { planDecision: supervisor.planDecision });
    warmRows.push({ algorithm, elapsedMs: performance.now() - t, status: result.status, fill: result.metrics.fill,
      count: result.metrics.count, maxDecisionMs: result.metrics.maxDecisionMs, deadlineMisses: result.metrics.deadlineMisses,
      violations: result.violations, decisions: result.decisions.length });
    process.stdout.write(`warm ${algorithm}: ${result.metrics.count}/6, ${(performance.now() - t).toFixed(0)}ms, max ${result.metrics.maxDecisionMs?.toFixed(1)}ms\n`);
    if (result.status !== 'finished' || result.violations.length) throw Error(`Warm-up failed for ${algorithm}: ${result.reason} ${result.violations.join('; ')}`);
  }
  saveJSON(resolve(OUT, pilot ? 'pilot.json' : 'warmup.json'), { schema: 'alps-sim-pilot/1', createdAt: startedAt, provenance: metadata, config: { ...DEFAULT_CONFIG, quantityPerSku: 1 }, excludedFromBenchmark: true, rows: warmRows });
  if (pilot) return;
  const seeds = [...selectionSeeds, ...evaluationSeeds];
  // Rotate algorithm order by seed and cycle to limit fixed-order warm/cache bias.
  for (let s = 0; s < seeds.length; s++) for (const cycleSeconds of (s % 2 ? [12, 10] : [10, 12]) as (10 | 12)[]) {
    const offset = (s + (cycleSeconds === 12 ? 3 : 0)) % algorithms.length;
    const order = [...algorithms.slice(offset), ...algorithms.slice(0, offset)];
    for (const algorithm of order) {
      const seed = seeds[s], split = selectionSeeds.includes(seed) ? 'discovery' : 'holdout';
      const requestConfig: SimulationConfig = { ...DEFAULT_CONFIG, cycleSeconds };
      const started = performance.now();
      const row = await runTrial(requestConfig, algorithm as AlgorithmId, seed, { planDecision: supervisor.planDecision });
      const file = `${cycleSeconds}s-${seed}-${algorithm}.json`, traceUrl = `/results/trials/${file}`;
      saveJSON(resolve(OUT, 'trials', file), row);
      const { scenario: _scenario, arrivals: _arrivals, placements: _placements, unplaced: _unplaced, unprocessed: _unprocessed, decisions: _decisions, ...compact } = row;
      indexRows.push({ ...compact, split, traceUrl });
      derived.push(benchmarkRow(row, split === 'discovery' ? 'selection' : 'evaluation', traceUrl));
      const fingerprints = indexRows.filter(r => r.seed === seed && r.config.cycleSeconds === cycleSeconds).map(r => r.inputFingerprint);
      if (new Set(fingerprints).size !== 1) throw Error('Algorithms did not receive identical input');
      persist(false);
      process.stdout.write(`${indexRows.length}/84 ${cycleSeconds}s seed ${seed} ${algorithm}: ${row.metrics.count}/72 ${(row.metrics.fill * 100).toFixed(2)}% max ${row.metrics.maxDecisionMs?.toFixed(1)}ms misses ${row.metrics.deadlineMisses}, ${(performance.now() - started).toFixed(0)}ms ${row.status}\n`);
    }
  }
  for (const file of hashes) if (hash(readFileSync(resolve(ROOT, file.path))) !== file.sha256) throw Error(`Source changed during benchmark: ${file.path}`);
  persist(true);
  process.stdout.write(JSON.stringify({ completed: indexRows.length, sourceSha256, selected: [10, 12].map(cycleSeconds => ({ cycleSeconds })) }) + '\n');
}

main().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1; }).finally(() => supervisor.dispose());
