import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { platform, arch, cpus } from 'node:os';
import { ALGORITHMS, CAPACITY_VERSION, defaultCapacityConfig, runCapacityTrial, selectedAlgorithm, summarizeCapacity, trialSpecs } from '../src/pallet/capacity/experiment';
import type { CapacityTrial } from '../src/pallet/capacity/experiment';

const config = defaultCapacityConfig();
config.heights = [800, 1200, 1600];
if (process.argv.includes('--quick')) { config.heights = [1200]; config.discoverySeeds = [42]; config.holdoutSeeds = [1042]; }
const rows: CapacityTrial[] = [];
// Warm each adapter in this Node process using a small independent input; exclude from records.
const warm = structuredClone(config); warm.scenario.types.forEach(t => t.quantity = 1);
for (const algorithm of config.algorithms) runCapacityTrial(warm, { algorithm, mode: 'robot', height: 1200, seed: 9001, split: 'discovery' });
const specs = trialSpecs(config);
for (const spec of specs) {
  const r = runCapacityTrial(config, spec); rows.push(r);
  process.stdout.write(`${rows.length}/${specs.length} ${spec.height} ${spec.seed} ${spec.algorithm} ${spec.mode}: ${r.placements.length}/${r.total} ${(r.utilization * 100).toFixed(1)}% mean=${r.meanMs?.toFixed(1)}ms p95=${r.p95Ms?.toFixed(1)}ms ${r.status}\n`);
}
const summary = config.heights.map(height => ({ height, selected: selectedAlgorithm(rows, config, height), discovery: summarizeCapacity(rows, config, height, 'robot', 'discovery'), holdout: summarizeCapacity(rows, config, height, 'robot', 'holdout') }));
const replayHeight = 1200, replaySeed = config.holdoutSeeds[0], chosen = selectedAlgorithm(rows, config, replayHeight);
const metadata = { schema: CAPACITY_VERSION, createdAt: new Date().toISOString(), sourceCommit: 'b582caa52e2245f40f2c9fba0f770887c3a9e8c2', config, summary, replayHeight, replaySeed,
  experimentSourceSha256: createHash('sha256').update(readFileSync('src/pallet/capacity/experiment.ts')).digest('hex'),
  environment: `${platform()} ${arch()} / ${cpus()[0]?.model} / Node ${process.version}`, warmup: 'one independent 6-box trial per algorithm, excluded', algorithms: ALGORITHMS };
mkdirSync('docs/capacity', { recursive: true }); mkdirSync('public', { recursive: true });
// Every trial retains final placements and raw timing; only the selected replay trio retains
// full intermediate scenes. Re-running this script recomputes every trace without sampling inputs.
const compact = rows.map(r => ({ ...r, trace: r.height === replayHeight && r.seed === replaySeed && r.algorithm === chosen ? r.trace : [] }));
writeFileSync('public/capacity-example.json', JSON.stringify({ ...metadata, rows: compact }));
writeFileSync('docs/capacity/results.json', JSON.stringify({ ...metadata, rows: compact.map(({ trace, scenario, ...r }) => r) }, null, 2));
writeFileSync('docs/capacity/results.csv', ['height,seed,split,algorithm,mode,status,placed,total,volume_m3,utilization,mean_ms,p95_ms,max_ms,deadline_misses,robot_seconds,robot_rejected,extra_fit,blockers', ...rows.map(r => [r.height, r.seed, r.split, r.algorithm, r.mode, r.status, r.placements.length, r.total, r.volume / 1e9, r.utilization, r.meanMs, r.p95Ms, r.maxMs, r.deadlineMisses, r.robotSeconds, r.robotAudit.length, r.extraFit, r.crossZoneBlockers].join(','))].join('\n'));
process.stdout.write(JSON.stringify(summary.map(r => ({ height: r.height, selected: r.selected, holdout: r.holdout.find(h => h.algorithm === r.selected) })), null, 2) + '\n');
