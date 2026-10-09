import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { PRESENTATION_VERSION, choosePolicies, defaultPresentationConfig, eligible, pairedReport, planStore, policy, runOrder } from '../src/pallet/presentation/model';
import type { OrderRun } from '../src/pallet/presentation/model';
import { ALGORITHMS } from '../src/pallet/capacity/experiment';

const config = defaultPresentationConfig(), rows: OrderRun[] = [];
if (process.argv.includes('--quick')) { config.discoverySeeds = [310]; config.holdoutSeeds = [2210]; }
const warm = structuredClone(config); warm.packing.scenario.types.forEach(t => t.quantity = 1);
for (const algorithm of config.packing.algorithms) runOrder(warm, policy(algorithm, false), 9100, 'discovery');
const log = (r: OrderRun) => { rows.push(r); process.stdout.write(`${r.split} ${r.seed} ${r.policy.id}: ${r.status} ${r.store.completed}/${r.total} pallets=${r.batches.length} total=${r.totalSeconds.toFixed(1)} store=${r.store.seconds.toFixed(1)} ${r.store.method} mean=${r.meanMs?.toFixed(1)}ms ${r.reason}\n`); };
for (const seed of config.discoverySeeds) for (const algorithm of config.packing.algorithms) for (const organized of [false, true]) log(runOrder(config, policy(algorithm, organized), seed, 'discovery'));
const selection = choosePolicies(rows, config);
if (!selection.alps || !selection.worst) throw Error('No fully complete eligible ALPS candidate');
const sameBase = policy(config.baselineAlgorithm, true);
const policies = [...new Map([selection.baseline, selection.alps, selection.worst, sameBase, policy('future-hybrid', false), policy('future-hybrid', true)].map(p => [p.id, p])).values()];
for (const seed of config.holdoutSeeds) for (const p of policies) log(runOrder(config, p, seed, 'holdout'));
const report = pairedReport(rows, selection.baseline, selection.alps, config.holdoutSeeds);
const sameBaseReport = pairedReport(rows, selection.baseline, sameBase, config.holdoutSeeds);
const sensitivity = [3, 6, 12].map(cartBoxes => {
  const adjusted = rows.filter(r => r.split === 'holdout').map(r => {
    const store = planStore(r.batches, config.packing.groups, { ...config.store, cartBoxes });
    return { ...r, store, totalSeconds: r.packingSeconds + store.seconds };
  });
  return { cartBoxes, report: pairedReport(adjusted, selection.baseline, selection.alps!, config.holdoutSeeds) };
});
const hybridReports = [false,true].map(organized => ({ policy: policy('future-hybrid',organized), vsBaseline: pairedReport(rows,selection.baseline,policy('future-hybrid',organized),config.holdoutSeeds), vsSelected: pairedReport(rows,selection.alps!,policy('future-hybrid',organized),config.holdoutSeeds) }));
const replaySeed = config.holdoutSeeds[0];
const summaryRows = rows.map(({ packingEvents, store, scenario, ...r }) => ({ ...r, store: { ...store, events: [] }, valid: eligible({ ...r, packingEvents, store, scenario }) }));
const metadata = { schema: PRESENTATION_VERSION, createdAt: new Date().toISOString(), config, selection, report, sameBaseReport, sensitivity, hybridReports, replaySeed, algorithms: ALGORITHMS,
  sourceCommit: 'b582caa52e2245f40f2c9fba0f770887c3a9e8c2', sourceHashes: Object.fromEntries(['src/pallet/presentation/model.ts','src/pallet/capacity/experiment.ts'].map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])),
  environment: `${platform()} ${arch()} / ${cpus()[0]?.model} / Node ${process.version}`, warmup: 'one independent six-box input per algorithm, excluded', rows: summaryRows };
mkdirSync('docs/presentation', { recursive: true });
const suffix = process.argv.includes('--quick') ? '-quick' : '';
writeFileSync(`docs/presentation/results${suffix}.json`, JSON.stringify(metadata, null, 2));
writeFileSync(`public/presentation-example${suffix}.json`, JSON.stringify({ ...metadata, replays: rows.filter(r => r.split === 'holdout' && r.seed === replaySeed) }));
writeFileSync(`docs/presentation/results${suffix}.csv`, ['split,seed,policy,status,completed,total,pallets,utilization,total_seconds,robot_seconds,compute_seconds,planning_wait_seconds,overlapped_compute_seconds,cycle_overruns,exchange_seconds,redistribution_seconds,shelf_seconds,method,walk_m,rehandles,mean_ms,p95_ms,deadline_misses,violations', ...rows.map(r => [r.split,r.seed,r.policy.id,r.status,r.store.completed,r.total,r.batches.length,r.utilization,r.totalSeconds,r.robotSeconds,r.computeSeconds,r.planningWaitSeconds,r.overlappedComputeSeconds,r.cycleOverruns,r.exchangeSeconds,r.store.redistributionSeconds,r.store.shelfSeconds,r.store.method,r.store.walked,r.store.rehandles,r.meanMs,r.p95Ms,r.deadlineMisses,r.violations.length].join(','))].join('\n'));
process.stdout.write(JSON.stringify({ selection: { baseline: selection.baseline, alps: selection.alps, worst: selection.worst }, report, sameBaseReport, sensitivity }, null, 2));
