import { ArrivalEnvironment } from '../environment';
import { inspectConstraints } from '../constraints';
import { candidateSet } from '../candidates';
import { compactScore } from '../compactPacking';
import { getAlgorithm } from '../benchmark/registry';
import { auditProposal, violationType } from '../benchmark/runner';
import { distribution, fingerprint } from '../benchmark/statistics';
import { strategyDemo } from '../strategies/demo';
import { DEFAULT_STRATEGY } from '../strategies/PackingStrategy';
import { ONLINE_SEARCH } from '../types';
import { intersects, top, volume } from '../geometry';
import type { AlgorithmEntry } from '../benchmark/model';
import type { Analysis, BoxType, Candidate, Observation, Placement, PlanningInput, Scenario, SearchSettings } from '../types';

export const CAPACITY_VERSION = 'single-arm-capacity/1';
export const MODES = { space: '로봇 제약 미적용', robot: '로봇 제약 적용', organized: '로봇 + 매장 구역 고려' } as const;
export type Mode = keyof typeof MODES;
export const ALGORITHMS = { blb: 'Bottom-Left-Back', 'capacity-compact': '공간 채움 · Compact', 'strategy-greedy': 'Greedy', lookahead: 'Lookahead', 'future-hybrid': 'Future-Aware Hybrid' };
export const ZONES = ['식품 · 1층', '생활용품 · 3층', '뷰티 · 1층'];
export const COLORS = ['#bf8c43', '#479b92', '#7f8ab9'];
const rejectionType = (reason: string) => /작업공간/.test(reason) ? 'robot-path' : violationType(reason);
export interface CapacityConfig {
  scenario: Scenario; groups: Record<string, number>; settings: SearchSettings;
  algorithms: string[]; heights: number[]; discoverySeeds: number[]; holdoutSeeds: number[];
  bufferCapacity: number; decisionMs: number; trialMs: number; groupStrength: number; groupHeightSlack: number;
}
export interface TrialSpec { algorithm: string; mode: Mode; height: number; seed: number; split: 'discovery' | 'holdout' }
export interface CapacityStep {
  arrival: number; box: Observation; action: 'place' | 'buffer' | 'reject'; reason: string;
  candidate?: Candidate; before: Placement[]; after: Placement[]; buffered: string[]; ms: number;
}
export interface CapacityTrial extends TrialSpec {
  id: string; fingerprint: string; status: 'finished' | 'timeout' | 'error'; reason: string;
  scenario: Scenario; arrivals: string[]; trace: CapacityStep[]; placements: Placement[];
  total: number; processed: number; unplaced: string[]; unprocessed: string[];
  volume: number; utilization: number; envelopeFill: number; usedHeight: number; supplyBound: number;
  robotSeconds: number | null; computeMs: number; meanMs: number | null; p95Ms: number | null; maxMs: number | null; deadlineMisses: number; decisions: number; checked: number;
  rejections: Record<string, number>; violations: string[]; robotAudit: { box: string; reasons: string[] }[];
  crossZoneBlockers: number; extraFit: number; probeChecked: number; bufferPeak: number;
}

