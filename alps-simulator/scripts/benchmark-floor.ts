import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { platform, arch, cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { ALGORITHMS, DEFAULT_CONFIG } from '../src/engine/config';
import { runTrial } from '../src/engine/core';
import { createPlannerSupervisor, type WorkerPort } from '../src/engine/supervisor';
import type { AlgorithmId, PlannerEvent, SimulationConfig, TrialResult } from '../src/engine/types';
import { benchmarkRow } from '../src/metrics/from-trial';
import { footprintMetrics } from '../src/metrics/footprint';
import { summarizeBenchmarks, pairedComparisons, type BenchmarkRow } from '../src/metrics/benchmark';
import { QUALITY_DEFINITIONS } from '../src/metrics/quality';
import { estimate } from '../src/metrics/statistics';

const ROOT = process.cwd(), OUT = resolve(ROOT, 'public/results'), BASE = resolve(OUT, 'baseline-v1');
const selectionSeeds = [11040, 11041], reevaluationSeeds = [11042, 11043, 11044, 11045, 11046], evaluationSeeds = [12042, 12043, 12044, 12045, 12046];
const algorithms = ALGORITHMS.map(a => a.id), dense = 'floor-dense' as AlgorithmId;
const startedAt = new Date().toISOString(), pilot = process.argv.includes('--pilot');
if (!pilot && !process.argv.includes('--run')) throw Error('Explicit --pilot or --run required; independent evaluation seeds must remain untouched until freeze.');
if (!algorithms.includes(dense) || algorithms.length !== 7) throw Error('Wait for seven-algorithm engine freeze.');
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function sourceFiles(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? sourceFiles(join(dir, e.name)) : [join(dir, e.name)]).sort(); }
const sourcePaths = [...sourceFiles(resolve(ROOT, 'src/engine')), ...sourceFiles(resolve(ROOT, 'src/metrics')), resolve(ROOT, 'scripts/benchmark-floor.ts'), resolve(ROOT, 'scripts/benchmark-worker.ts')];
const hashes = sourcePaths.map(path => ({ path: relative(ROOT, path), sha256: hash(readFileSync(path)) }));
const sourceSha256 = hash(JSON.stringify(hashes));
const baselineIndex = JSON.parse(readFileSync(resolve(BASE, 'index.json'), 'utf8'));
const baselineSummary = JSON.parse(readFileSync(resolve(BASE, 'summary.json'), 'utf8'));
const baselineAudit = JSON.parse(readFileSync(resolve(BASE, 'audit.json'), 'utf8'));
if (baselineIndex.schema !== 'alps-sim-index/1' || !baselineIndex.complete || baselineIndex.trials.length !== 84) throw Error('Expected immutable complete 84-row baseline archive');
if (!pilot && evaluationSeeds.some(seed => algorithms.some(algorithm => existsSync(resolve(OUT, 'trials', `10s-${seed}-${algorithm}.json`)))))
  throw Error('Independent evaluation files already exist. Preserve the first outcomes; do not rerun/overwrite them as fresh holdout.');
for (const f of baselineAudit.rawFiles) if (hash(readFileSync(resolve(OUT, f.path))) !== f.sha256) throw Error(`Baseline raw changed: ${f.path}`);
const sharedFiles = baselineSummary.provenance.sourceFiles.filter((f: { path: string }) => f.path.startsWith('src/engine/vendor/') || ['src/engine/validation.ts', 'src/engine/supervisor.ts'].includes(f.path));
for (const f of sharedFiles) if (hash(readFileSync(resolve(ROOT, f.path))) !== f.sha256) throw Error(`Shared physical/search kernel changed: ${f.path}`);

