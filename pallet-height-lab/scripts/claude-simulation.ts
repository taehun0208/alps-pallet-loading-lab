/** Restricted local calculation tool. Compile to node_modules/.cache/claude-simulation.mjs.
 * The caller may select one fixed case; it cannot provide code, commands, paths or settings.
 * Existing execution artifacts are immutable. No source benchmark rows are reused as new runs.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distribution } from '../src/pallet/benchmark/statistics';
import { PRESENTATION_VERSION, choosePolicies, eligible, pairedReport, policy, runOrder, validatePresentationConfig } from '../src/pallet/presentation/model';
import type { OrderRun, Policy, PresentationConfig } from '../src/pallet/presentation/model';
import { CAPACITY_VERSION, defaultCapacityConfig, runCapacityTrial, selectedAlgorithm, summarizeCapacity, validateConfig } from '../src/pallet/capacity/experiment';
import type { CapacityConfig, CapacityTrial } from '../src/pallet/capacity/experiment';

const CASES = ['before', 'after', 'extremes', 'hybrid', 'hrpal', 'capacity'] as const;
type Case = typeof CASES[number];
const ALGORITHMS = ['blb', 'capacity-compact', 'strategy-greedy', 'lookahead', 'future-hybrid'];
const MODEL_SOURCES = ['src/pallet/presentation/model.ts', 'src/pallet/capacity/experiment.ts'] as const;
const INPUT_PATH = 'public/presentation-example.json';
const SCRIPT_PATH = 'scripts/claude-simulation.ts';
const EXECUTION_SCHEMA = 'alps-claude-execution/1';
const bundledPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(bundledPath), '../..');
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const read = (relative: string) => readFileSync(resolve(root, relative));
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

interface Dataset {
  schema: string; createdAt: string; extendedAt?: string; sourceCommit: string;
  sourceHashes: Record<string, string>; config: PresentationConfig;
  selection: { baseline: Policy; alps: Policy | null; worst: Policy | null };
  rows: OrderRun[];
}
interface Execution {
  schema: string; case: Case; status: 'executed' | 'not_evaluated';
  startedAt: string; finishedAt: string; wallSeconds: number;
  provenance: { inputPath: string; inputSha256: string; modelSchema: string; sourceHashes: Record<string, string>; sourceCommit: string; scriptSha256: string; bundleSha256: string; inputCreatedAt: string; inputExtendedAt: string | null };
  environment: { os: string; arch: string; release: string; cpu: string | null; logicalCpus: number; node: string; execution: string };
  config: PresentationConfig; selection: Dataset['selection']; policies: Policy[];
  warmup: { seed: number; boxesPerType: number; excludedFromRowsAndStatistics: true; runs: { policy: string; status: string; reason: string }[] } | null;
  rows: OrderRun[]; summary: ReturnType<typeof summarize>[];
  pairedReports: { before: string; after: string; report: ReturnType<typeof pairedReport> }[];
  assumptions: string[]; limitations: string[]; metrics?: null;
  hrpal?: { product: string; version: string; supportedOs: string; executed: false; substituteAlgorithmUsed: false; evidenceAsOf: string; accessStatus: string[]; officialUrls: string[]; researchPath: string };
}

function assertPolicy(value: Policy | null, label: string): asserts value is Policy {
  if (!value || !ALGORITHMS.includes(value.algorithm) || typeof value.organized !== 'boolean' || value.id !== policy(value.algorithm, value.organized).id) throw Error(`Invalid saved ${label} policy`);
}

function loadDataset() {
  const bytes = read(INPUT_PATH), d = JSON.parse(bytes.toString('utf8')) as Dataset;
  if (d.schema !== PRESENTATION_VERSION || d.schema !== 'alps-complete-order/2') throw Error('Pipeline v2 input is required');
  if (!d.sourceHashes || Object.keys(d.sourceHashes).sort().join('|') !== [...MODEL_SOURCES].sort().join('|')) throw Error('Expected exactly the two approved model source hashes');
  for (const path of MODEL_SOURCES) {
    if (!/^[a-f0-9]{64}$/.test(d.sourceHashes[path]) || sha(read(path)) !== d.sourceHashes[path]) throw Error(`Source hash mismatch: ${path}`);
  }
  validatePresentationConfig(d.config);
  if (d.config.holdoutSeeds.length !== 20 || d.config.discoverySeeds.length !== 5) throw Error('The saved 5 selection / 20 holdout seed design is required');
  if (d.config.packing.scenario.types.reduce((n, t) => n + t.quantity, 0) !== 24) throw Error('This tool evaluates the 24-box complete-order model, not the 72-box capacity experiment');
  if (d.config.robotCycleSeconds !== 8 || !d.config.overlapPlanning) throw Error('The 8-second overlapping-planning configuration is required');
  for (const label of ['baseline', 'alps', 'worst'] as const) assertPolicy(d.selection[label], label);
  // Reconstruct only the saved discovery selection; holdout rows never select policies.
  const selection = choosePolicies(d.rows, d.config);
  for (const label of ['baseline', 'alps', 'worst'] as const) if (selection[label]?.id !== d.selection[label]?.id) throw Error(`Saved selection differs from discovery rows: ${label}`);
  return { d, inputSha256: sha(bytes) };
}

function selectedPolicies(d: Dataset, name: Case): Policy[] {
  const selected = name === 'before' ? [d.selection.baseline] : name === 'after' ? [d.selection.alps!] : name === 'extremes' ? [d.selection.worst!, d.selection.alps!] : name === 'hybrid' ? [policy('future-hybrid', false), policy('future-hybrid', true)] : [];
  return [...new Map(selected.map(p => [p.id, structuredClone(p)])).values()];
}

function summarize(rows: OrderRun[], p: Policy) {
  const all = rows.filter(r => r.policy.id === p.id), complete = all.filter(eligible);
  const dist = (fn: (r: OrderRun) => number | null) => distribution(complete.map(fn));
  return {
    policy: p, attempted: all.length, eligibleComplete: complete.length,
    statuses: Object.fromEntries(['complete', 'partial', 'timeout', 'error'].map(s => [s, all.filter(r => r.status === s).length])),
    incompleteOrInvalidSeeds: all.filter(r => !eligible(r)).map(r => r.seed),
    unplacedAllRuns: all.reduce((n, r) => n + r.unplaced.length, 0), violationsAllRuns: all.reduce((n, r) => n + r.violations.length, 0),
    deadlineMissesAllRuns: all.reduce((n, r) => n + r.deadlineMisses, 0), cycleOverrunsAllRuns: all.reduce((n, r) => n + r.cycleOverruns, 0),
    maxDecisionMsAllRuns: distribution(all.map(r => r.maxMs)).max,
    metricPopulation: 'eligible complete runs only; failures remain in rows and the counts above',
    pallets: dist(r => r.batches.length), fill: dist(r => r.utilization), envelopeFill: dist(r => r.envelopeFill),
    totalSeconds: dist(r => r.totalSeconds), packingSeconds: dist(r => r.packingSeconds), robotSeconds: dist(r => r.robotSeconds),
    computeSeconds: dist(r => r.computeSeconds), planningWaitSeconds: dist(r => r.planningWaitSeconds), overlappedComputeSeconds: dist(r => r.overlappedComputeSeconds),
    exchangeSeconds: dist(r => r.exchangeSeconds), redistributionSeconds: dist(r => r.store.redistributionSeconds), shelfSeconds: dist(r => r.store.shelfSeconds),
    walkedMeters: dist(r => r.store.walked), rehandles: dist(r => r.store.rehandles), meanDecisionMs: dist(r => r.meanMs), p95DecisionMs: dist(r => r.p95Ms),
  };
}

const assumptions = [
  'All cases use the saved 24-box complete order, fixed discovery selection and the same 20 holdout arrival seeds; every policy is freshly run in this artifact.',
  'One robot; each successful box movement is assumed to take exactly 8 seconds. Next-box recognition is assumed available with no additional modeled sensor delay.',
  'Planning overlaps the preceding 8-second robot movement once. The initial plan is startup wait; a retry may overlap the same 20-second pallet exchange. computeSeconds retains all measured planner elapsed time.',
  'Store redistribution and stocking times are assumption-based estimates using identical resources and permitted routes for every policy; wrapping and field calibration are excluded.',
];
const limitations = [
  'This 24-box full-order experiment is not the 72-box single-pallet maximum-height capacity benchmark. Fill divides packed volume by all used pallets at the configured maximum height.',
  'Saved ALPS/worst selection ranks modeled total work time, including store work; it is not a claim of maximum loading capacity or universal best/worst algorithm.',
  'Eight-second end-to-end operation is unvalidated. Timed code covers plan plus zone preference, excluding post-plan audits, sensing, communication, controller and physical robot execution.',
  'Eligibility excludes incomplete, invalid and 60-second decision-limit failures; an 8-second overrun is counted and adds modeled wait but does not itself make a run ineligible. The decision limit is checked after a synchronous call returns.',
  'Measured timings depend on this shared host. p95DecisionMs summarizes per-order P95 values and is not a pooled P95 across all decisions. CI describes arrival-order sampling under these assumptions, not field validity.',
  'Source hashes verify the two recorded model files only; the executor source and compiled bundle hashes additionally identify this calculation tool. Other original benchmark dependencies were not fully fingerprinted.',
];

function concise(a: Execution, artifactPath: string, cached: boolean, artifactSha256: string) {
  const mean = (d: ReturnType<typeof distribution>) => d.mean;
  return {
    case: a.case, status: a.status, executedNow: !cached && a.status === 'executed', cached,
    executionMode: cached ? 'cached_execution_artifact' : a.status === 'executed' ? 'fresh_runOrder_execution' : 'not_evaluated',
    cacheNotice: cached ? 'Returning the preserved original execution artifact; no simulation was rerun.' : null,
    artifactPath, artifactSha256, startedAt: a.startedAt, finishedAt: a.finishedAt, wallSeconds: a.wallSeconds,
    modelSchema: a.provenance.modelSchema, inputSha256: a.provenance.inputSha256, sourceHashes: a.provenance.sourceHashes,
    rows: a.rows.map(r => ({ seed: r.seed, policy: r.policy.id, status: r.status, valid: eligible(r), completed: r.store.completed, orderBoxes: r.total, unplaced: r.unplaced.length, violations: r.violations.length, pallets: r.batches.length, fill: r.utilization, total: r.totalSeconds, packing: r.packingSeconds, planningWait: r.planningWaitSeconds, meanMs: r.meanMs, p95Ms: r.p95Ms, maxMs: r.maxMs, cycleOverruns: r.cycleOverruns })),
    stats: a.summary.map(s => ({ policy: s.policy.id, attempted: s.attempted, eligibleComplete: s.eligibleComplete, statuses: s.statuses, incompleteOrInvalidSeeds: s.incompleteOrInvalidSeeds, pallets: mean(s.pallets), fill: mean(s.fill), total: s.totalSeconds, planningWait: mean(s.planningWaitSeconds), compute: mean(s.computeSeconds), meanDecisionMs: mean(s.meanDecisionMs), meanPerOrderP95Ms: mean(s.p95DecisionMs), maxDecisionMs: s.maxDecisionMsAllRuns, cycleOverruns: s.cycleOverrunsAllRuns, deadlineMisses: s.deadlineMissesAllRuns, redistribution: mean(s.redistributionSeconds), shelf: mean(s.shelfSeconds), rehandles: mean(s.rehandles), walkedMeters: mean(s.walkedMeters) })),
    pairedReports: a.pairedReports,
    pairedReportScope: a.policies.length < 2 ? 'A single-policy case has no paired comparison; no saved benchmark rows are substituted for new executions.' : 'Same-artifact complete holdout pairs only; all failed rows remain in the artifact.',
    units: { fill: 'fraction of allowed volume, not percent', total: 'seconds', planningWait: 'seconds', meanMs: 'milliseconds', p95Ms: 'milliseconds', maxMs: 'milliseconds' },
    assumptions: a.assumptions, limitations: a.limitations,
    ...(a.status === 'not_evaluated' ? { metrics: null, hrpal: a.hrpal } : {}),
  };
}

interface CapacityExecution {
  schema: 'alps-claude-capacity-8s/1'; case: 'capacity'; status: 'executed';
  startedAt: string; finishedAt: string; wallSeconds: number;
  provenance: Execution['provenance']; environment: Execution['environment'];
  config: CapacityConfig; selectedAlgorithm: string | null;
  warmup: { seed: number; boxesPerType: number; excludedFromRowsAndStatistics: true; runs: { algorithm: string; status: string; reason: string }[] };
  rows: CapacityTrial[];
  summary: { height: number; mode: 'robot'; discovery: ReturnType<typeof summarizeCapacity>; holdout: ReturnType<typeof summarizeCapacity> };
  pairedReports: { before: string; after: string; expected: number; n: number; fillPercentagePointDifference: ReturnType<typeof distribution>; boxCountDifference: ReturnType<typeof distribution>; pairs: { seed: number; fillPercentagePoints: number; boxes: number }[] }[];
  tracePolicy: string; assumptions: string[]; limitations: string[];
}

function environment(): Execution['environment'] {
  return { os: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model ?? null, logicalCpus: cpus().length, node: process.version, execution: 'serial synchronous calls in one Node process; measured elapsed time, not isolated CPU time' };
}

function conciseCapacity(a: CapacityExecution, path: string, cached: boolean, hash: string) {
  return {
    case: a.case, status: a.status, executedNow: !cached, cached, executionMode: cached ? 'cached_execution_artifact' : 'fresh_runCapacityTrial_execution',
    cacheNotice: cached ? 'Returning the preserved original execution artifact; no simulation was rerun.' : null,
    artifactPath: path, artifactSha256: hash, startedAt: a.startedAt, finishedAt: a.finishedAt, wallSeconds: a.wallSeconds,
    modelSchema: a.provenance.modelSchema, sourceHashes: a.provenance.sourceHashes, selectedAlgorithm: a.selectedAlgorithm,
    rows: a.rows.map(r => ({ split: r.split, seed: r.seed, algorithm: r.algorithm, status: r.status, valid: r.status === 'finished' && !r.violations.length, pallets: 1, placed: r.placements.length, orderBoxes: r.total, unplaced: r.unplaced.length, unprocessed: r.unprocessed.length, fill: r.utilization, usedHeightMm: r.usedHeight, computeMs: r.computeMs, meanMs: r.meanMs, p95Ms: r.p95Ms, maxMs: r.maxMs, deadlineMisses: r.deadlineMisses, decisions: r.decisions, violations: r.violations.length, robotAuditViolations: r.robotAudit.length, fixed8SecondsForPlacedBoxes: r.placements.length * 8, pathEstimateSeconds: r.robotSeconds, extraFitTypes: r.extraFit })),
    stats: a.summary, pairedReports: a.pairedReports,
    units: { fill: 'fraction of one pallet volume at the configured maximum height', meanMs: 'milliseconds per planning call', fixed8SecondsForPlacedBoxes: 'assumed robot motion only; excludes rejected boxes, buffer handling and planning waits' },
    assumptions: a.assumptions, limitations: a.limitations,
  };
}

function executeCapacity(provenance: Execution['provenance']) {
  provenance = { ...provenance, modelSchema: CAPACITY_VERSION };
  const relativeArtifact = 'docs/presentation/claude/executed-capacity.json', artifactPath = resolve(root, relativeArtifact);
  const returnCache = () => {
    const bytes = readFileSync(artifactPath), a = JSON.parse(bytes.toString('utf8')) as CapacityExecution;
    if (a.schema !== 'alps-claude-capacity-8s/1' || a.case !== 'capacity' || a.status !== 'executed' || JSON.stringify(a.provenance) !== JSON.stringify(provenance) || a.rows.length !== 40) throw Error(`Existing capacity artifact is invalid or has different provenance; preserved: ${relativeArtifact}`);
    emit(conciseCapacity(a, relativeArtifact, true, sha(bytes)));
  };
  if (existsSync(artifactPath)) { returnCache(); return; }
  const config = defaultCapacityConfig();
  config.heights = [1200]; config.decisionMs = 8000; config.trialMs = 120000; config.bufferCapacity = 2;
  config.discoverySeeds = [410, 411, 412]; config.holdoutSeeds = [2410, 2411, 2412, 2413, 2414]; config.algorithms = [...ALGORITHMS];
  validateConfig(config);
  const startedAt = new Date().toISOString(), began = performance.now(), rows: CapacityTrial[] = [];
  const a: CapacityExecution = {
    schema: 'alps-claude-capacity-8s/1', case: 'capacity', status: 'executed', startedAt, finishedAt: '', wallSeconds: 0, provenance, environment: environment(), config, selectedAlgorithm: null,
    warmup: { seed: 9101, boxesPerType: 1, excludedFromRowsAndStatistics: true, runs: [] }, rows,
    summary: { height: 1200, mode: 'robot', discovery: [], holdout: [] }, pairedReports: [],
    tracePolicy: 'Full trace retained for every algorithm at first discovery seed 410 and first holdout seed 2410 only; all 40 final placements, arrivals, status and measured timing aggregates retained.',
    assumptions: [
      'Separate 72-box single-pallet internal capacity experiment: 1200×1000×1200 mm, observed-box buffer capacity 2, common gripper constraints, robot mode only, all five algorithms on all eight seeds.',
      'Each planner invocation has an 8000 ms decision allowance and each trial has a 120000 ms elapsed-time allowance; late placements are rejected and unfinished trials are excluded from eligibility.',
      'The selected algorithm is frozen using only discovery seeds 410–412 and allowed-volume fill, followed by packed count and measured speed as implemented by selectedAlgorithm/summarizeCapacity. Seeds 2410–2414 evaluate all candidates.',
      'For display only, placed boxes × 8 seconds is an assumed robot-motion amount. Original robotSeconds remains a path-model estimate and is not silently replaced.',
    ],
    limitations: [
      'This is newly executed 8-second-per-planning-call data, not a rewrite of the older 250 ms capacity experiment and not the 24-box full-order/store-time model.',
      'A finished capacity trial may leave goods unplaced because one pallet is full. Unplaced and unprocessed goods are retained; a short timeout prefix is not a successful capacity result.',
      'Buffer draining can make multiple planner calls after one placement. All calls below 8 seconds do not establish that the full next-box decision/sensing/validation pipeline fits in one 8-second robot movement.',
      'Timer excludes common post-plan auditing, final feasibility probes, sensing, communication and real robot control. Decision/trial limits are checked after synchronous calls return; they are not preemptive cancellation.',
      'No planning-wait or store total-time value is inferred for this capacity case. Handling or staging of rejected/buffered boxes and sensor recognition require a separate scheduling model.',
      'The three selection and five holdout seeds are a small internal experiment with one six-SKU synthetic-strength assortment. It is not a global-optimality proof, field validation or a broad generalization.',
      'Holdout rankings are descriptive only: they do not reselect the discovery-frozen algorithm. Invalid/unfinished candidates remain visible and are ineligible; confidence intervals are conditional on this setup.',
      'Trial mean/P95/max cover all timed planner attempts, while a retained trace logs placements/buffering/rejections and does not expose every unsuccessful retry duration. Extra-fit probes are sampled feasibility checks, not optimality certificates.',
    ],
  };
  const warm = structuredClone(config); warm.scenario.types.forEach(t => { t.quantity = 1; });
  for (const algorithm of config.algorithms) {
    const r = runCapacityTrial(warm, { algorithm, mode: 'robot', height: 1200, seed: 9101, split: 'discovery' });
    a.warmup.runs.push({ algorithm, status: r.status, reason: r.reason });
  }
  for (const split of ['discovery', 'holdout'] as const) {
    const seeds = split === 'discovery' ? config.discoverySeeds : config.holdoutSeeds;
    for (const [i, seed] of seeds.entries()) {
      const order = [...config.algorithms.slice(i % config.algorithms.length), ...config.algorithms.slice(0, i % config.algorithms.length)];
      for (const algorithm of order) {
        const r = runCapacityTrial(structuredClone(config), { algorithm, mode: 'robot', height: 1200, seed, split });
        if (seed !== seeds[0]) r.trace = [];
        rows.push(r);
      }
    }
    if (split === 'discovery') a.selectedAlgorithm = selectedAlgorithm(rows, config, 1200);
  }
  a.summary.discovery = summarizeCapacity(rows, config, 1200, 'robot', 'discovery');
  a.summary.holdout = summarizeCapacity(rows, config, 1200, 'robot', 'holdout');
  if (a.selectedAlgorithm) for (const before of config.algorithms.filter(id => id !== a.selectedAlgorithm)) {
    const pairs = config.holdoutSeeds.flatMap(seed => {
      const b = rows.find(r => r.split === 'holdout' && r.seed === seed && r.algorithm === before)!;
      const after = rows.find(r => r.split === 'holdout' && r.seed === seed && r.algorithm === a.selectedAlgorithm)!;
      if (b.status !== 'finished' || after.status !== 'finished' || b.violations.length || after.violations.length || b.fingerprint !== after.fingerprint || b.arrivals.join('|') !== after.arrivals.join('|')) return [];
      return [{ seed, fillPercentagePoints: 100 * (after.utilization - b.utilization), boxes: after.placements.length - b.placements.length }];
    });
    a.pairedReports.push({ before, after: a.selectedAlgorithm, expected: config.holdoutSeeds.length, n: pairs.length, fillPercentagePointDifference: distribution(pairs.map(p => p.fillPercentagePoints)), boxCountDifference: distribution(pairs.map(p => p.boxes)), pairs });
  }
  if (sha(read(INPUT_PATH)) !== provenance.inputSha256 || MODEL_SOURCES.some(path => sha(read(path)) !== provenance.sourceHashes[path]) || sha(read(SCRIPT_PATH)) !== provenance.scriptSha256) throw Error('Input or source changed during execution; no capacity artifact was written');
  a.finishedAt = new Date().toISOString(); a.wallSeconds = (performance.now() - began) / 1000;
  const contents = `${JSON.stringify(a, null, 2)}\n`; mkdirSync(dirname(artifactPath), { recursive: true });
  try { writeFileSync(artifactPath, contents, { flag: 'wx' }); }
  catch (error) { if ((error as { code?: string }).code === 'EEXIST') { returnCache(); return; } throw error; }
  emit(conciseCapacity(a, relativeArtifact, false, sha(contents)));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !CASES.includes(args[0] as Case)) throw Error(`Exactly one case is required: ${CASES.join('|')}`);
  // Only the documented compiled location is supported; no cwd or caller path is trusted.
  if (resolve(root, 'node_modules/.cache/claude-simulation.mjs') !== bundledPath) throw Error('Run the compiled node_modules/.cache/claude-simulation.mjs entry point');
  const name = args[0] as Case, { d, inputSha256 } = loadDataset(), policies = selectedPolicies(d, name);
  const provenance = { inputPath: INPUT_PATH, inputSha256, modelSchema: d.schema, sourceHashes: d.sourceHashes, sourceCommit: d.sourceCommit, scriptSha256: sha(read(SCRIPT_PATH)), bundleSha256: sha(readFileSync(bundledPath)), inputCreatedAt: d.createdAt, inputExtendedAt: d.extendedAt ?? null };
  if (name === 'capacity') { executeCapacity(provenance); return; }
  const relativeArtifact = `docs/presentation/claude/executed-${name}.json`, artifactPath = resolve(root, relativeArtifact);
  const returnCache = () => {
    const bytes = readFileSync(artifactPath), a = JSON.parse(bytes.toString('utf8')) as Execution;
    if (a.schema !== EXECUTION_SCHEMA || a.case !== name || JSON.stringify(a.provenance) !== JSON.stringify(provenance) || a.policies.map(p => p.id).join('|') !== policies.map(p => p.id).join('|')) throw Error(`An existing artifact has different provenance; it was preserved: ${relativeArtifact}`);
    if (!Array.isArray(a.rows) || !Array.isArray(a.summary) || !Array.isArray(a.pairedReports) || (name === 'hrpal' ? a.status !== 'not_evaluated' || a.metrics !== null : a.status !== 'executed' || a.rows.length !== 20 * policies.length)) throw Error(`An existing artifact is incomplete or invalid; it was preserved: ${relativeArtifact}`);
    emit(concise(a, relativeArtifact, true, sha(bytes)));
  };
  if (existsSync(artifactPath)) { returnCache(); return; }

  const startedAt = new Date().toISOString(), began = performance.now();
  const a: Execution = {
    schema: EXECUTION_SCHEMA, case: name, status: name === 'hrpal' ? 'not_evaluated' : 'executed', startedAt, finishedAt: '', wallSeconds: 0, provenance,
    environment: environment(),
    config: structuredClone(d.config), selection: structuredClone(d.selection), policies, warmup: null, rows: [], summary: [], pairedReports: [], assumptions: [...assumptions], limitations: [...limitations],
  };
  if (name === 'hrpal') {
    a.metrics = null; a.assumptions = []; a.limitations.push('No HRPal algorithm was executed, reverse-engineered or replaced with a heuristic. Numerical HRPal performance comparison is unavailable.');
    a.hrpal = { product: 'HD Hyundai Robotics HRPal', version: 'v2.2.1 as listed on the official product page at research time', supportedOs: 'MS Windows', executed: false, substituteAlgorithmUsed: false, evidenceAsOf: '2026-10-10 KST',
      accessStatus: ['Official legacy ZIP and Hi6 PDF downloads returned HTTP 402 (Firebase storage unavailable) during the recorded research, not a valid software/PDF download.', 'The current official homepage download requires member login. No login bypass or unofficial binary was used.', 'The research environment is macOS. A supported Windows installation or genuine original JOB/POSE/project output is still required.', 'No public HRPal packing implementation, online mixed-SKU planning API or comparable benchmark was found in the examined official sources. This is not proof that private capabilities do not exist.'],
      officialUrls: ['https://www.hd-hyundairobotics.com/biz/product/support/287', 'https://down-hd.web.app/en/docs/software/HRpal/', 'https://manual2-hd.web.app/docs/en/hi5a/fn/Hi5aPA230424FMEN4/3/5/3-5-1/'], researchPath: 'docs/presentation/HRPAL-RESEARCH.md' };
  } else {
    const warm = structuredClone(d.config); warm.packing.scenario.types.forEach(t => { t.quantity = 1; });
    a.warmup = { seed: 9100, boxesPerType: 1, excludedFromRowsAndStatistics: true, runs: [] };
    for (const algorithm of [...new Set(policies.map(p => p.algorithm))]) {
      const r = runOrder(warm, policy(algorithm, false), 9100, 'discovery');
      a.warmup.runs.push({ policy: r.policy.id, status: r.status, reason: r.reason });
    }
    // Alternate the order in two-policy cases to reduce systematic within-process order effects.
    for (const [i, seed] of d.config.holdoutSeeds.entries()) for (const p of i % 2 ? [...policies].reverse() : policies) a.rows.push(runOrder(structuredClone(d.config), structuredClone(p), seed, 'holdout'));
    a.summary = policies.map(p => summarize(a.rows, p));
    for (let i = 0; i < policies.length; i++) for (let j = i + 1; j < policies.length; j++) a.pairedReports.push({ before: policies[i].id, after: policies[j].id, report: pairedReport(a.rows, policies[i], policies[j], d.config.holdoutSeeds) });
  }
  // Detect an input/model change during a long calculation before assigning its provenance.
  if (sha(read(INPUT_PATH)) !== inputSha256 || MODEL_SOURCES.some(path => sha(read(path)) !== provenance.sourceHashes[path]) || sha(read(SCRIPT_PATH)) !== provenance.scriptSha256) throw Error('Input or source changed during execution; no result artifact was written');
  a.finishedAt = new Date().toISOString(); a.wallSeconds = (performance.now() - began) / 1000;
  const contents = `${JSON.stringify(a, null, 2)}\n`;
  mkdirSync(dirname(artifactPath), { recursive: true });
  try { writeFileSync(artifactPath, contents, { flag: 'wx' }); }
  catch (error) { if ((error as { code?: string }).code === 'EEXIST') { returnCache(); return; } throw error; }
  emit(concise(a, relativeArtifact, false, sha(contents)));
}

try { main(); } catch (error) { emit({ status: 'error', executedNow: false, error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; }