// Product dimensions/weights/assumed strengths transcribed from the team's 2026-10-10
// alps-control-room/engine/core.js. mm here, metres in that model. No measured-strength claim.
export function retailScenario(quantity = 12): Scenario {
  const s = strategyDemo();
  s.id = 'team-retail-capacity'; s.name = '팀 논의 · 대형마트 6품목';
  s.pallet = { width: 1200, depth: 1000, maxHeight: 1200, robotLayout: { count: 1, architecture: 'floor', floorCount: 1 } };
  const specs: [string, number, number, number, number, number][] = [
    ['생수', 400, 300, 280, 12, 85], ['과자', 500, 340, 250, 3, 24],
    ['세제', 320, 240, 320, 8, 55], ['생활용품', 400, 300, 220, 4, 40],
    ['헤어케어', 300, 250, 240, 6, 45], ['스킨케어', 250, 200, 200, 4, 30],
  ];
  s.types = specs.map(([name, w, d, h, weight, maxLoadKg], i): BoxType => ({
    id: `S${i + 1}`, name, size: { w, d, h }, weight, maxLoadKg, maxLoadSource: 'synthetic',
    quantity, color: COLORS[Math.floor(i / 2)], orientations: [0, 90], handling: 'upright', material: 'paper', friction: .45,
  }));
  s.constraints.robotMode = 'gripper'; s.constraints.heavyRule = 'off'; s.constraints.supportRatio = .85;
  s.constraints.standingHeight = { enabled: false, maxRiseMm: 100 };
  s.constraints.stability = { ...s.constraints.stability!, lateralAccelerationG: 0, minMarginRatio: .05, loadSafetyFactor: 1.2, slendernessMode: 'score' };
  s.constraints.gripper = { width: 180, depth: 160, height: 160, mass: 8, payload: 38, margin: 5, lift: 180, speed: 650, pickSeconds: .7, placeSeconds: .45, rotationSpeed: 90 };
  s.constraints.reach = { baseX: -700, baseY: 500, minRadius: 0, maxRadius: 2700 };
  s.constraints.workspace = { xMin: -1400, xMax: 1800, yMin: -600, yMax: 1600, zMax: 2600 };
  s.events = []; return s;
}
export function defaultCapacityConfig(): CapacityConfig {
  return { scenario: retailScenario(), groups: { S1: 0, S2: 0, S3: 1, S4: 1, S5: 2, S6: 2 },
    settings: { ...structuredClone(ONLINE_SEARCH), maxCandidates: 48, topK: 4, samples: 2, depth: 2, reserveProbes: 4, virtualCandidates: 8,
      strategy: { ...structuredClone(DEFAULT_STRATEGY), futureCandidates: 4, lookaheadDepth: 2, lookaheadSamples: 2, lookaheadCandidates: 3 } },
    algorithms: Object.keys(ALGORITHMS), heights: [1200], discoverySeeds: [42, 43], holdoutSeeds: [1042, 1043],
    bufferCapacity: 2, decisionMs: 250, trialMs: 60000, groupStrength: 1, groupHeightSlack: 100 };
}
export function validateConfig(c: CapacityConfig) {
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (!c.heights.length || c.heights.some(h => !positive(h) || h > 2400) || new Set(c.heights).size !== c.heights.length) throw Error('높이는 중복 없이 1~2400 mm로 입력하세요.');
  if (!positive(c.scenario.pallet.width) || !positive(c.scenario.pallet.depth) || !positive(c.trialMs) || !positive(c.decisionMs)) throw Error('팔레트 규격과 시간 예산을 확인하세요.');
  if (!Number.isInteger(c.bufferCapacity) || c.bufferCapacity < 0 || c.bufferCapacity > 8) throw Error('버퍼는 0~8개입니다.');
  for (const seeds of [c.discoverySeeds, c.holdoutSeeds]) if (!seeds.length || seeds.some(n => !Number.isInteger(n)) || new Set(seeds).size !== seeds.length) throw Error('각 단계에는 중복 없는 정수 시드가 필요합니다.');
  if (c.discoverySeeds.some(s => c.holdoutSeeds.includes(s))) throw Error('선택용과 검증용 시드를 분리하세요.');
  if (!c.algorithms.length || new Set(c.algorithms).size !== c.algorithms.length || c.algorithms.some(id => !(id in ALGORITHMS))) throw Error('비교 알고리즘을 선택하세요.');
  if (!Number.isFinite(c.groupStrength) || c.groupStrength < 0 || !Number.isFinite(c.groupHeightSlack) || c.groupHeightSlack < 0) throw Error('구역 선호 설정을 확인하세요.');
  if (!Number.isInteger(c.settings.maxCandidates) || c.settings.maxCandidates < 1 || c.settings.maxCandidates > 512) throw Error('후보 수는 1~512개의 정수입니다.');
  const robot = c.scenario.constraints;
  if (!positive(robot.workspace.zMax) || !positive(robot.gripper.width) || !positive(robot.gripper.speed) || !positive(robot.gripper.payload) || !positive(robot.reach?.maxRadius ?? 0)) throw Error('로봇 규격은 유한한 양수여야 합니다.');
  for (const t of c.scenario.types) if (!Number.isInteger(t.quantity) || t.quantity < 1 || !Object.values(t.size).every(positive) || !positive(t.weight) || t.packaging || ![0, 1, 2].includes(c.groups[t.id])) throw Error('품목 규격·수량·매장 구역을 확인하세요. 이 비교는 일반 상자 입력을 사용합니다.');
  if (c.scenario.types.reduce((n, t) => n + t.quantity, 0) > 240) throw Error('한 실행의 입고는 최대 240개입니다.');
}
export function trialSpecs(c: CapacityConfig): TrialSpec[] {
  validateConfig(c);
  return (['discovery', 'holdout'] as const).flatMap(split => (split === 'discovery' ? c.discoverySeeds : c.holdoutSeeds).flatMap(seed =>
    c.heights.flatMap(height => c.algorithms.flatMap(algorithm => (Object.keys(MODES) as Mode[]).map(mode => ({ split, seed, height, algorithm, mode }))))));
}
function definition(id: string): AlgorithmEntry {
  if (id !== 'capacity-compact') return getAlgorithm(id);
  return { id, name: ALGORITHMS[id], scope: 'online', family: '기존 Compact 점수', version: CAPACITY_VERSION, description: '현재 입고 박스의 낮은 면·접촉·묻히는 틈 평가', plan(input) {
    // This local-only Compact variant deliberately omits residual-stock forecasts.
    // It keeps the shared hard checks and geometric Compact score within a smaller compute cost.
    const start = performance.now(), local = { ...input, settings: { ...input.settings, inventoryMode: 'none' as const } }, r = candidateSet(local);
    const valid = r.candidates.filter(c => c.valid);
    for (const c of valid) compactScore(c, local);
    valid.sort((a, b) => a.placement.position.z - b.placement.position.z || b.score - a.score || a.id.localeCompare(b.id));
    return { ...r, runId: input.runId, stepId: input.stepId, selectedId: valid[0]?.id ?? null, valid: valid.length,
      rejections: {}, nodes: r.candidates.length, rolloutCalls: 0, milliseconds: performance.now() - start, virtualSequences: [], explanation: ['낮은 면 → 기존 Compact 점수'] };
  } };
}
const overlapsXY = (a: Placement, b: Placement) => a.position.x < b.position.x + b.size.w - 1e-6 && b.position.x < a.position.x + a.size.w - 1e-6 && a.position.y < b.position.y + b.size.d - 1e-6 && b.position.y < a.position.y + a.size.d - 1e-6;
export function crossZoneBlockers(stack: Placement[], groups: CapacityConfig['groups']) {
  // Unique boxes obstructing at least one different department below them; a geometric proxy, not time.
  return stack.filter(upper => stack.some(lower => groups[upper.typeId] !== groups[lower.typeId] && upper.position.z >= top(lower) - .5 && overlapsXY(upper, lower))).length;
}
function organize(a: Analysis, input: PlanningInput, config: CapacityConfig) {
  const base = a.candidates.find(c => c.id === a.selectedId && c.valid);
  if (!base || !config.groupStrength) return;
  const height = Math.max(0, ...input.placements.map(top), top(base.placement));
  const choices = a.candidates.filter(c => c.valid && Math.max(top(c.placement), ...input.placements.map(top), 0) <= height + config.groupHeightSlack);
  // Preserve algorithm preference with ordinal rank rather than mixing incompatible score scales.
  choices.sort((x, y) => x.id === base.id ? -1 : y.id === base.id ? 1 : y.score - x.score);
  const cost = (c: Candidate, rank: number) => {
    const b = c.placement, zone = config.groups[b.typeId], target = input.pallet.width * (zone + .5) / 3;
    const blockers = input.placements.filter(p => config.groups[p.typeId] !== zone && overlapsXY(b, p)).length;
    return rank / Math.max(1, choices.length) + config.groupStrength * (Math.abs(b.position.x + b.size.w / 2 - target) / input.pallet.width + blockers * .3);
  };
  a.selectedId = choices.map((c, rank) => ({ c, cost: cost(c, rank) })).sort((x, y) => x.cost - y.cost || x.c.id.localeCompare(y.c.id))[0]?.c.id ?? base.id;
  // Reservation state was computed for the original selected action; never reuse it after re-ranking.
  if (a.selectedId !== base.id) delete a.strategyState;
}