type Status = 'selection' | 'baseline-reference' | 'development-reevaluation' | 'independent-evaluation';
type ExtendedRow = BenchmarkRow & { evaluationStatus: Status; analysisGroup: string; benchmarkSourceSha256: string; geometry: ReturnType<typeof footprintMetrics> };
type IndexedTrial = Omit<TrialResult, 'scenario' | 'arrivals' | 'placements' | 'unplaced' | 'unprocessed' | 'decisions'> & {
  split: 'discovery' | 'holdout'; traceUrl: string; evaluationStatus: Status; analysisGroup: string; benchmarkSourceSha256: string;
  geometryDerived?: boolean; geometrySource?: string;
};
function classification(seed: number, cycleSeconds: 10 | 12, isNew = false): { evaluationStatus: Status; analysisGroup: string } {
  if (selectionSeeds.includes(seed)) return { evaluationStatus: 'selection', analysisGroup: `selection-${cycleSeconds}s` };
  if (evaluationSeeds.includes(seed)) return { evaluationStatus: 'independent-evaluation', analysisGroup: 'independent-10s' };
  if (cycleSeconds === 12 || isNew) return { evaluationStatus: 'development-reevaluation', analysisGroup: `development-${cycleSeconds}s` };
  return { evaluationStatus: 'baseline-reference', analysisGroup: 'baseline-reference-10s' };
}
const indexRows: IndexedTrial[] = [], derived: ExtendedRow[] = [];
for (const brief of baselineIndex.trials) {
  const raw: TrialResult = JSON.parse(readFileSync(resolve(ROOT, 'public', brief.traceUrl.slice(1)), 'utf8'));
  const geometry = footprintMetrics(raw.placements, raw.scenario.pallet);
  const meta = { ...classification(raw.seed, raw.config.cycleSeconds), benchmarkSourceSha256: baselineSummary.provenance.sourceSha256 };
  indexRows.push({ ...brief, ...meta, metrics: { ...brief.metrics, floorCoverage: geometry.floorContactCoverage,
    floorContactAreaMm2: geometry.floorContactAreaMm2, projectedFootprintCoverage: geometry.projectedCoverage, projectedFootprintAreaMm2: geometry.projectedFootprintAreaMm2 },
    geometryDerived: true, geometrySource: 'independent-original-placement-recalculation' });
  const original = baselineSummary.rows.find((r: BenchmarkRow) => r.id === raw.id);
  if (!original) throw Error('Baseline derived row missing');
  derived.push({ ...original, ...meta, geometry });
}
function workerFactory(): WorkerPort {
  const thread = new Worker(new URL('./benchmark-worker.mjs', import.meta.url));
  const port: WorkerPort = { onmessage: null, onerror: null, postMessage: message => thread.postMessage(message), terminate: () => { void thread.terminate(); } };
  thread.on('message', (data: PlannerEvent) => port.onmessage?.({ data })); thread.on('error', error => port.onerror?.({ message: error.message })); return port;
}
const supervisor = createPlannerSupervisor(workerFactory);
const evaluationGroups = [
  { cycleSeconds: 10, seeds: evaluationSeeds, evaluationStatus: 'independent-evaluation', analysisGroup: 'independent-10s', label: '독립 평가 · 신규 입력 5개', algorithms },
  { cycleSeconds: 12, seeds: reevaluationSeeds, evaluationStatus: 'development-reevaluation', analysisGroup: 'development-12s', label: '개발 후 재평가 · 설계에 일부 사용한 입력 5개', algorithms },
];
const assumptions = [...baselineIndex.assumptions.filter((s: string) => !s.startsWith('New sequential executions')),
  'This revision reuses the preserved 84-row baseline and adds 49 actual executions. Baseline raw numbers are unchanged; each row records its source hash.',
  'Floor-dense development inspected seed 11042. Reused 11042–11046 comparisons are development reevaluation, not independent holdout confirmation.',
  'Independent confirmation uses previously untouched 12042–12046 at the 10-second operating target, all seven algorithms after code freeze.',
  'The main 10-second and 12-second panels use DIFFERENT seed sets and evaluation statuses; differences between them are not a causal effect of cycle duration.',
  'Floor-contact coverage is exact XY union of boxes touching z=0; projected coverage includes upper boxes; neither alone proves best final 3D packing.',
  'Floor-dense v2 was frozen after development on 11040/11041. Relative to its v1 development prototype it traded -1.79 percentage points of mean fill for +4.09 points of floor coverage and lower column void. This selection preceded all 12042–12046 runs.',
  'ALPS Tetris can expand beyond the shared base candidate count using edge/midpoint origins and a short forecast; policies share the same physical checks and wall-clock ceiling, not identical numbers of candidates or search operations.',
];
const config = { ...DEFAULT_CONFIG, selectionSeeds, evaluationSeeds, reevaluationSeeds, cycles: [10, 12], algorithms, heavyRule: 'off', bufferCapacity: 0, arrivalCount: 72 };
const provenance = { newSimulationExecuted: true, newTrialCountPlanned: 49, reusedBaselineTrials: 84, sourceSha256, sourceFiles: hashes,
  baselineSourceSha256: baselineSummary.provenance.sourceSha256, baselineIndexSha256: hash(readFileSync(resolve(BASE, 'index.json'))),
  sharedKernelUnchangedFiles: sharedFiles, baselineArchive: '/results/baseline-v1/index.json',
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
  engineTransport: 'Node worker_threads + shared createPlannerSupervisor + canonical executePlanning',
  freezeAt: startedAt, warmup: '6 boxes per algorithm at unrelated seed 99200; excluded',
  policySelection: { frozenPolicy: 'floor-dense v2', developmentSeeds: selectionSeeds, objective: 'Prioritize dense floor placement and lower column void while improving volume over preserved Compact on development inputs.',
    tuningAfterIndependentEvaluation: false, developmentArtifacts: [
      'development-floor/2026-10-09T18-51-01-365Z/results.json', 'development-floor/2026-10-09T18-55-31-876Z/results.json',
    ].map(path => ({ path, sha256: hash(readFileSync(resolve(OUT, path))) })) } };
