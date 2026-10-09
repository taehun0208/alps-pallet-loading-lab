import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { eligible, pairedReport, policy, runOrder, type OrderRun } from '../src/pallet/presentation/model';
const data = JSON.parse(readFileSync('public/presentation-example.json', 'utf8'));
if (data.schema !== 'alps-complete-order/2') throw Error('Pipeline v2 required');
for (const [path, sha] of Object.entries(data.sourceHashes)) if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha) throw Error(`Source changed: ${path}`);
const rows: OrderRun[] = data.rows, replays: OrderRun[] = data.replays;
const warm = structuredClone(data.config); warm.packing.scenario.types.forEach((t: { quantity: number }) => t.quantity = 1); runOrder(warm, policy('future-hybrid', false), 9100, 'discovery');
for (const seed of data.config.holdoutSeeds) for (const organized of [false,true]) {
  const p = policy('future-hybrid', organized);
  if (rows.some(r => r.split === 'holdout' && r.seed === seed && r.policy.id === p.id)) continue;
  const r = runOrder(data.config, p, seed, 'holdout'); rows.push(r); if (seed === data.replaySeed) replays.push(r);
  process.stdout.write(`${seed} ${p.id} ${r.status} max=${r.maxMs?.toFixed(1)}ms total=${r.totalSeconds.toFixed(1)}s\n`);
}
data.hybridReports = [false,true].map(organized => ({ policy: policy('future-hybrid',organized), vsBaseline: pairedReport(rows, data.selection.baseline, policy('future-hybrid',organized),data.config.holdoutSeeds), vsSelected: pairedReport(rows,data.selection.alps,policy('future-hybrid',organized),data.config.holdoutSeeds) }));
data.extendedAt = new Date().toISOString();
data.rows = rows.map(({ packingEvents, store, scenario, ...r }) => ({ ...r, store: { ...store, events: [] }, valid: eligible({ ...r, packingEvents, store, scenario }) }));
writeFileSync('public/presentation-example.json', JSON.stringify(data));
const { replays: omitted, ...metadata } = data;
writeFileSync('docs/presentation/results.json', JSON.stringify(metadata,null,2));
writeFileSync('docs/presentation/results.csv', ['split,seed,policy,status,completed,total,pallets,utilization,total_seconds,robot_seconds,compute_seconds,planning_wait_seconds,overlapped_compute_seconds,cycle_overruns,exchange_seconds,redistribution_seconds,shelf_seconds,method,walk_m,rehandles,mean_ms,p95_ms,deadline_misses,violations', ...rows.map(r => [r.split,r.seed,r.policy.id,r.status,r.store.completed,r.total,r.batches.length,r.utilization,r.totalSeconds,r.robotSeconds,r.computeSeconds,r.planningWaitSeconds,r.overlappedComputeSeconds,r.cycleOverruns,r.exchangeSeconds,r.store.redistributionSeconds,r.store.shelfSeconds,r.store.method,r.store.walked,r.store.rehandles,r.meanMs,r.p95Ms,r.deadlineMisses,r.violations.length].join(','))].join('\n'));
process.stdout.write(JSON.stringify(data.hybridReports,null,2));