export function runCapacityTrial(config: CapacityConfig, spec: TrialSpec, injected?: AlgorithmEntry): CapacityTrial {
  validateConfig(config);
  const s = structuredClone(config.scenario); s.pallet.maxHeight = spec.height;
  s.supplyMode = 'arrival'; s.arrival = { seed: spec.seed, pattern: 'random-draw' }; s.events = [];
  s.constraints.robotMode = spec.mode === 'space' ? 'ideal' : 'gripper';
  const env = new ArrivalEnvironment(s), arrivals = Array.from({ length: env.total }, (_, i) => env.current(i)!);
  const def = injected ?? definition(spec.algorithm), started = performance.now();
  const row: CapacityTrial = { ...spec, id: `${spec.split}:${spec.seed}:${spec.height}:${spec.algorithm}:${spec.mode}`,
    fingerprint: fingerprint({ scenario: config.scenario, groups: config.groups, seed: spec.seed, height: spec.height, settings: config.settings, decisionMs: config.decisionMs, trialMs: config.trialMs, buffer: config.bufferCapacity, groupStrength: config.groupStrength, groupHeightSlack: config.groupHeightSlack }),
    status: 'finished', reason: '', scenario: s, arrivals: arrivals.map(o => o.id), trace: [], placements: [], total: env.total, processed: 0, unplaced: [], unprocessed: [],
    volume: 0, utilization: 0, envelopeFill: 0, usedHeight: 0, supplyBound: 0, robotSeconds: spec.mode === 'space' ? null : 0,
    computeMs: 0, meanMs: null, p95Ms: null, maxMs: null, deadlineMisses: 0, decisions: 0, checked: 0, rejections: {}, violations: [], robotAudit: [], crossZoneBlockers: 0, extraFit: 0, probeChecked: 0, bufferPeak: 0 };
  const pending = Object.fromEntries(s.types.map(t => [t.id, t.quantity])), waiting: Observation[] = [], times: number[] = [];
  let stack: Placement[] = [], state: PlanningInput['strategyState'], step = 0;
  const inputFor = (o: Observation): PlanningInput => {
    const remaining = { ...pending };
    for (const b of waiting) if (b.id !== o.id) remaining[b.typeId]++;
    return { runId: row.id, stepId: step++, pallet: structuredClone(s.pallet), types: structuredClone(s.types), constraints: structuredClone(s.constraints), placements: structuredClone(stack), current: structuredClone(o),
      remaining, algorithm: 'greedy', settings: structuredClone(config.settings), strategyState: structuredClone(state) };
  };
  const log = (o: Observation, action: CapacityStep['action'], reason: string, ms = 0, candidate?: Candidate, before = stack) => row.trace.push({ arrival: row.processed, box: structuredClone(o), action, reason, ms,
    candidate: candidate ? structuredClone(candidate) : undefined, before: structuredClone(before), after: structuredClone(stack), buffered: waiting.map(b => b.id) });
  const attempt = (o: Observation) => {
    const input = inputFor(o), begin = performance.now(), a = def.plan(structuredClone(input));
    if (spec.mode === 'organized') organize(a, input, config);
    const ms = performance.now() - begin; times.push(ms); row.checked += a.checkedCandidates ?? a.candidates.length;
    if (ms > config.decisionMs) { row.deadlineMisses++; row.status = 'timeout'; row.reason = `박스당 계산 기한 초과: ${ms.toFixed(1)} / ${config.decisionMs} ms · 늦은 배치 미채택`; return false; }
    if (performance.now() - started > config.trialMs) { row.status = 'timeout'; row.reason = '실행 시간 예산 초과 · 순위에서 제외'; return false; }
    for (const c of a.candidates) for (const reason of new Set(c.reasons.map(rejectionType))) row.rejections[reason] = (row.rejections[reason] ?? 0) + 1;
    const reasons = auditProposal(input, a);
    if (reasons.length) { row.violations.push(...reasons); row.status = 'error'; row.reason = '잘못된 배치 제안'; return false; }
    const c = a.candidates.find(c => c.id === a.selectedId && c.valid);
    if (!c) return false;
    const checked = inspectConstraints(c.placement, o, stack, s.pallet, s.constraints);
    if (checked.reasons.length) throw Error(checked.reasons.join(' / '));
    const before = stack; stack = checked.stack; state = structuredClone(a.strategyState);
    const w = waiting.findIndex(b => b.id === o.id); if (w >= 0) waiting.splice(w, 1);
    c.placement = checked.placement; c.path = checked.path;
    if (row.robotSeconds !== null) row.robotSeconds += checked.path.seconds;
    log(o, 'place', w >= 0 ? '보류 박스 재검토 후 적재' : '유효 후보 확정', ms, c, before); return true;
  };
  const drain = () => {
    let changed = true;
    while (changed && row.status === 'finished') { changed = false; for (const o of [...waiting]) { if (attempt(o)) changed = true; if (row.status !== 'finished') break; } }
  };
  try {
    for (const o of arrivals) {
      if (row.status !== 'finished') break;
      if (performance.now() - started > config.trialMs) { row.status = 'timeout'; row.reason = '실행 시간 예산 초과'; break; }
      row.processed++; pending[o.typeId]--;
      if (attempt(o)) { drain(); continue; }
      if (row.status !== 'finished') break;
      if (waiting.length < config.bufferCapacity) { waiting.push(o); row.bufferPeak = Math.max(row.bufferPeak, waiting.length); log(o, 'buffer', '유효 후보 없음 · 관측된 박스만 보류'); }
      else log(o, 'reject', '유효 후보 없음 · 버퍼 가득 참 · 별도 미적재 보존');
    }
    if (row.status === 'finished') drain();
  } catch (e) { row.status = 'error'; row.reason = e instanceof Error ? e.message : String(e); }
  row.placements = stack;
  const ids = new Set(stack.map(p => p.id));
  row.unplaced = arrivals.slice(0, row.processed).filter(o => !ids.has(o.id)).map(o => o.id);
  row.unprocessed = arrivals.slice(row.processed).map(o => o.id);
  if (ids.size !== stack.length || stack.length + row.unplaced.length + row.unprocessed.length !== row.total) throw Error('박스 수량 보존 위반');
  // Independent geometry check + replay of common constraints, and counterfactual robot audit
  // against the original sequence of placements. This audit never changes the space-only stack.
  let rebuilt: Placement[] = [];
  for (const p of stack) {
    if (rebuilt.some(b => intersects(p, b))) row.violations.push(`${p.id}: 독립 겹침 검사 실패`);
    if (p.position.x < 0 || p.position.y < 0 || p.position.z < 0 || p.position.x + p.size.w > s.pallet.width + 1e-6 || p.position.y + p.size.d > s.pallet.depth + 1e-6 || top(p) > spec.height + 1e-6) row.violations.push(`${p.id}: 독립 경계 검사 실패`);
    const o = arrivals.find(o => o.id === p.id)!, checked = inspectConstraints(p, o, rebuilt, s.pallet, s.constraints);
    row.violations.push(...checked.reasons.map(r => `${p.id}: ${r}`));
    const robot = inspectConstraints(p, o, rebuilt, s.pallet, { ...s.constraints, robotMode: 'gripper' });
    const reasons = robot.reasons.filter(r => ['robot-path', 'payload'].includes(rejectionType(r)));
    if (reasons.length) row.robotAudit.push({ box: p.id, reasons });
    rebuilt = checked.stack;
  }
  const capacity = s.pallet.width * s.pallet.depth * spec.height;
  row.volume = stack.reduce((n, p) => n + volume(p.size), 0); row.utilization = row.volume / capacity;
  row.usedHeight = Math.max(0, ...stack.map(top)); row.envelopeFill = row.usedHeight ? row.volume / (s.pallet.width * s.pallet.depth * row.usedHeight) : 0;
  row.supplyBound = Math.min(1, arrivals.reduce((n, o) => n + volume(o.size), 0) / capacity);
  const timing = distribution(times);
  row.computeMs = times.reduce((a, b) => a + b, 0); row.meanMs = timing.mean; row.p95Ms = timing.p95; row.maxMs = timing.max; row.decisions = times.length; row.crossZoneBlockers = crossZoneBlockers(stack, config.groups);
  // A wider final probe tells whether unused goods still have a feasible sampled position.
  // It is not an optimality proof and does not silently re-introduce rejected goods into the buffer.
  if (row.status === 'finished') {
    for (const t of s.types) {
      const o = arrivals.find(o => o.typeId === t.id && row.unplaced.includes(o.id)); if (!o) continue;
      const input = inputFor(o); input.settings.maxCandidates = Math.min(512, config.settings.maxCandidates * 4);
      input.settings.inventoryMode = 'none'; // feasibility probe needs no future-stock score
      const probe = candidateSet(input); row.probeChecked += probe.candidates.length;
      if (probe.candidates.some(c => c.valid)) row.extraFit++;
    }
  }
  return row;
}