function saveJSON(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
function csv(records: Record<string, unknown>[]) {
  const fields = [...new Set(records.flatMap(r => Object.keys(r)))];
  const cell = (v: unknown) => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v);
  return fields.join(',') + '\n' + records.map(r => fields.map(f => cell(r[f])).join(',')).join('\n') + '\n';
}
function persist(final: boolean) {
  const summaries = evaluationGroups.flatMap(group => {
    const rr = derived.filter(r => r.analysisGroup === group.analysisGroup);
    return summarizeBenchmarks(rr, algorithms, group.seeds, group.cycleSeconds as 10 | 12).map(s => {
      const eligible = rr.filter(r => r.algorithm === s.algorithm && r.qualityEligible && r.deadlineEligible);
      return { ...s, evaluationStatus: group.evaluationStatus, analysisGroup: group.analysisGroup,
        metrics: { ...s.metrics, floorContactCoverage: estimate(eligible.map(r => r.geometry.floorContactCoverage)), projectedCoverage: estimate(eligible.map(r => r.geometry.projectedCoverage)) } };
    });
  });
  const selection = ([10, 12] as const).map(cycle => {
    const candidates = summarizeBenchmarks(derived.filter(r => r.evaluationStatus === 'selection'), algorithms, selectionSeeds, cycle, 'selection').filter(s => s.allPassed)
      .sort((a, b) => (b.metrics.fill.mean ?? -1) - (a.metrics.fill.mean ?? -1) || (a.metrics.cogOffsetMm.mean ?? Infinity) - (b.metrics.cogOffsetMm.mean ?? Infinity));
    return { cycleSeconds: cycle, algorithm: candidates[0]?.algorithm ?? null, rule: 'Highest mean fill on two selection seeds; tie by horizontal CoG offset. New independent evaluation seeds excluded.', summaries: candidates };
  });
  const completedAt = final ? new Date().toISOString() : null;
  saveJSON(resolve(OUT, 'index.json'), { schema: 'alps-sim-index/2', createdAt: startedAt, completedAt, complete: final,
    provenance, evaluationGroups, trials: indexRows, assumptions,
    downloads: { png: '/results/benchmark-10s-quality.png', svg: '/results/benchmark-10s-quality.svg', csv: '/results/trials.csv', json: '/results/summary.json' } });
  saveJSON(resolve(OUT, 'summary.json'), { schema: 'alps-benchmark/2', createdAt: startedAt, completedAt, complete: final, config, provenance, evaluationGroups,
    rows: derived, summaries, selection,
    pairedComparisons: evaluationGroups.flatMap(g => pairedComparisons(derived.filter(r => r.analysisGroup === g.analysisGroup), algorithms, g.cycleSeconds as 10 | 12, g.seeds).map(p => ({ ...p, evaluationStatus: g.evaluationStatus, analysisGroup: g.analysisGroup }))),
    definitions: { ...QUALITY_DEFINITIONS, floorContactCoverage: 'Exact XY union of z=0 box footprints / pallet area; directly touching floor.', projectedCoverage: 'XY union of all box footprints / pallet area, including upper-box overhang.' }, assumptions });
  const geometryRows = derived.map(r => ({ id: r.id, algorithm: r.algorithm, split: r.split, seed: r.seed, cycleSeconds: r.cycleSeconds,
    evaluationStatus: r.evaluationStatus, analysisGroup: r.analysisGroup, ...r.geometry, fill: r.quality.fill,
    columnVoidLiters: r.quality.columnVoidLiters, envelopeVoidLiters: r.quality.voidLiters }));
  saveJSON(resolve(OUT, 'factor-geometry.json'), { schema: 'alps-floor-factors/2', newSimulationExecuted: false, evaluationGroups, rows: geometryRows,
    definitions: { floor: 'Direct floor-contact union, not sum of upper layers', projected: 'All-layer XY union', columnVoid: QUALITY_DEFINITIONS.columnVoidLiters },
    summaries: summaries.map(s => ({ algorithm: s.algorithm, cycleSeconds: s.cycleSeconds, evaluationStatus: s.evaluationStatus, floorContactCoverage: s.metrics.floorContactCoverage, projectedCoverage: s.metrics.projectedCoverage, columnVoidLiters: s.metrics.columnVoidLiters })) });
  writeFileSync(resolve(OUT, 'factor-geometry.csv'), csv(geometryRows));
  writeFileSync(resolve(OUT, 'trials.csv'), csv(derived.map(r => ({ id: r.id, algorithm: r.algorithm, split: r.split, seed: r.seed, cycleSeconds: r.cycleSeconds,
    evaluationStatus: r.evaluationStatus, analysisGroup: r.analysisGroup, planningBudgetMs: r.planningBudgetMs, status: r.status,
    qualityEligible: r.qualityEligible, deadlineEligible: r.deadlineEligible, ...r.quality, ...r.geometry, benchmarkSourceSha256: r.benchmarkSourceSha256, rawPath: r.rawPath }))));
  writeFileSync(resolve(OUT, 'decisions.csv'), csv(derived.flatMap(r => r.timing.map(t => ({ trialId: r.id, algorithm: r.algorithm, seed: r.seed, cycleSeconds: r.cycleSeconds, evaluationStatus: r.evaluationStatus, ...t })))));
}

async function main() {
  mkdirSync(resolve(OUT, 'trials'), { recursive: true });
  const warm = [];
  for (const algorithm of algorithms) {
    const started = performance.now(), row = await runTrial({ ...DEFAULT_CONFIG, quantityPerSku: 1 }, algorithm, 99200, { planDecision: supervisor.planDecision });
    if (row.status !== 'finished' || row.violations.length) throw Error(`Warmup failed: ${algorithm}`);
    warm.push({ algorithm, elapsedMs: performance.now() - started, metrics: row.metrics });
    process.stdout.write(`warm ${algorithm} ${row.metrics.count}/6 max ${row.metrics.maxDecisionMs?.toFixed(1)}ms\n`);
  }
  saveJSON(resolve(OUT, 'floor-warmup.json'), { schema: 'alps-sim-pilot/2', excludedFromBenchmark: true, sourceSha256, rows: warm });
  if (pilot) return;
  const specs: { algorithm: AlgorithmId; seed: number; cycleSeconds: 10 | 12 }[] = [];
  for (const seed of selectionSeeds) for (const cycleSeconds of [10, 12] as const) specs.push({ algorithm: dense, seed, cycleSeconds });
  for (let i = 0; i < evaluationSeeds.length; i++) {
    const offset = i % algorithms.length, order = [...algorithms.slice(offset), ...algorithms.slice(0, offset)];
    for (const algorithm of order) specs.push({ algorithm, seed: evaluationSeeds[i], cycleSeconds: 10 });
  }
  for (const seed of reevaluationSeeds) for (const cycleSeconds of [10, 12] as const) specs.push({ algorithm: dense, seed, cycleSeconds });
  persist(false);
  let completed = 0;
  for (const spec of specs) {
    const started = performance.now(), requestConfig: SimulationConfig = { ...DEFAULT_CONFIG, cycleSeconds: spec.cycleSeconds };
    const row = await runTrial(requestConfig, spec.algorithm, spec.seed, { planDecision: supervisor.planDecision });
    const geometry = footprintMetrics(row.placements, row.scenario.pallet);
    if (row.metrics.floorCoverage !== undefined && Math.abs(row.metrics.floorCoverage - geometry.floorContactCoverage) > 1e-9) throw Error('Floor coverage independent check failed');
    if (row.metrics.projectedFootprintCoverage !== undefined && Math.abs(row.metrics.projectedFootprintCoverage - geometry.projectedCoverage) > 1e-9) throw Error('Projected coverage independent check failed');
    const file = `${spec.cycleSeconds}s-${spec.seed}-${spec.algorithm}.json`, traceUrl = `/results/trials/${file}`;
    saveJSON(resolve(OUT, 'trials', file), row);
    const split = selectionSeeds.includes(spec.seed) ? 'discovery' : 'holdout', meta = { ...classification(spec.seed, spec.cycleSeconds, true), benchmarkSourceSha256: sourceSha256 };
    const { scenario: _scenario, arrivals: _arrivals, placements: _placements, unplaced: _unplaced, unprocessed: _unprocessed, decisions: _decisions, ...brief } = row;
    indexRows.push({ ...brief, split, traceUrl, ...meta, geometryDerived: false });
    derived.push({ ...benchmarkRow(row, split === 'discovery' ? 'selection' : 'evaluation', traceUrl), ...meta, geometry });
    // Input fingerprint excludes algorithm; equality also checks old/new shared inputs.
    const fingerprints = indexRows.filter(r => r.seed === spec.seed && r.config.cycleSeconds === spec.cycleSeconds).map(r => r.inputFingerprint);
    if (new Set(fingerprints).size !== 1) throw Error('Identical input contract failed');
    persist(false); completed++;
    process.stdout.write(`${completed}/49 ${spec.cycleSeconds}s ${spec.seed} ${spec.algorithm}: ${(row.metrics.fill * 100).toFixed(2)}% floor ${(geometry.floorContactCoverage * 100).toFixed(2)}% ${row.metrics.count}/72 max ${row.metrics.maxDecisionMs?.toFixed(1)}ms misses ${row.metrics.deadlineMisses} ${(performance.now() - started).toFixed(0)}ms\n`);
  }
  for (const f of hashes) if (hash(readFileSync(resolve(ROOT, f.path))) !== f.sha256) throw Error(`Source changed during run: ${f.path}`);
  for (const f of baselineAudit.rawFiles) if (hash(readFileSync(resolve(OUT, f.path))) !== f.sha256) throw Error(`Baseline raw altered: ${f.path}`);
  persist(true);
  process.stdout.write(JSON.stringify({ completedNew: 49, totalRows: indexRows.length, sourceSha256, independentRows: 35, baselineRawUnchanged: true }) + '\n');
}
main().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1; }).finally(() => supervisor.dispose());