export function summarizeCapacity(rows: CapacityTrial[], c: CapacityConfig, height: number, mode: Mode, split: TrialSpec['split']) {
  const expected = split === 'discovery' ? c.discoverySeeds : c.holdoutSeeds;
  return c.algorithms.map(algorithm => {
    const runs = rows.filter(r => r.algorithm === algorithm && r.height === height && r.mode === mode && r.split === split);
    const valid = runs.filter(r => r.status === 'finished' && !r.violations.length);
    const eligible = expected.every(seed => valid.some(r => r.seed === seed));
    return { algorithm, n: valid.length, expected: expected.length, eligible, misses: runs.reduce((n, r) => n + r.deadlineMisses, 0), utilization: distribution(valid.map(r => r.utilization)), count: distribution(valid.map(r => r.placements.length)), height: distribution(valid.map(r => r.usedHeight)), ms: distribution(runs.map(r => r.meanMs)), p95: distribution(runs.map(r => r.p95Ms)) };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.utilization.mean ?? -1) - (a.utilization.mean ?? -1) || (b.count.mean ?? -1) - (a.count.mean ?? -1) || (a.ms.mean ?? Infinity) - (b.ms.mean ?? Infinity) || a.algorithm.localeCompare(b.algorithm));
}
export function selectedAlgorithm(rows: CapacityTrial[], c: CapacityConfig, height: number) {
  return summarizeCapacity(rows, c, height, 'robot', 'discovery').find(r => r.eligible)?.algorithm ?? null;
}
export function pairedEffect(rows: CapacityTrial[], algorithm: string, height: number, mode: Mode, seeds: number[]) {
  const values = seeds.flatMap(seed => {
    const a = rows.find(r => r.algorithm === algorithm && r.height === height && r.seed === seed && r.mode === 'robot' && r.split === 'holdout' && r.status === 'finished' && !r.violations.length);
    const b = rows.find(r => r.algorithm === algorithm && r.height === height && r.seed === seed && r.mode === mode && r.split === 'holdout' && r.status === 'finished' && !r.violations.length);
    return a && b ? [(b.utilization - a.utilization) * 100] : [];
  }); return distribution(values);
}

// Shared adapters for complete-order demonstrations; the capacity experiment is unchanged.
export const capacityAlgorithm = definition;
export const applyZonePreference = organize;
