// scripts/benchmark-1000.ts
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { cpus, platform, arch } from "node:os";
import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";

// src/engine/vendor/pallet/strategies/PackingStrategy.ts
var STRATEGY_IDS = ["strategy-greedy", "macs", "tetris-reserved", "dynamic-reservation", "lookahead", "future-hybrid"];
var isStrategy = (id) => STRATEGY_IDS.includes(id);
var DEFAULT_STRATEGY = {
  criticalK: 3,
  futureCandidates: 12,
  lossMode: "normalized",
  lookaheadDepth: 3,
  lookaheadSamples: 4,
  lookaheadCandidates: 6,
  lookaheadMode: "expected",
  approach: false,
  approachHeight: 250,
  approachMargin: 20,
  weights: {
    compactness: 0.2,
    support: 0.15,
    stability: 0.15,
    centerOfMass: 0.1,
    flatness: 0.1,
    height: 0.15,
    fragmentation: 0.15,
    macs: 1,
    fpl: 1.5,
    deadEnd: 25,
    reservation: 20,
    lowerSpace: 2,
    lookahead: 1
  },
  criticalWeights: { volume: 1, aspect: 1, weight: 1, orientation: 1, scarcity: 3 }
};
function strategyConfig(value) {
  const c = { ...DEFAULT_STRATEGY, ...value, weights: { ...DEFAULT_STRATEGY.weights, ...value?.weights }, criticalWeights: { ...DEFAULT_STRATEGY.criticalWeights, ...value?.criticalWeights } };
  const integer2 = (key, min, max) => {
    const n2 = c[key];
    if (typeof n2 !== "number" || !Number.isInteger(n2) || n2 < min || n2 > max) throw Error(`\uC804\uB7B5 \uC124\uC815 ${key}: ${min}~${max} \uC815\uC218`);
  };
  integer2("criticalK", 1, 8);
  integer2("futureCandidates", 4, 64);
  integer2("lookaheadDepth", 1, 6);
  integer2("lookaheadSamples", 1, 20);
  integer2("lookaheadCandidates", 1, 16);
  for (const n2 of [c.approachHeight, c.approachMargin, ...Object.values(c.weights), ...Object.values(c.criticalWeights)]) if (!Number.isFinite(n2) || n2 < 0 || n2 > 1e4) throw Error("\uC804\uB7B5 \uAC00\uC911\uCE58\xB7\uC811\uADFC \uC5EC\uC720\uB294 0~10000 \uC720\uD55C\uC218\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  if (!["absolute", "normalized"].includes(c.lossMode) || !["expected", "worst"].includes(c.lookaheadMode) || typeof c.approach !== "boolean") throw Error("\uC804\uB7B5 \uBAA8\uB4DC \uC124\uC815 \uC624\uB958");
  return c;
}
function select(context, mode) {
  const evaluated = context.candidates.filter((c) => c.valid).map((candidate) => ({ candidate, debug: context.evaluate(candidate, mode) }));
  evaluated.sort((a, b) => b.debug.selectedScore - a.debug.selectedScore || a.candidate.placement.position.z - b.candidate.placement.position.z || a.candidate.id.localeCompare(b.candidate.id, void 0, { numeric: true }));
  const best = evaluated[0];
  return best ? { candidateId: best.candidate.id, placement: best.candidate.placement, score: best.debug.selectedScore, debugInfo: best.debug } : { candidateId: null, placement: null, score: null, debugInfo: null };
}

// src/engine/vendor/pallet/orientations.ts
var ALL_ORIENTATIONS = [0, 90, "whd", "hwd", "hdw", "dhw"];
var isStanding = (o) => typeof o === "string";
var orientationRank = (o) => ALL_ORIENTATIONS.indexOf(o);
var orientationYaw = (o) => o === 90 || o === "hwd" || o === "dhw" ? 90 : 0;
var verticalAxis = (o) => o === "hdw" || o === "dhw" ? "w" : o === "whd" || o === "hwd" ? "d" : "h";
function orientedSize(s, o) {
  const axes = { 0: [s.w, s.d, s.h], 90: [s.d, s.w, s.h], whd: [s.w, s.h, s.d], hwd: [s.h, s.w, s.d], hdw: [s.h, s.d, s.w], dhw: [s.d, s.h, s.w] };
  const [w, d, h] = axes[o];
  return { w, d, h };
}
function poseVector(v, o) {
  let p = verticalAxis(o) === "w" ? { x: -v.z, y: v.y, z: v.x } : verticalAxis(o) === "d" ? { x: v.x, y: -v.z, z: v.y } : { ...v };
  if (orientationYaw(o)) p = { x: p.y, y: -p.x, z: p.z };
  return p;
}
function allowedOrientations(size, allowed, handling, axisLoads) {
  const seen = /* @__PURE__ */ new Set();
  return allowed.filter((o) => {
    if (handling === "upright" && isStanding(o)) return false;
    const s = orientedSize(size, o), key = `${s.w}:${s.d}:${s.h}:${axisLoads ? verticalAxis(o) : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// src/engine/vendor/pallet/packaging/spec.ts
var ORIENTATIONS = { XYZ: 0, XZY: "whd", YXZ: 90, YZX: "dhw", ZXY: "hwd", ZYX: "hdw" };
function permittedOrientations(s) {
  return [...new Set(s.allowedOrientations.filter((o) => !s.keepUpright || o === "XYZ" || o === "YXZ").map((o) => ORIENTATIONS[o]))];
}
function localMassCenter(s, o) {
  const offset = poseVector({ x: s.centerOfGravity.x - s.length / 2, y: s.centerOfGravity.y - s.width / 2, z: s.centerOfGravity.z - s.height / 2 }, o), size = orientedSize({ w: s.length, d: s.width, h: s.height }, o);
  return { x: size.w / 2 + offset.x, y: size.d / 2 + offset.y, z: size.h / 2 + offset.z };
}
function massCenter(b) {
  const c = b.packaging ? localMassCenter(b.packaging, b.orientation ?? 0) : { x: b.size.w / 2, y: b.size.d / 2, z: b.size.h / 2 };
  return { x: b.position.x + c.x, y: b.position.y + c.y, z: b.position.z + c.z };
}

// src/engine/vendor/pallet/geometry.ts
var EPS = 1e-6;
var oriented = (s, o) => orientedSize(s, o);
var volume = (s) => s.w * s.d * s.h;
var top = (b) => b.position.z + b.size.h;
function overlapRect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), w = Math.min(a.x + a.w, b.x + b.w) - x, d = Math.min(a.y + a.d, b.y + b.d) - y;
  return w > EPS && d > EPS ? { x, y, w, d } : null;
}
var footprint = (b) => ({ x: b.position.x, y: b.position.y, w: b.size.w, d: b.size.d });
function intersects(a, b, gap = 0) {
  return a.position.x + a.size.w > b.position.x + EPS - gap && b.position.x + b.size.w > a.position.x + EPS - gap && a.position.y + a.size.d > b.position.y + EPS - gap && b.position.y + b.size.d > a.position.y + EPS - gap && a.position.z + a.size.h > b.position.z + EPS && b.position.z + b.size.h > a.position.z + EPS;
}
function contactsFor(box, others, tolerance) {
  if (Math.abs(box.position.z) < EPS) return [];
  const contacts = others.filter((b) => Math.abs(top(b) - box.position.z) <= tolerance).flatMap((b) => {
    const rect = overlapRect(footprint(box), footprint(b));
    return rect ? [{ id: b.id, rect, area: rect.w * rect.d, share: 0 }] : [];
  });
  const area = contacts.reduce((s, c) => s + c.area, 0);
  return contacts.map((c) => ({ ...c, share: area ? c.area / area : 0 }));
}
var cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= EPS) lower.pop();
    lower.push(p);
  }
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= EPS) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function centerSupported(box, contacts) {
  if (box.position.z === 0) return true;
  const points = contacts.flatMap((c) => [{ x: c.rect.x, y: c.rect.y }, { x: c.rect.x + c.rect.w, y: c.rect.y }, { x: c.rect.x, y: c.rect.y + c.rect.d }, { x: c.rect.x + c.rect.w, y: c.rect.y + c.rect.d }]);
  const hull = convexHull(points), p = massCenter(box);
  return hull.length >= 3 && hull.every((a, i) => cross(a, hull[(i + 1) % hull.length], p) >= -EPS);
}
function calculateLoads(placements) {
  const loads = Object.fromEntries(placements.map((p) => [p.id, 0]));
  for (const b of [...placements].sort((a, b2) => b2.position.z - a.position.z || b2.id.localeCompare(a.id))) {
    for (const contact2 of b.supports) if (contact2.id in loads) loads[contact2.id] += (b.weight + loads[b.id]) * (b.packaging ? contact2.area / Math.max(EPS, b.supports.reduce((n2, c) => n2 + c.area, 0)) : contact2.share);
  }
  return loads;
}
function withLoads(placements) {
  const loads = calculateLoads(placements);
  return placements.map((p) => ({ ...p, loadAbove: loads[p.id] }));
}
function landingHeight(x, y, size, placed) {
  const rect = { x, y, w: size.w, d: size.d };
  let z = 0;
  for (const p of placed) if (overlapRect(rect, footprint(p))) z = Math.max(z, top(p));
  return z;
}
function sparseOrigins(pallet, size, placed, gap) {
  const keys = /* @__PURE__ */ new Set(), result = [];
  const add3 = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const key = `${x.toFixed(4)}:${y.toFixed(4)}`;
    if (!keys.has(key)) {
      keys.add(key);
      result.push({ x, y, z: landingHeight(x, y, size, placed) });
    }
  };
  for (const x of [0, pallet.width - size.w]) for (const y of [0, pallet.depth - size.d]) add3(x, y);
  for (const b of placed) {
    const xs = [b.position.x, b.position.x + b.size.w + gap, b.position.x - size.w - gap, b.position.x + b.size.w - size.w], ys = [b.position.y, b.position.y + b.size.d + gap, b.position.y - size.d - gap, b.position.y + b.size.d - size.d];
    for (const x of xs) for (const y of ys) add3(x, y);
    for (const x of xs) for (const y of [0, pallet.depth - size.d]) add3(x, y);
    for (const y of ys) for (const x of [0, pallet.width - size.w]) add3(x, y);
  }
  return result.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

// src/engine/vendor/pallet/equilibrium.ts
function solve3(matrix, rhs) {
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    if (Math.abs(a[pivot][i]) < 1e-12) return null;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const divisor = a[i][i];
    for (let k = i; k < 4; k++) a[i][k] /= divisor;
    for (let j = 0; j < 3; j++) if (j !== i) {
      const factor = a[j][i];
      for (let k = i; k < 4; k++) a[j][k] -= factor * a[i][k];
    }
  }
  return a.map((row) => row[3]);
}
function reactions(contacts, x, y) {
  const totalArea = contacts.reduce((n2, c) => n2 + c.area, 0), nodes = contacts.flatMap((c, owner) => {
    const r = c.rect;
    return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.d], [r.x, r.y + r.d]].map(([x2, y2]) => ({ x: x2, y: y2, owner, reference: c.area / (totalArea * 4) }));
  });
  if (!nodes.length) return null;
  const scale = Math.max(1, ...nodes.map((n2) => Math.max(Math.abs(n2.x - x), Math.abs(n2.y - y)))), vectors = nodes.map((n2) => [1, (n2.x - x) / scale, (n2.y - y) / scale]), active = new Set(nodes.map((_, i) => i));
  let weights = null;
  for (let pass = 0; pass < nodes.length; pass++) {
    const m = Array.from({ length: 3 }, () => [0, 0, 0]), rhs = [1, 0, 0];
    for (const i of active) {
      const a = vectors[i], r = nodes[i].reference;
      for (let j = 0; j < 3; j++) {
        rhs[j] -= r * a[j];
        for (let k = 0; k < 3; k++) m[j][k] += r * a[j] * a[k];
      }
    }
    const lambda = solve3(m, rhs);
    if (!lambda) break;
    const trial = nodes.map((n2, i) => active.has(i) ? n2.reference * (1 + vectors[i].reduce((s, v, j) => s + v * lambda[j], 0)) : 0);
    let worst = -1;
    for (const i of active) if (trial[i] < -1e-9 && (worst < 0 || trial[i] < trial[worst])) worst = i;
    if (worst < 0) {
      weights = trial.map((w) => Math.max(0, w));
      break;
    }
    active.delete(worst);
  }
  if (!weights) {
    const hull = convexHull(nodes), a = hull[0];
    for (let k = 1; k < hull.length - 1 && !weights; k++) {
      const b = hull[k], c = hull[k + 1], den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(den) < EPS) continue;
      const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den, v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den, w = 1 - u - v;
      if (Math.min(u, v, w) >= -1e-9) {
        weights = nodes.map(() => 0);
        for (const [point, value] of [[a, u], [b, v], [c, w]]) weights[nodes.findIndex((n2) => n2.x === point.x && n2.y === point.y)] += Math.max(0, value);
      }
    }
  }
  if (!weights) return null;
  const sum = weights.reduce((a, b) => a + b, 0);
  weights = weights.map((w) => w / sum);
  const force = contacts.map((c, i) => {
    let share = 0, mx = 0, my = 0;
    for (let j = 0; j < nodes.length; j++) if (nodes[j].owner === i) {
      share += weights[j];
      mx += weights[j] * nodes[j].x;
      my += weights[j] * nodes[j].y;
    }
    return { ...c, share, forcePoint: share > EPS ? { x: mx / share, y: my / share } : { x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.d / 2 } };
  });
  const residual = Math.max(Math.abs(force.reduce((n2, c) => n2 + c.share * c.forcePoint.x, 0) - x), Math.abs(force.reduce((n2, c) => n2 + c.share * c.forcePoint.y, 0) - y));
  return residual < 1e-5 ? force : null;
}
function equilibrium(placements) {
  const stack = placements.map((b) => ({ ...b, supports: b.supports.map((c) => ({ ...c, rect: { ...c.rect } })), loadAbove: 0 })), moments = new Map(stack.map((b) => [b.id, { mass: b.weight, mx: massCenter(b).x * b.weight, my: massCenter(b).y * b.weight, mz: massCenter(b).z * b.weight }])), violations = [];
  for (const b of [...stack].sort((a, b2) => b2.position.z - a.position.z)) {
    const m = moments.get(b.id);
    b.loadAbove = m.mass - b.weight;
    if (!b.supports.length) continue;
    const balanced = reactions(b.supports, m.mx / m.mass, m.my / m.mass);
    if (!balanced) {
      violations.push(`\uB204\uC801 \uBB34\uAC8C\uC911\uC2EC \uC815\uC801 \uD3C9\uD615 \uBD88\uAC00 \xB7 ${b.id}`);
      continue;
    }
    b.supports = balanced;
    for (const s of balanced) {
      const parent = moments.get(s.id);
      if (!parent) continue;
      const mass = m.mass * s.share;
      parent.mass += mass;
      parent.mx += mass * s.forcePoint.x;
      parent.my += mass * s.forcePoint.y;
      parent.mz += m.mz * s.share;
    }
  }
  return { placements: stack, moments, violations };
}

// src/engine/vendor/pallet/types.ts
var DEFAULT_STABILITY = { maxSlenderness: 2, minMarginRatio: 0.1, lateralAccelerationG: 0.15, loadSafetyFactor: 1.25 };
var ALGORITHM_NAMES = { random: "\uBB34\uC791\uC704 \uBC30\uCE58", bl: "\uAE30\uBCF8 \uBC30\uCE58 \xB7 \uC794\uB7C9 \uAC80\uC0AC", greedy: "\uC81C\uC57D \uAE30\uBC18 \uD3C9\uAC00 \xB7 Greedy", rollout: "\uB0A8\uC740 \uBC15\uC2A4 \uACE0\uB824 \xB7 Rollout", "strategy-greedy": "Greedy \xB7 \uD604\uC7AC \uBC15\uC2A4\uB9CC", macs: "MACS", "tetris-reserved": "Tetris Reserved Slot", "dynamic-reservation": "Dynamic Reservation", lookahead: "Lookahead", "future-hybrid": "Future-Aware Hybrid" };
var DEFAULT_SEARCH = { plannerSeed: 2026, topK: 6, samples: 4, depth: 3, maxCandidates: 128, virtualCandidates: 24, candidateMode: "frontier", inventoryMode: "geometry", portfolio: true, weights: { maximum: 30, mean: 16, roughness: 20, void: 25, flat: 8, balance: 12, time: 4, future: 45, stability: 24, inventory: 32, foundation: 24, load: 12, contact: 12, futureSurface: 24 } };
var ONLINE_SEARCH = { ...DEFAULT_SEARCH, policy: "online", portfolio: false, topK: 6, samples: 4, depth: 3, maxCandidates: 96, virtualCandidates: 16, reserveProbes: 8 };
var COMPACT_SEARCH = { ...ONLINE_SEARCH, stockPolicy: "compact", maxCandidates: 128, interiorPacking: true, temporaryBuffer: true };
var DEFAULT_PHYSICS = { seconds: 3, dt: 1 / 120, friction: 0.6, moveToleranceMm: 5, angleToleranceDeg: 3, materialFriction: true, solverIterations: 12, contactNaturalFrequencyHz: 120 };

// src/engine/vendor/pallet/stability.ts
var corners = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.d }, { x: r.x, y: r.y + r.d }];
function edgeMargin(hull, p) {
  if (hull.length < 3) return -Infinity;
  return Math.min(...hull.map((a, i) => {
    const b = hull[(i + 1) % hull.length];
    return ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.max(EPS, Math.hypot(b.x - a.x, b.y - a.y));
  }));
}
function centroid(hull) {
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], cross2 = a.x * b.y - b.x * a.y;
    area += cross2;
    x += (a.x + b.x) * cross2;
    y += (a.y + b.y) * cross2;
  }
  return Math.abs(area) > EPS ? { x: x / (3 * area), y: y / (3 * area) } : { x: hull.reduce((s, p) => s + p.x, 0) / hull.length, y: hull.reduce((s, p) => s + p.y, 0) / hull.length };
}
function stability(placed, cfg = DEFAULT_STABILITY, solution) {
  const result = solution ?? equilibrium(placed), violations = [...result.violations], moments = result.moments, supports = [];
  placed = result.placements;
  let minReserve = Infinity;
  for (const b of placed) {
    const m = moments.get(b.id), center = { x: m.mx / m.mass, y: m.my / m.mass, z: m.mz / m.mass };
    const rects = b.supports.length ? b.supports.map((s) => s.rect) : b.position.z === 0 ? [{ x: b.position.x, y: b.position.y, w: b.size.w, d: b.size.d }] : [];
    if (!rects.length) continue;
    const hull = convexHull(rects.flatMap(corners)), xs = hull.map((p) => p.x), ys = hull.map((p) => p.y), width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...ys) - Math.min(...ys);
    const margin = edgeMargin(hull, center), required = Math.max(Math.min(width, depth) * cfg.minMarginRatio, Math.max(0, center.z - b.position.z) * cfg.lateralAccelerationG), reserve2 = margin - required;
    minReserve = Math.min(minReserve, reserve2);
    const anchor = centroid(hull), supportCenter = { ...anchor, z: b.position.z }, offsetMm = Math.hypot(center.x - anchor.x, center.y - anchor.y), offsetRatio = Math.max(Math.abs(center.x - anchor.x) / Math.max(EPS, width / 2), Math.abs(center.y - anchor.y) / Math.max(EPS, depth / 2));
    supports.push({ id: b.id, isBase: b.position.z === 0, planeZ: b.position.z, mass: m.mass, loadAbove: b.loadAbove, center, supportCenter, offsetMm, offsetRatio, margin, required, reserve: reserve2 });
    if (reserve2 < -EPS) violations.push(`\uB204\uC801 \uBB34\uAC8C\uC911\uC2EC \uC5EC\uC720 \uBD80\uC871 \xB7 ${b.id} (${margin.toFixed(1)} / \uD544\uC694 ${required.toFixed(1)} mm)`);
  }
  const parent = new Map(placed.map((b) => [b.id, b.id]));
  const find = (id) => {
    let p = parent.get(id);
    while (p !== parent.get(p)) p = parent.get(p);
    return p;
  };
  for (const b of placed) for (const s of b.supports) if (parent.has(s.id)) parent.set(find(b.id), find(s.id));
  const groups = /* @__PURE__ */ new Map();
  for (const b of placed) {
    const id = find(b.id);
    groups.set(id, [...groups.get(id) || [], b]);
  }
  const components = [...groups.values()].map((boxes) => {
    const bases = boxes.filter((b) => b.position.z === 0);
    if (!bases.length) return { ids: boxes.map((b) => b.id), height: 0, width: 0, depth: 0, slenderness: 0 };
    const x0 = Math.min(...bases.map((b) => b.position.x)), y0 = Math.min(...bases.map((b) => b.position.y)), width = Math.max(...bases.map((b) => b.position.x + b.size.w)) - x0, depth = Math.max(...bases.map((b) => b.position.y + b.size.d)) - y0, height = Math.max(...boxes.map(top)), slenderness = height / Math.min(width, depth);
    if (cfg.slendernessMode !== "score" && slenderness > cfg.maxSlenderness + EPS) violations.push(`\uB3C5\uB9BD \uAE30\uB465 \uB192\uC774 / \uBC1B\uCE68 \uD3ED \uCD08\uACFC \xB7 ${boxes[0].id} (${slenderness.toFixed(2)} > ${cfg.maxSlenderness.toFixed(2)})`);
    return { ids: boxes.map((b) => b.id), height, width, depth, slenderness };
  });
  const loaded = supports.filter((s) => s.loadAbove > EPS), mass = loaded.reduce((sum, s) => sum + s.mass, 0), lowerBalance = loaded.length ? 0.75 * Math.max(...loaded.map((s) => s.offsetRatio)) + 0.25 * loaded.reduce((sum, s) => sum + s.mass * s.offsetRatio, 0) / mass : 0;
  return { components, supports, lowerBalance, slenderness: Math.max(0, ...components.map((c) => c.slenderness)), minReserve: Number.isFinite(minReserve) ? minReserve : 0, violations };
}

// src/engine/vendor/pallet/rng.ts
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 1831565813;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(values, random) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// src/engine/vendor/pallet/inventoryGeneration.ts
var DEFAULT_DIMENSIONS = { w: { min: 150, max: 760 }, d: { min: 120, max: 560 }, h: { min: 90, max: 460 } };
var DEFAULT_FIELD = { seed: 20261004, typeCount: 8, totalCount: 30, assortment: "individual", dimensions: DEFAULT_DIMENSIONS };
var profiles = [
  { name: "\uC587\uC740 \uACE8\uD310\uC9C0", material: "paper", load: [8, 28], friction: [0.28, 0.55], tare: [0.08, 0.5] },
  { name: "\uAC15\uD654 \uACE8\uD310\uC9C0", material: "paper", load: [24, 65], friction: [0.3, 0.6], tare: [0.15, 0.8] },
  { name: "\uC587\uC740 \uD50C\uB77C\uC2A4\uD2F1", material: "plastic", load: [12, 45], friction: [0.2, 0.5], tare: [0.3, 1.5] },
  { name: "\uD50C\uB77C\uC2A4\uD2F1 \uD1A0\uD2B8", material: "plastic", load: [38, 110], friction: [0.25, 0.65], tare: [0.8, 3] },
  { name: "\uBAA9\uC7AC \uD3EC\uC7A5", material: "wood", load: [40, 150], friction: [0.35, 0.7], tare: [1, 4] }
];
function heterogeneousInventory(options) {
  const { seed, totalCount, typeCount } = options, assortment = options.assortment ?? "individual", dimensions = structuredClone(options.dimensions ?? DEFAULT_DIMENSIONS), individual = assortment === "individual", n2 = individual ? totalCount : typeCount;
  if (!Number.isInteger(seed) || !Number.isInteger(totalCount) || totalCount < 1 || totalCount > 120 || !["individual", "repeated"].includes(assortment) || !Number.isInteger(n2) || n2 < 1 || n2 > totalCount) throw Error("\uB79C\uB364 \uC785\uB825: \uC804\uCCB4 \uC218\uB7C9 1~120, \uBC18\uBCF5 \uADDC\uACA9 \uC218\uB294 \uC804\uCCB4 \uC218\uB7C9 \uC774\uD558, \uC2DC\uB4DC\uB294 \uC815\uC218\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  for (const [axis, r] of Object.entries(dimensions)) if (!r || !Number.isInteger(r.min) || !Number.isInteger(r.max) || r.min < 50 || r.max > 2e3 || r.min > r.max) throw Error(`${axis} \uCE58\uC218 \uBC94\uC704\uB294 50~2000 mm \uC815\uC218\uC774\uBA70 \uCD5C\uC18C \u2264 \uCD5C\uB300\uC5EC\uC57C \uD569\uB2C8\uB2E4.`);
  if (!dimensions.w || !dimensions.d || !dimensions.h) throw Error("\uAC00\uB85C\xB7\uAE4A\uC774\xB7\uB192\uC774 \uBC94\uC704\uAC00 \uBAA8\uB450 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const random = rng(seed), integer2 = (a, b) => a + Math.floor(random() * (b - a + 1)), between = ([a, b]) => a + random() * (b - a), round = (n3) => Math.round(n3 * 100) / 100, seen = /* @__PURE__ */ new Set();
  const colors = ["#6bcab7", "#e8b86a", "#80a9e8", "#cc97df", "#e69ca3", "#93c788"];
  const types = Array.from({ length: n2 }, (_, i) => {
    const profile = profiles[integer2(0, profiles.length - 1)];
    let size = { w: 0, d: 0, h: 0 };
    for (let attempt = 0; attempt < 100; attempt++) {
      size = { w: integer2(dimensions.w.min, dimensions.w.max), d: integer2(dimensions.d.min, dimensions.d.max), h: integer2(dimensions.h.min, dimensions.h.max) };
      const key = `${size.w}/${size.d}/${size.h}`;
      if (!seen.has(key)) {
        seen.add(key);
        break;
      }
      if (attempt === 99) throw Error("\uCE58\uC218 \uBC94\uC704\uAC00 \uB108\uBB34 \uC881\uC544 \uC11C\uB85C \uB2E4\uB978 \uBC15\uC2A4\uB97C \uB9CC\uB4E4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBC94\uC704\uB97C \uB113\uD788\uC138\uC694.");
    }
    const density = between([35, 320]), weight = round(size.w * size.d * size.h / 1e9 * density + between(profile.tare)), fragile = random() < 0.08;
    return { id: `B${i + 1}`, name: `${profile.name} \xB7 ${individual ? "\uAC1C\uBCC4" : "\uADDC\uACA9"} ${i + 1}`, size, weight, quantity: 1, orientations: [0, 90], color: colors[i % colors.length], material: profile.material, maxLoadKg: fragile ? 0 : round(between(profile.load)), maxLoadSource: "synthetic", strengthFactor: round(between([0.55, 1])), friction: round(between(profile.friction)), ...fragile ? { handling: "no-top-load" } : {} };
  });
  if (!individual) for (let i = n2; i < totalCount; i++) types[integer2(0, n2 - 1)].quantity++;
  const generation = { seed, typeCount: n2, totalCount, model: "heterogeneous", assortment, dimensions };
  return { types, generation };
}

// src/engine/vendor/pallet/highStack.ts
function highStackBoxes() {
  const widths = [537, 523, 549, 531], depths = [441, 457, 433, 449], heights = [247, 239, 253, 231, 257, 245];
  const colors = ["#6bcab7", "#e8b86a", "#80a9e8", "#cc97df", "#e69ca3", "#93c788"];
  return Array.from({ length: 24 }, (_, i) => {
    const tier = Math.floor(i / 4), j = i % 4;
    return { id: `H${i + 1}`, name: `\uD63C\uD569 ${i + 1}`, size: { w: widths[j] - tier * 24, d: depths[j] - tier * 18, h: heights[tier] }, quantity: 1, weight: 12 - tier * 2, orientations: [0, 90], color: colors[tier], material: tier < 2 ? "plastic" : tier < 4 ? "wood" : "paper", maxLoadKg: 120 - tier * 18, maxLoadSource: "synthetic", friction: 0.5, strengthFactor: 0.85 };
  });
}

// src/engine/vendor/pallet/standingHeight.ts
var DEFAULT_STANDING_HEIGHT = { enabled: true, maxRiseMm: 100 };
var isTallBox = (b) => b.size.h > 1.25 * Math.min(b.size.w, b.size.d) + EPS;
function standingHeight(b, placed, c) {
  const config2 = { ...DEFAULT_STANDING_HEIGHT, ...c.standingHeight }, tall = isTallBox(b), limitMm = Math.min(config2.maxRiseMm, b.size.h * 0.25);
  const nearMm = Math.max(20, c.horizontalGap), references = [];
  if (tall) for (const o of placed) {
    if (isTallBox(o) || top(o) <= b.position.z + EPS || o.position.z >= b.position.z + b.size.h - EPS) continue;
    const overlapX = Math.max(0, Math.min(b.position.x + b.size.w, o.position.x + o.size.w) - Math.max(b.position.x, o.position.x));
    const overlapY = Math.max(0, Math.min(b.position.y + b.size.d, o.position.y + o.size.d) - Math.max(b.position.y, o.position.y));
    const gapX = Math.max(o.position.x - (b.position.x + b.size.w), b.position.x - (o.position.x + o.size.w));
    const gapY = Math.max(o.position.y - (b.position.y + b.size.d), b.position.y - (o.position.y + o.size.d));
    const coverage = Math.max(gapX >= -EPS && gapX <= nearMm + EPS ? overlapY / b.size.d : 0, gapY >= -EPS && gapY <= nearMm + EPS ? overlapX / b.size.w : 0);
    if (coverage >= 0.5 - EPS) references.push({ id: o.id, height: top(o), coverage });
  }
  references.sort((a, b2) => b2.height - a.height || b2.coverage - a.coverage || a.id.localeCompare(b2.id));
  const reference = references[0], referenceHeight = reference?.height ?? null, riseMm = reference ? Math.max(0, b.position.z + b.size.h - reference.height) : null;
  const valid = !config2.enabled || !tall || !!reference && riseMm <= limitMm + EPS;
  const reason = valid ? "" : !reference ? "\uC138\uB85C \uBC15\uC2A4 \uC8FC\uBCC0 \uB192\uC774 \uBD80\uC871 \xB7 \uAC00\uAE4C\uC6B4 \uB215\uD78C \uC801\uC7AC\uB97C \uBA3C\uC800 \uC313\uC544\uC57C \uD568" : `\uC138\uB85C \uBC15\uC2A4 \uB3CC\uCD9C \uB192\uC774 \uCD08\uACFC \xB7 ${riseMm.toFixed(0)} / ${limitMm.toFixed(0)} mm \xB7 \uC774\uC6C3 ${reference.id}`;
  return { enabled: config2.enabled, tall, valid, referenceId: reference?.id ?? null, referenceHeight, riseMm, limitMm, nearMm, reason };
}

// src/engine/vendor/pallet/scenarios.ts
function scenario(id = "mixed", seed = 42) {
  const s = { version: 1, units: { length: "mm", weight: "kg", time: "s" }, id, name: "\uD63C\uD569 \uBC15\uC2A4 \xB7 \uAE30\uBCF8 \uC608\uC81C", pallet: { width: 1200, depth: 1e3, maxHeight: 1600 }, types: [
    { id: "A", name: "\uB300\uD615", size: { w: 600, d: 400, h: 300 }, weight: 12, quantity: 8, orientations: [0, 90], color: "#e8b86a" },
    { id: "B", name: "\uC911\uD615", size: { w: 400, d: 300, h: 250 }, weight: 7, quantity: 12, orientations: [0, 90], color: "#6bcab7" },
    { id: "C", name: "\uC18C\uD615", size: { w: 300, d: 200, h: 200 }, weight: 3, quantity: 16, orientations: [0, 90], color: "#80a9e8" },
    { id: "D", name: "\uBBF8\uB2C8", size: { w: 200, d: 200, h: 150 }, weight: 1.5, quantity: 20, orientations: [0, 90], color: "#cc97df" }
  ], constraints: { robotMode: "ideal", supportRatio: 0.95, contactTolerance: 0.5, horizontalGap: 0, heavyRule: "off", stability: { ...DEFAULT_STABILITY }, gripper: { width: 180, depth: 160, height: 160, mass: 3, payload: 20, margin: 5, lift: 200, speed: 650, pickSeconds: 1, placeSeconds: 1 }, workspace: { xMin: -1400, xMax: 1600, yMin: -500, yMax: 1500, zMax: 2600 } }, arrival: { seed, pattern: "shuffle" }, events: [] };
  s.types.forEach((t, i) => {
    t.material = i < 2 ? "plastic" : "paper";
    t.strengthFactor = 1;
  });
  if (id === "field") {
    s.supplyMode = "stock-select";
    const input = heterogeneousInventory(DEFAULT_FIELD);
    s.name = "\uC11C\uB85C \uB2E4\uB978 \uD63C\uD569 \uBC15\uC2A4 30\uAC1C \xB7 \uD569\uC131 \uC785\uB825";
    s.types = input.types;
    s.generation = input.generation;
    s.arrival.pattern = "random-draw";
  }
  if (id === "online-task" || id === "high-stack" || id === "compact-mixed" || id === "spatial-mixed") {
    s.supplyMode = "arrival";
    const input = heterogeneousInventory(DEFAULT_FIELD);
    s.name = "\uACFC\uC81C \uC870\uAC74 \xB7 \uBB34\uC791\uC704 \uD63C\uD569 \uBC15\uC2A4 30\uAC1C";
    s.types = input.types;
    s.generation = input.generation;
    s.arrival.pattern = "random-draw";
    s.constraints.robotMode = "gripper";
    s.constraints.heavyRule = "each";
    s.constraints.gripper.payload = 35;
    s.constraints.gripper.rotationSpeed = 180;
    s.constraints.reach = { baseX: -700, baseY: 500, minRadius: 0, maxRadius: 2400 };
    s.constraints.stability.slendernessMode = "score";
  }
  if (id === "compact-mixed") {
    const input = heterogeneousInventory({ ...DEFAULT_FIELD, assortment: "repeated", typeCount: 8, totalCount: 48 });
    s.name = "\uD63C\uD569 \uACF5\uAC04 \uCC44\uC6B0\uAE30 \xB7 \uBB34\uC791\uC704 8\uC885 48\uAC1C";
    s.supplyMode = "stock-select";
    s.types = input.types;
    s.generation = input.generation;
  }
  if (id === "spatial-mixed") {
    s.name = "\uB0B4\uBD80 \uBE48\uD2C8 \xB7 6\uC790\uC138 \uD63C\uD569 \uC7AC\uACE0 30\uAC1C";
    s.supplyMode = "stock-select";
    s.types.forEach((t) => {
      if (t.handling !== "upright") t.orientations = [...ALL_ORIENTATIONS];
    });
  }
  if (id === "high-stack") {
    s.name = "\uC774\uC804 \uAC80\uC99D \xB7 \uC911\uC559 \uAE30\uB465 24\uAC1C \xB7 6\uB2E8";
    s.supplyMode = "stock-select";
    s.types = highStackBoxes();
    delete s.generation;
  }
  if (id === "reference") {
    s.name = "\uAC80\uC99D\uC6A9 \xB7 \uADDC\uACA9 \uBC15\uC2A4 30\uAC1C";
    s.types = [{ ...s.types[0], size: { w: 600, d: 400, h: 200 }, weight: 5.76, quantity: 3 }, { ...s.types[1], size: { w: 400, d: 400, h: 200 }, weight: 3.84, quantity: 5 }, { ...s.types[2], size: { w: 400, d: 200, h: 200 }, weight: 1.92, quantity: 10 }, { ...s.types[3], size: { w: 200, d: 200, h: 200 }, weight: 0.96, quantity: 12 }];
  }
  if (id === "identical") {
    s.name = "\uB3D9\uC77C \uBC15\uC2A4 \xB7 \uBAA8\uB450 \uC801\uC7AC \uAC00\uB2A5";
    s.types = [{ ...s.types[0], size: { w: 300, d: 250, h: 200 }, weight: 5, quantity: 12 }];
  }
  if (id === "large-late") {
    s.name = "\uD070 \uBC15\uC2A4\uAC00 \uB2A6\uAC8C \uB3C4\uCC29";
    s.arrival.pattern = "large-late";
  }
  if (id === "heavy-late") {
    s.name = "\uBB34\uAC70\uC6B4 \uBC15\uC2A4\uAC00 \uB2A6\uAC8C \uB3C4\uCC29";
    s.arrival.pattern = "heavy-late";
  }
  if (id === "restricted") {
    s.name = "\uD68C\uC804 \uC81C\uD55C";
    s.types.forEach((t) => t.orientations = [0]);
  }
  if (id === "gripper") {
    s.name = "\uADF8\uB9AC\uD37C \uC811\uADFC \uB09C\uC774\uB3C4";
    s.constraints.robotMode = "gripper";
    s.constraints.gripper.width = 650;
    s.constraints.gripper.depth = 500;
    s.constraints.gripper.margin = 20;
  }
  if (id === "events") {
    s.name = "\uC190\uC0C1 \xB7 \uB204\uB77D \xB7 \uADDC\uACA9 \uBCC0\uACBD";
    s.events = [{ step: 2, kind: "damaged" }, { step: 5, kind: "missing" }, { step: 8, kind: "resize", size: { w: 500, d: 350, h: 320 } }];
  }
  if (id === "impossible") {
    s.name = "\uBC84\uD37C \uC5C6\uB294 \uBC30\uCE58 \uC2E4\uD328";
    s.pallet = { width: 300, depth: 300, maxHeight: 300 };
    s.types = [{ ...s.types[3], quantity: 1 }, { ...s.types[0], quantity: 1, size: { w: 400, d: 400, h: 200 } }];
    s.arrival.pattern = "ordered";
  }
  if (id === "materials") {
    s.name = "\uAC00\uBCBC\uC6B4 \uD50C\uB77C\uC2A4\uD2F1 \uBC1B\uCE68 \xB7 \uBB34\uAC70\uC6B4 \uC885\uC774 \uC0C1\uC790";
    s.types = [{ ...s.types[0], id: "P", name: "\uD50C\uB77C\uC2A4\uD2F1 \uBC1B\uCE68", size: { w: 600, d: 400, h: 200 }, weight: 3, quantity: 4, material: "plastic" }, { ...s.types[2], id: "K", name: "\uC885\uC774 \uC0C1\uC790", size: { w: 300, d: 200, h: 200 }, weight: 7, quantity: 12, material: "paper" }];
    s.arrival.pattern = "ordered";
  }
  if (id === "buffer-demo") {
    s.name = "\uC784\uC2DC \uBCF4\uB958 \u2192 \uBC1B\uCE68 \uC801\uC7AC \u2192 \uC0C1\uB2E8 \uBCF5\uADC0";
    s.supplyMode = "stock-select";
    s.pallet = { width: 400, depth: 400, maxHeight: 600 };
    s.constraints.heavyRule = "each";
    s.constraints.robotMode = "gripper";
    s.types = [
      { id: "CAP", name: "\uC704 \uC801\uC7AC \uAE08\uC9C0 \xB7 \uB9C8\uC9C0\uB9C9 \uC0C1\uC790", size: { w: 400, d: 400, h: 100 }, weight: 1, quantity: 1, orientations: [0], handling: "no-top-load", material: "paper", maxLoadKg: 0, color: "#cc97df" },
      { id: "BASE", name: "\uD2BC\uD2BC\uD55C \uD558\uB2E8", size: { w: 400, d: 400, h: 200 }, weight: 10, quantity: 1, orientations: [0], material: "plastic", maxLoadKg: 100, color: "#6bcab7" },
      { id: "MID", name: "\uC911\uAC04 \uBC1B\uCE68", size: { w: 400, d: 400, h: 150 }, weight: 5, quantity: 1, orientations: [0], material: "plastic", maxLoadKg: 60, color: "#e8b86a" }
    ];
  }
  s.constraints.standingHeight = { ...DEFAULT_STANDING_HEIGHT };
  return s;
}
var SCENARIOS = ["online-task", "buffer-demo", "spatial-mixed", "compact-mixed", "high-stack", "field", "reference", "mixed", "identical", "materials", "large-late", "heavy-late", "restricted", "gripper", "events", "impossible"].map((id) => ({ id, name: id === "field" ? `\uC5F0\uAD6C\uC6A9 \xB7 \uC804\uCCB4 \uC7AC\uACE0 \uC120\uD0DD \xB7 ${scenario(id).name}` : id === "online-task" || id === "reference" || id === "high-stack" ? scenario(id).name : `\uAC80\uC99D\uC6A9 \xB7 ${scenario(id).name}` }));

// src/engine/vendor/pallet/surface.ts
var NX = 12;
var NY = 10;
function surface(placed, pallet) {
  const heights = [], owners = [];
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const px = (x + 0.5) * pallet.width / NX, py = (y + 0.5) * pallet.depth / NY;
    let height = 0, owner = null;
    for (const b of placed) if (px >= b.position.x && px < b.position.x + b.size.w && py >= b.position.y && py < b.position.y + b.size.d && top(b) > height) {
      height = top(b);
      owner = b;
    }
    heights.push(height);
    owners.push(owner);
  }
  return { heights, owners };
}
function placeOnSurface(base, b, pallet) {
  const heights = [...base.heights], owners = [...base.owners], height = top(b);
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = y * NX + x, px = (x + 0.5) * pallet.width / NX, py = (y + 0.5) * pallet.depth / NY;
    if (px >= b.position.x && px < b.position.x + b.size.w && py >= b.position.y && py < b.position.y + b.size.d && height > heights[i]) {
      heights[i] = height;
      owners[i] = b;
    }
  }
  return { heights, owners };
}

// src/engine/vendor/pallet/interior.ts
var cache = /* @__PURE__ */ new WeakMap();
function calculate(boxes) {
  const levels = [...new Set(boxes.flatMap((b) => [b.position.z, b.position.z + b.size.h]))].sort((a, b) => a - b);
  let envelope = 0;
  for (let i = 1; i < levels.length; i++) {
    const lo = levels[i - 1], hi = levels[i], active = boxes.filter((b) => b.position.z < hi && b.position.z + b.size.h > lo);
    if (!active.length) continue;
    const x0 = Math.min(...active.map((b) => b.position.x)), x1 = Math.max(...active.map((b) => b.position.x + b.size.w)), y0 = Math.min(...active.map((b) => b.position.y)), y1 = Math.max(...active.map((b) => b.position.y + b.size.d));
    envelope += (x1 - x0) * (y1 - y0) * (hi - lo);
  }
  const occupied = boxes.reduce((n2, b) => n2 + volume(b.size), 0);
  return { envelope, voidVolume: Math.max(0, envelope - occupied), fill: envelope ? occupied / envelope : 0 };
}
function interiorSpace(boxes) {
  let value = cache.get(boxes);
  if (!value) {
    value = calculate(boxes);
    cache.set(boxes, value);
  }
  return value;
}
var interiorAfter = (boxes, b) => calculate([...boxes, b]);
function localSpan(b, placed) {
  const active = placed.filter((p) => p.position.z <= b.position.z && top(p) > b.position.z), xs = [b.position.x, ...active.map((p) => p.position.x)], ys = [b.position.y, ...active.map((p) => p.position.y)];
  const w = Math.max(b.position.x + b.size.w, ...active.map((p) => p.position.x + p.size.w)) - Math.min(...xs), d = Math.max(b.position.y + b.size.d, ...active.map((p) => p.position.y + p.size.d)) - Math.min(...ys);
  return w * d - b.size.w * b.size.d - active.reduce((n2, p) => n2 + p.size.w * p.size.d, 0);
}

// src/engine/vendor/pallet/compactPacking.ts
function edgeContact(b, placed, p, boundary = true) {
  const a = b.position, s = b.size;
  let length = 0;
  if (boundary && (Math.abs(a.x) < EPS || Math.abs(a.x + s.w - p.width) < EPS)) length += s.d;
  if (boundary && (Math.abs(a.y) < EPS || Math.abs(a.y + s.d - p.depth) < EPS)) length += s.w;
  for (const o of placed) {
    if (top(o) <= a.z + EPS || o.position.z >= a.z + s.h - EPS) continue;
    if (Math.abs(a.x + s.w - o.position.x) < EPS || Math.abs(o.position.x + o.size.w - a.x) < EPS) length += Math.max(0, Math.min(a.y + s.d, o.position.y + o.size.d) - Math.max(a.y, o.position.y));
    if (Math.abs(a.y + s.d - o.position.y) < EPS || Math.abs(o.position.y + o.size.d - a.y) < EPS) length += Math.max(0, Math.min(a.x + s.w, o.position.x + o.size.w) - Math.max(a.x, o.position.x));
  }
  return Math.min(1, length / (2 * (s.w + s.d)));
}
function trappedBelow(b, placed) {
  let occupied = 0;
  for (const o of placed) {
    const r = overlapRect({ x: b.position.x, y: b.position.y, w: b.size.w, d: b.size.d }, footprint(o));
    if (r) occupied += r.w * r.d * Math.max(0, Math.min(b.position.z, top(o)) - o.position.z);
  }
  return Math.max(0, b.size.w * b.size.d * b.position.z - occupied);
}
function compactScore(c, input) {
  const b = c.placement, area = input.pallet.width * input.pallet.depth, capacity = area * input.pallet.maxHeight;
  let compact = 100 * b.size.w * b.size.d / area + 60 * volume(b.size) / capacity + 32 * edgeContact(b, input.placements, input.pallet, !input.settings.interiorPacking) - 100 * trappedBelow(b, input.placements) / capacity - 120 * (1 - b.supportRatio);
  if (input.settings.interiorPacking) {
    const before = interiorSpace(input.placements), after = interiorAfter(input.placements, b);
    c.features.interiorVoid = after.voidVolume;
    c.features.packingEnvelope = after.envelope;
    compact -= 250 * (after.voidVolume - before.voidVolume) / capacity;
  }
  c.terms.compact = compact;
  c.terms.lowerBalance = -24 * (c.features.lowerBalance ?? 0);
  c.terms.foundation = 0;
  c.terms.stability *= 0.25;
  c.terms.balance *= 0.25;
  c.fastScore = Object.values(c.terms).reduce((a, b2) => a + b2, 0);
  c.score = c.fastScore;
}

// src/engine/vendor/pallet/frontier.ts
function balancedOrigins(size, placed, weight) {
  const assessments = stability(placed).supports, result = [];
  for (const b of placed) {
    if (size.w > b.size.w || size.d > b.size.d) continue;
    const s = assessments.find((s2) => s2.id === b.id);
    const targets = [{ x: b.position.x + b.size.w / 2, y: b.position.y + b.size.d / 2 }, { x: (s.supportCenter.x * (s.mass + weight) - s.center.x * s.mass) / weight, y: (s.supportCenter.y * (s.mass + weight) - s.center.y * s.mass) / weight }];
    for (const target of targets) {
      const x = Math.max(b.position.x, Math.min(b.position.x + b.size.w - size.w, target.x - size.w / 2)), y = Math.max(b.position.y, Math.min(b.position.y + b.size.d - size.d, target.y - size.d / 2));
      result.push({ x, y, z: landingHeight(x, y, size, placed) });
    }
  }
  return result;
}
function frontierOrigins(p, size, placed, gap) {
  const result = sparseOrigins(p, size, placed, gap), keys = new Set(result.map((v) => `${v.x.toFixed(4)}:${v.y.toFixed(4)}`));
  const xs = /* @__PURE__ */ new Set([0, p.width - size.w]), ys = /* @__PURE__ */ new Set([0, p.depth - size.d]);
  for (const b of placed) {
    for (const x of [b.position.x, b.position.x + b.size.w + gap, b.position.x - size.w - gap, b.position.x + b.size.w - size.w]) if (x >= -EPS && x + size.w <= p.width + EPS) xs.add(x);
    for (const y of [b.position.y, b.position.y + b.size.d + gap, b.position.y - size.d - gap, b.position.y + b.size.d - size.d]) if (y >= -EPS && y + size.d <= p.depth + EPS) ys.add(y);
  }
  for (const x of xs) for (const y of ys) {
    const key = `${x.toFixed(4)}:${y.toFixed(4)}`;
    if (!keys.has(key)) {
      keys.add(key);
      result.push({ x, y, z: landingHeight(x, y, size, placed) });
    }
  }
  return result;
}
var order = (a, b) => a.position.z - b.position.z || Number(!!b.balanceTarget) - Number(!!a.balanceTarget) || a.position.y - b.position.y || a.position.x - b.position.x || orientationRank(a.orientation) - orientationRank(b.orientation);
function geometricFeasible(r, placed, p, c) {
  const { position: v, size: s } = r;
  if (v.x < -EPS || v.y < -EPS || v.x + s.w > p.width + EPS || v.y + s.d > p.depth + EPS || v.z + s.h > p.maxHeight + EPS) return false;
  if (placed.some((b2) => intersects(r, b2, c.horizontalGap))) return false;
  if (!standingHeight(r, placed, c).valid) return false;
  if (v.z === 0) return true;
  const b = { ...r, id: "probe", typeId: "", weight: 1, supports: [], supportRatio: 0, loadAbove: 0 }, contacts = contactsFor(b, placed, c.contactTolerance);
  return contacts.reduce((n2, s2) => n2 + s2.area, 0) / (s.w * s.d) + EPS >= c.supportRatio && centerSupported(b, contacts);
}
function diverseBudget(raw, placed, p, c, limit, compact = false, interior = false) {
  const rank2 = compact ? (a, b) => a.position.z - b.position.z || (interior ? localSpan(a, placed) - localSpan(b, placed) : 0) || edgeContact(b, placed, p, !interior) - edgeContact(a, placed, p, !interior) || order(a, b) : order;
  const feasible = raw.filter((r) => geometricFeasible(r, placed, p, c)).sort(rank2), groups = /* @__PURE__ */ new Map();
  for (const r of feasible) {
    const q = Number(r.position.x + r.size.w / 2 >= p.width / 2) + 2 * Number(r.position.y + r.size.d / 2 >= p.depth / 2), key = `${r.position.z}:${r.orientation}:${q}`;
    groups.set(key, [...groups.get(key) || [], r]);
  }
  const chosen = [], lists = [...groups.values()];
  for (let i = 0; chosen.length < limit; i++) {
    let any = false;
    for (const list of lists) if (list[i] && chosen.length < limit) {
      chosen.push(list[i]);
      any = true;
    }
    if (!any) break;
  }
  const onPallet = (r) => r.position.x >= -EPS && r.position.y >= -EPS && r.position.x + r.size.w <= p.width + EPS && r.position.y + r.size.d <= p.depth + EPS;
  const rejectedOrder = (a, b) => Number(onPallet(b)) - Number(onPallet(a)) || order(a, b);
  const selected2 = new Set(chosen);
  for (const r of [...raw].sort(rejectedOrder)) if (chosen.length < limit && !selected2.has(r) && !geometricFeasible(r, placed, p, c)) {
    chosen.push(r);
    selected2.add(r);
  }
  return chosen.sort(order);
}

// src/engine/vendor/pallet/materials.ts
var MATERIALS = {
  paper: { name: "\uC885\uC774 / \uACE8\uD310\uC9C0", referenceLoadKg: 20, friction: 0.45 },
  plastic: { name: "\uD50C\uB77C\uC2A4\uD2F1", referenceLoadKg: 80, friction: 0.35 },
  wood: { name: "\uBAA9\uC7AC", referenceLoadKg: 150, friction: 0.5 },
  unknown: { name: "\uBBF8\uC9C0\uC815", referenceLoadKg: null, friction: 0.6 }
};
function materialInfo(box, settings = DEFAULT_STABILITY) {
  if (box.packaging) return { name: box.packaging.packageType, reference: box.packaging.maxTopLoad, capacity: box.packaging.stackable ? box.packaging.maxTopLoad : 0, source: "BoxSpec \uC785\uB825 \uD5C8\uC6A9\uD558\uC911", friction: box.friction ?? 0.45 };
  const profile = MATERIALS[box.material || "unknown"];
  const axis = verticalAxis(box.orientation ?? 0), directional = box.maxLoadByAxis?.[axis], reference = directional ?? box.maxLoadKg ?? profile.referenceLoadKg;
  return { name: profile.name, reference, capacity: reference === null ? null : reference * (box.strengthFactor ?? 1) / settings.loadSafetyFactor, source: directional !== void 0 ? "\uBC29\uD5A5\uBCC4 \uC785\uB825\uAC12" : box.maxLoadKg !== void 0 ? box.maxLoadSource === "synthetic" ? "\uC0DD\uC131 \uC608\uC81C\uAC12" : "\uC785\uB825\uAC12" : reference === null ? "\uBBF8\uAC80\uC99D" : "\uC608\uC81C\uAC12", friction: box.friction ?? profile.friction };
}

// src/engine/vendor/pallet/inventory.ts
var emptyInventory = () => ({ opportunity: 0, fitFraction: 0, foundationPenalty: 0, strongerRemaining: 0, types: [] });
var anchors = (limit) => [.../* @__PURE__ */ new Set([...Array.from({ length: Math.floor(limit / 2) + 1 }, (_, i) => i * 2), limit])];
function assessInventory(input, placed, map, current) {
  if (input.settings.inventoryMode === "none") return emptyInventory();
  const cfg = input.constraints.stability || DEFAULT_STABILITY, loads = calculateLoads(placed), properties = new Map(placed.map((b) => [b.id, materialInfo(b, cfg)])), byId = new Map(placed.map((b) => [b.id, b]));
  let totalDemand = 0, possibleDemand = 0, opportunity = 0, strongerRemaining = 0, strongerDemand = 0, strongerArea = 0, largestStrongArea = 0;
  const currentStrength = materialInfo(current, cfg).capacity ?? 0, types = [];
  for (const type of input.types) {
    const quantity = input.remaining[type.id] || 0;
    if (!quantity) continue;
    let fitSites = 0, sampleSites = 0;
    if (input.settings.inventoryMode === "geometry") {
      for (const rotation of allowedOrientations(type.size, type.orientations, type.handling, type.maxLoadByAxis)) {
        const size = oriented(type.size, rotation), origins = sparseOrigins(input.pallet, size, placed, input.constraints.horizontalGap).filter((v) => v.x >= 0 && v.y >= 0 && v.x + size.w <= input.pallet.width && v.y + size.d <= input.pallet.depth), groups = /* @__PURE__ */ new Map();
        for (const v of origins) groups.set(v.z, [...groups.get(v.z) || [], v]);
        const probes = [], lists = [...groups.values()];
        for (let n2 = 0; probes.length < 32; n2++) {
          let found = false;
          for (const list of lists) if (list[n2] && probes.length < 32) {
            probes.push(list[n2]);
            found = true;
          }
          if (!found) break;
        }
        for (const position of probes) {
          sampleSites++;
          const r = { position, size, orientation: rotation };
          if (!geometricFeasible(r, placed, input.pallet, input.constraints)) continue;
          const future = { ...type, id: `inventory-${type.id}`, typeId: type.id, position, size, orientation: rotation, supports: [], supportRatio: 1, loadAbove: 0 }, contacts = contactsFor(future, placed, input.constraints.contactTolerance);
          if (contacts.some((c) => {
            const owner = byId.get(c.id), capacity = properties.get(c.id).capacity, share = c.area / (size.w * size.d);
            return owner.handling === "no-top-load" || capacity !== null && loads[c.id] + type.weight * share > capacity || input.constraints.heavyRule === "each" && type.weight > owner.weight || input.constraints.heavyRule === "share" && type.weight * share > owner.weight;
          })) continue;
          fitSites++;
        }
      }
    } else {
      for (const rotation of allowedOrientations(type.size, type.orientations, type.handling, type.maxLoadByAxis)) {
        const size = oriented(type.size, rotation), w = Math.ceil(size.w / (input.pallet.width / NX)), d = Math.ceil(size.d / (input.pallet.depth / NY));
        if (w > NX || d > NY) continue;
        for (const y of anchors(NY - d)) for (const x of anchors(NX - w)) {
          sampleSites++;
          const first = map.heights[y * NX + x], contact2 = /* @__PURE__ */ new Map();
          let supported = true;
          if (first + size.h > input.pallet.maxHeight) continue;
          for (let yy = y; yy < y + d && supported; yy++) for (let xx = x; xx < x + w; xx++) {
            const i = yy * NX + xx;
            if (Math.abs(map.heights[i] - first) > input.constraints.contactTolerance) {
              supported = false;
              break;
            }
            const owner = map.owners[i];
            if (owner) contact2.set(owner.id, (contact2.get(owner.id) || 0) + 1);
          }
          if (!supported) continue;
          for (const [id, cells] of contact2) {
            const owner = byId.get(id), capacity = properties.get(id).capacity, share = cells / (w * d);
            if (owner.handling === "no-top-load" || capacity !== null && loads[id] + type.weight * share > capacity || input.constraints.heavyRule === "each" && type.weight > owner.weight || input.constraints.heavyRule === "share" && type.weight * share > owner.weight) {
              supported = false;
              break;
            }
          }
          if (supported) fitSites++;
        }
      }
    }
    const demand = quantity * volume(type.size);
    totalDemand += demand;
    possibleDemand += fitSites ? demand : 0;
    opportunity += demand * (sampleSites ? fitSites / sampleSites : 0);
    types.push({ id: type.id, quantity, fitSites, sampleSites });
    const strength = materialInfo(type, cfg).capacity ?? 0;
    if (strength > currentStrength * 1.1) {
      strongerRemaining += quantity;
      strongerDemand += demand;
      strongerArea += quantity * type.size.w * type.size.d;
      largestStrongArea = Math.max(largestStrongArea, type.size.w * type.size.d);
    }
  }
  const freeFloorArea = map.heights.filter((h) => h === 0).length * input.pallet.width * input.pallet.depth / (NX * NY);
  const reserved = current.position.z === 0 && strongerRemaining && totalDemand ? strongerDemand / totalDemand * Math.min(1, current.size.w * current.size.d / Math.max(1, largestStrongArea)) * Math.min(2, strongerArea / Math.max(1, freeFloorArea)) : 0;
  const exposedStrongArea = map.owners.filter((b) => {
    if (!b || b.handling === "no-top-load") return false;
    const capacity = properties.get(b.id).capacity;
    return capacity !== null && capacity > currentStrength * 1.1 && capacity - loads[b.id] >= current.weight;
  }).length * input.pallet.width * input.pallet.depth / (NX * NY);
  const reuse = current.position.z === 0 ? 0.5 * Math.min(1, exposedStrongArea / (current.size.w * current.size.d)) : 0;
  const foundationPenalty = reserved + reuse;
  return { opportunity: totalDemand ? opportunity / totalDemand : 1, fitFraction: totalDemand ? possibleDemand / totalDemand : 1, foundationPenalty, strongerRemaining, types };
}

// src/engine/vendor/pallet/packing.ts
var fits = (type, w, d, h) => allowedOrientations(type.size, type.orientations, type.handling, type.maxLoadByAxis).some((r) => {
  const v = oriented(type.size, r);
  return v.w <= w + EPS && v.d <= d + EPS && v.h <= h + EPS;
});
function packingQuality(b, input) {
  const p = b.position, s = b.size, t = top(b);
  let area = 0;
  for (const other of input.placements) {
    const o = other.position, height = Math.max(0, Math.min(t, top(other)) - Math.max(p.z, o.z));
    if (!height) continue;
    if (Math.abs(p.x + s.w - o.x) <= EPS || Math.abs(o.x + other.size.w - p.x) <= EPS) area += height * Math.max(0, Math.min(p.y + s.d, o.y + other.size.d) - Math.max(p.y, o.y));
    if (Math.abs(p.y + s.d - o.y) <= EPS || Math.abs(o.y + other.size.d - p.y) <= EPS) area += height * Math.max(0, Math.min(p.x + s.w, o.x + other.size.w) - Math.max(p.x, o.x));
  }
  const demand = input.types.reduce((n2, t2) => n2 + (input.remaining[t2.id] || 0) * volume(t2.size), 0);
  const loads = calculateLoads(input.placements);
  let lostDemand = 0;
  for (const type of input.types) {
    const q = input.remaining[type.id] || 0;
    if (!q || type.size.w * type.size.d <= s.w * s.d * 1.1) continue;
    const destroyed = b.supports.some((contact2) => {
      const base = input.placements.find((p2) => p2.id === contact2.id);
      const capacity = materialInfo(base, input.constraints.stability).capacity, headroom = input.pallet.maxHeight - top(base);
      if (!fits(type, base.size.w, base.size.d, headroom) || capacity !== null && loads[base.id] + type.weight > capacity) return false;
      const cut = overlapRect(footprint(base), footprint(b));
      if (!cut) return false;
      const x = base.position.x, y = base.position.y, w = base.size.w, d = base.size.d;
      return ![[cut.x - x, d], [x + w - cut.x - cut.w, d], [w, cut.y - y], [w, y + d - cut.y - cut.d]].some(([w2, d2]) => fits(type, w2, d2, headroom));
    });
    if (destroyed) lostDemand += q * volume(type.size);
  }
  return { contactRatio: Math.min(1, area / (2 * s.h * (s.w + s.d))), futureSurfacePenalty: demand ? lostDemand / demand : 0 };
}

// src/engine/vendor/pallet/features.ts
function balance(placed, p) {
  const weight = placed.reduce((s, b) => s + b.weight, 0), center = { x: 0, y: 0, z: 0 };
  for (const b of placed) {
    center.x += massCenter(b).x * b.weight;
    center.y += massCenter(b).y * b.weight;
    center.z += massCenter(b).z * b.weight;
  }
  if (weight) for (const k of ["x", "y", "z"]) center[k] /= weight;
  const roots = {};
  const route = (b, load) => {
    if (!b.supports.length) {
      roots[b.id] = (roots[b.id] || 0) + load;
      return;
    }
    for (const s of b.supports) {
      const parent = placed.find((v) => v.id === s.id);
      if (parent) route(parent, load * s.share);
    }
  };
  placed.forEach((b) => route(b, b.weight));
  const quadrants = [0, 0, 0, 0];
  for (const [id, load] of Object.entries(roots)) {
    const b = placed.find((v) => v.id === id);
    for (let i = 0; i < 4; i++) {
      const r = { x: i % 2 * p.width / 2, y: Math.floor(i / 2) * p.depth / 2, w: p.width / 2, d: p.depth / 2 };
      const a = overlapRect(footprint(b), r);
      if (a) quadrants[i] += load * a.w * a.d / (b.size.w * b.size.d);
    }
  }
  return { center, quadrants, imbalance: weight ? (Math.max(...quadrants) - Math.min(...quadrants)) / weight : 0 };
}
function loadSummary(placed, cfg = DEFAULT_STABILITY) {
  const loads = calculateLoads(placed);
  let loadUtilization = 0, unknownCapacity = 0;
  for (const b of placed) {
    const capacity = materialInfo(b, cfg).capacity;
    if (capacity === null) unknownCapacity++;
    else loadUtilization = Math.max(loadUtilization, capacity ? loads[b.id] / capacity : loads[b.id] > 0 ? 10 : 0);
  }
  return { loadUtilization, unknownCapacity };
}
function features(placed, p, workSeconds, input, base) {
  const map = base ? placeOnSurface(base, placed.at(-1), p) : surface(placed, p), heights = map.heights;
  let diff = 0, edges = 0, flat = 0;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = y * NX + x;
    for (const j of [x < NX - 1 ? i + 1 : -1, y < NY - 1 ? i + NX : -1]) if (j >= 0) {
      diff += Math.abs(heights[i] - heights[j]);
      edges++;
      if (Math.abs(heights[i] - heights[j]) < 0.5) flat++;
    }
  }
  const meanHeight = heights.reduce((a, b) => a + b, 0) / heights.length, total2 = placed.reduce((a, b) => a + volume(b.size), 0), cfg = input?.constraints.stability || DEFAULT_STABILITY, stable = stability(placed, cfg);
  return { ...input ? packingQuality(placed.at(-1), input) : {}, maxHeight: Math.max(0, ...placed.map(top)), meanHeight, roughness: diff / edges, blockedVolume: Math.max(0, meanHeight * p.width * p.depth - total2), flatRatio: flat / edges, imbalance: balance(placed, p).imbalance, workSeconds, slenderness: stable.slenderness, lowerBalance: stable.lowerBalance, loadUtilization: loadSummary(placed, cfg).loadUtilization, inventory: input ? assessInventory(input, placed, map, placed.at(-1)) : emptyInventory() };
}
function terms(f, p, w, cfg = DEFAULT_STABILITY) {
  return { maximum: -w.maximum * f.maxHeight / p.maxHeight, mean: -w.mean * f.meanHeight / p.maxHeight, roughness: -w.roughness * f.roughness / p.maxHeight, void: -w.void * f.blockedVolume / (p.width * p.depth * p.maxHeight), flat: w.flat * f.flatRatio, balance: -w.balance * f.imbalance, time: -w.time * f.workSeconds / 30, stability: -w.stability * f.slenderness / cfg.maxSlenderness, inventory: w.inventory * f.inventory.opportunity, foundation: -w.foundation * f.inventory.foundationPenalty, load: -w.load * f.loadUtilization, contact: (w.contact ?? 0) * (f.contactRatio ?? 0), futureSurface: -(w.futureSurface ?? 0) * (f.futureSurfacePenalty ?? 0) };
}

// src/engine/vendor/pallet/packaging/robot.ts
function reachability(target, robot) {
  const distance2 = Math.hypot(target.x - robot.base.x, target.y - robot.base.y, target.z - robot.base.z);
  return { distance: distance2, valid: distance2 >= robot.minReach - 1e-6 && distance2 <= robot.maxReach + 1e-6 };
}
var normals = { TOP: { x: 0, y: 0, z: 1 }, FRONT: { x: 0, y: -1, z: 0 }, BACK: { x: 0, y: 1, z: 0 }, LEFT: { x: -1, y: 0, z: 0 }, RIGHT: { x: 1, y: 0, z: 0 } };
var add = (a, b, n2) => ({ x: a.x + b.x * n2, y: a.y + b.y * n2, z: a.z + b.z * n2 });
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function swept(a, b, half) {
  return { position: { x: Math.min(a.x, b.x) - half.x, y: Math.min(a.y, b.y) - half.y, z: Math.min(a.z, b.z) - half.z }, size: { w: Math.abs(a.x - b.x) + 2 * half.x, d: Math.abs(a.y - b.y) + 2 * half.y, h: Math.abs(a.z - b.z) + 2 * half.z } };
}
function packagingRobot(box, current, placed, c) {
  const spec = current.packaging, model = c.packagingRobot ?? { base: { x: c.reach?.baseX ?? -700, y: c.reach?.baseY ?? 500, z: 650 }, minReach: c.reach?.minRadius ?? 0, maxReach: c.reach?.maxRadius ?? 3500, approach: 180 };
  const center = { x: box.position.x + box.size.w / 2, y: box.position.y + box.size.d / 2, z: box.position.z + box.size.h / 2 }, g = c.gripper;
  const faces = [...spec.graspableFaces].sort((a, b) => Number(b === spec.preferredGraspFace) - Number(a === spec.preferredGraspFace));
  const reasons = [];
  let lastDistance = 0;
  for (const face of faces) {
    const n2 = poseVector(normals[face], box.orientation);
    if (n2.z < -0.5) {
      reasons.push(`ROBOT: ${face} \uBA74\uC774 \uBC14\uB2E5\uC744 \uD5A5\uD568`);
      continue;
    }
    const extent = Math.abs(n2.x) * box.size.w / 2 + Math.abs(n2.y) * box.size.d / 2 + Math.abs(n2.z) * box.size.h / 2;
    const target = add(center, n2, extent + g.height / 2 + g.margin), approach = add(target, n2, model.approach);
    const half = { x: n2.x ? g.height / 2 : g.width / 2, y: n2.y ? g.height / 2 : g.depth / 2, z: n2.z ? g.height / 2 : Math.max(g.width, g.depth) / 2 };
    const approachBody = swept(target, approach, half), blocker = placed.find((b) => intersects(approachBody, b, g.margin));
    if (blocker) {
      reasons.push(`ROBOT: ${face} \uC811\uADFC corridor \uAC04\uC12D \xB7 ${blocker.id}`);
      continue;
    }
    const targetReach = reachability(target, model);
    lastDistance = targetReach.distance;
    if (!targetReach.valid) {
      reasons.push(`ROBOT: TCP 3D \uAC70\uB9AC ${targetReach.distance.toFixed(1)} mm / \uD5C8\uC6A9 ${model.minReach}\u2013${model.maxReach} mm`);
      continue;
    }
    const source2 = current.pickupPosition ?? { x: -900, y: 200, z: 0 }, pickCenter = { x: source2.x + current.size.w / 2, y: source2.y + current.size.d / 2, z: source2.z + current.size.h / 2 }, sn = normals[face], se = Math.abs(sn.x) * current.size.w / 2 + Math.abs(sn.y) * current.size.d / 2 + Math.abs(sn.z) * current.size.h / 2, pick = add(pickCenter, sn, se + g.height / 2 + g.margin);
    const safe = Math.max(top(box), ...placed.map(top), current.size.h) + Math.max(box.size.h, current.size.h) + g.lift + g.height;
    const points = [{ label: "\uC785\uACE0 \uD30C\uC9C0", tcp: pick, carrying: true, hold: g.pickSeconds, pose: 0 }, { label: "\uC0C1\uC2B9", tcp: { ...pick, z: safe }, carrying: true, hold: 0, pose: 0 }, { label: "\uC548\uC804\uBA74 \uC774\uB3D9\xB7\uD68C\uC804", tcp: { ...approach, z: safe }, carrying: true, hold: 0, pose: box.orientation }, { label: "\uC811\uADFC\uBA74 \uC9C4\uC785", tcp: approach, carrying: true, hold: 0, pose: box.orientation }, { label: "\uB0B4\uB824\uB193\uAE30", tcp: target, carrying: true, hold: g.placeSeconds, pose: box.orientation }, { label: "\uBA74 \uC774\uD0C8", tcp: approach, carrying: false, hold: 0, pose: box.orientation }, { label: "\uBCF5\uADC0 \uC0C1\uC2B9", tcp: { ...approach, z: safe }, carrying: false, hold: 0, pose: box.orientation }, { label: "\uC785\uACE0 \uBCF5\uADC0", tcp: { ...pick, z: safe }, carrying: false, hold: 0, pose: 0 }];
    let failure = "";
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1].tcp, b = points[i].tcp, delta = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, length = dist(a, b), t = length ? Math.max(0, Math.min(1, ((model.base.x - a.x) * delta.x + (model.base.y - a.y) * delta.y + (model.base.z - a.z) * delta.z) / (length * length))) : 0;
      if ([a, b, add(a, delta, t)].some((v) => !reachability(v, model).valid)) {
        failure = "ROBOT: \uC6B4\uBC18 \uACBD\uB85C 3D \uB3C4\uB2EC \uBC94\uC704 \uBC16";
        break;
      }
      const tool = swept(a, b, { x: Math.max(g.width, g.height) / 2 + g.margin, y: Math.max(g.depth, g.height) / 2 + g.margin, z: Math.max(g.width, g.height) / 2 + g.margin });
      const from = points[i - 1].pose ?? 0, to = points[i].pose ?? 0, sa = orientedSize(current.size, from), sb = orientedSize(current.size, to);
      const heldCenter = (tcp, pose, size) => {
        const normal = poseVector(normals[face], pose), extent2 = Math.abs(normal.x) * size.w / 2 + Math.abs(normal.y) * size.d / 2 + Math.abs(normal.z) * size.h / 2;
        return add(tcp, normal, -extent2 - g.height / 2 - g.margin);
      };
      const radius = Math.hypot(current.size.w, current.size.d, current.size.h) / 2, half2 = from === to ? { x: sb.w / 2, y: sb.d / 2, z: sb.h / 2 } : { x: radius, y: radius, z: radius };
      const held = swept(heldCenter(a, from, sa), heldCenter(b, to, sb), half2);
      const volumes = [tool, ...points[i].carrying ? [held] : []], w = c.workspace;
      if (volumes.some((v) => v.position.z < -1e-6 || v.position.x < w.xMin || v.position.y < w.yMin || v.position.x + v.size.w > w.xMax || v.position.y + v.size.d > w.yMax || v.position.z + v.size.h > w.zMax)) {
        failure = "ROBOT: \uACF5\uAD6C / \uC6B4\uBC18 \uACBD\uB85C \uC791\uC5C5\uACF5\uAC04 \uBC16";
        break;
      }
      const hit = placed.find((other) => volumes.some((v) => intersects(v, other)));
      if (hit) {
        failure = `ROBOT: ${face} \uC6B4\uBC18 \uACBD\uB85C \uAC04\uC12D \xB7 ${hit.id}`;
        break;
      }
    }
    if (failure) {
      reasons.push(failure);
      continue;
    }
    const lengths = points.slice(1).map((v, i) => dist(points[i].tcp, v.tcp)), slow = spec.shockSensitive ? 1.35 : 1, segmentSeconds = lengths.map((d, i) => d / g.speed * slow + points[i + 1].hold + (i === 0 ? g.pickSeconds : 0) + (i === 1 && box.orientation !== 0 ? 90 / (g.rotationSpeed ?? 90) * slow : 0));
    const path = { graspFace: face, model: "gripper", points, lengthMm: lengths.reduce((a, b) => a + b, 0), seconds: segmentSeconds.reduce((a, b) => a + b, 0), segmentSeconds };
    return { valid: true, reasons: [], face, distance: lastDistance, path };
  }
  return { valid: false, reasons: [...new Set(reasons)], distance: lastDistance, face: null, path: null };
}

// src/engine/vendor/pallet/robotReach.ts
function withinReach(a, b, r) {
  const ax = a.x - r.baseX, ay = a.y - r.baseY, bx = b.x - r.baseX, by = b.y - r.baseY, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  const nearest = Math.hypot(ax + t * dx, ay + t * dy), farthest = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by));
  return nearest + 1e-6 >= r.minRadius && farthest <= r.maxRadius + 1e-6;
}
function yawEnvelope(w, d, from, to) {
  const extent = (a) => w * Math.abs(Math.cos(a)) + d * Math.abs(Math.sin(a));
  const angles = [from, to].map((v) => v * Math.PI / 180), lo = Math.min(...angles), hi = Math.max(...angles);
  const extrema = [Math.atan2(d, w), Math.atan2(w, d)];
  for (const e of extrema) for (let k = -2; k <= 2; k++) {
    const a = e + k * Math.PI / 2;
    if (a >= lo && a <= hi) angles.push(a);
  }
  return { w: Math.max(...angles.map(extent)), d: Math.max(...angles.map((a) => extent(Math.PI / 2 - a))) };
}

// src/engine/vendor/pallet/tiltRobot.ts
var add2 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
var graspOffset = (size, pose) => poseVector({ x: 0, y: 0, z: size.h / 2 }, pose);
function tiltPath(box, current, placed, c, source2) {
  const pickup = { x: source2.x + current.size.w / 2, y: source2.y + current.size.d / 2, z: source2.z + current.size.h }, pose = box.orientation;
  const center = { x: box.position.x + box.size.w / 2, y: box.position.y + box.size.d / 2, z: box.position.z + box.size.h / 2 }, target = add2(center, graspOffset(current.size, pose));
  const radius = Math.max(Math.hypot(current.size.w / 2, current.size.d / 2, current.size.h), Math.hypot(c.gripper.width / 2, c.gripper.depth / 2, c.gripper.height)) + c.gripper.margin;
  const safe = Math.max(top(box), pickup.z, ...placed.map(top)) + radius + c.gripper.lift, away = add2(target, poseVector({ x: 0, y: 0, z: c.gripper.height + c.gripper.margin + 20 }, pose));
  const points = [
    { label: current.pickupPosition ? "\uC784\uC2DC \uB300\uAE30\uB300 \xB7 \uD68C\uC218 \uB300\uAE30" : "\uC785\uACE0 \uC704\uCE58 \xB7 \uB300\uAE30", tcp: { ...pickup, z: safe }, carrying: false, hold: 0, pose: 0 },
    { label: "\uC811\uADFC \xB7 \uC9D1\uAE30", tcp: pickup, carrying: false, hold: c.gripper.pickSeconds, pose: 0 },
    { label: "\uC548\uC804 \uB192\uC774\uB85C \uC774\uB3D9", tcp: { ...pickup, z: safe }, carrying: true, hold: 0, pose: 0 },
    { label: "\uC548\uC804 \uB192\uC774 \xB7 \uBC15\uC2A4 \uC138\uC6B0\uAE30", tcp: { ...pickup, z: safe }, carrying: true, hold: 0, pose },
    { label: "\uBAA9\uD45C \uC704\uB85C \uC774\uB3D9", tcp: { ...target, z: safe }, carrying: true, hold: 0, pose },
    { label: "\uB0B4\uB824\uB193\uAE30", tcp: target, carrying: true, hold: c.gripper.placeSeconds, pose },
    { label: "\uD30C\uC9C0\uBA74 \uBC14\uAE65\uC73C\uB85C \uC774\uD0C8", tcp: away, carrying: false, hold: 0, pose },
    { label: "\uC548\uC804 \uB192\uC774 \uBCF5\uADC0", tcp: { ...away, z: safe }, carrying: false, hold: 0, pose },
    { label: current.pickupPosition ? "\uC784\uC2DC \uB300\uAE30\uB300\uB85C \uBCF5\uADC0" : "\uC785\uACE0 \uC704\uCE58\uB85C \uBCF5\uADC0", tcp: { ...pickup, z: safe }, carrying: false, hold: 0, pose },
    { label: "\uBE48 \uADF8\uB9AC\uD37C \uC790\uC138 \uBCF5\uC6D0", tcp: { ...pickup, z: safe }, carrying: false, hold: 0, pose: 0 }
  ];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.tcp.x - points[i].tcp.x, p.tcp.y - points[i].tcp.y, p.tcp.z - points[i].tcp.z));
  const segmentSeconds = lengths.map((l, i) => Math.max(l / c.gripper.speed, points[i].pose !== points[i + 1].pose ? 180 / (c.gripper.rotationSpeed ?? 180) : 0) + points[i + 1].hold);
  return { model: "gripper", fixedGrasp: true, points, lengthMm: lengths.reduce((a, b) => a + b, 0), segmentSeconds, seconds: segmentSeconds.reduce((a, b) => a + b, 0) };
}
function translateSweep(a, b, size, offset, margin) {
  return { position: { x: Math.min(a.x, b.x) + offset.x - size.w / 2 - margin, y: Math.min(a.y, b.y) + offset.y - size.d / 2 - margin, z: Math.min(a.z, b.z) + offset.z - size.h / 2 - margin }, size: { w: Math.abs(a.x - b.x) + size.w + 2 * margin, d: Math.abs(a.y - b.y) + size.d + 2 * margin, h: Math.abs(a.z - b.z) + size.h + 2 * margin } };
}
function tiltSweeps(a, b, current, c) {
  const from = a.pose ?? 0, to = b.pose ?? 0, grip = { w: c.gripper.width, d: c.gripper.depth, h: c.gripper.height };
  if (from !== to) {
    const radius = Math.max(Math.hypot(grip.w / 2, grip.d / 2, grip.h), b.carrying ? Math.hypot(current.size.w / 2, current.size.d / 2, current.size.h) : 0) + c.gripper.margin;
    return [translateSweep(a.tcp, b.tcp, { w: 2 * radius, d: 2 * radius, h: 2 * radius }, { x: 0, y: 0, z: 0 }, 0)];
  }
  const bounds = [translateSweep(a.tcp, b.tcp, orientedSize(grip, to), poseVector({ x: 0, y: 0, z: grip.h / 2 }, to), c.gripper.margin)];
  if (b.carrying) bounds.push(translateSweep(a.tcp, b.tcp, orientedSize(current.size, to), poseVector({ x: 0, y: 0, z: -current.size.h / 2 }, to), 0));
  return bounds;
}

// src/engine/vendor/pallet/constraints.ts
var incomingPosition = () => ({ x: -900, y: 200, z: 0 });
var distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function idealPath(box, current, placed) {
  const source2 = current.pickupPosition ?? incomingPosition(), safe = Math.max(top(box), current.size.h, ...placed.map(top)) + current.size.h + 200;
  const start2 = { x: source2.x + current.size.w / 2, y: source2.y + current.size.d / 2, z: safe };
  const target = { x: box.position.x + box.size.w / 2, y: box.position.y + box.size.d / 2, z: top(box) };
  return { model: "ideal", points: [{ label: "\uC774\uC0C1\uC801 \uBC30\uCE58 \xB7 \uC2DC\uAC01 \uC7AC\uC0DD", tcp: start2, carrying: true, hold: 0, pose: 0 }, { label: "\uC790\uC138 \uC120\uD0DD \xB7 \uBAA9\uD45C \uC704", tcp: { ...target, z: safe }, carrying: true, hold: 0, pose: box.orientation }, { label: "\uBC30\uCE58 \uD655\uC815", tcp: target, carrying: true, hold: 0, pose: box.orientation }], lengthMm: 0, seconds: 1, segmentSeconds: [0.5, 0.5] };
}
function gripperPath(box, current, placed, c) {
  if (isStanding(box.orientation)) return tiltPath(box, current, placed, c, current.pickupPosition ?? incomingPosition());
  const incoming = current.pickupPosition ?? incomingPosition(), pickup = { x: incoming.x + current.size.w / 2, y: incoming.y + current.size.d / 2, z: incoming.z + current.size.h };
  const target = { x: box.position.x + box.size.w / 2, y: box.position.y + box.size.d / 2, z: top(box) };
  const safe = Math.max(target.z, ...placed.map(top), pickup.z) + Math.max(current.size.h, box.size.h) + c.gripper.lift;
  const yaw = orientationYaw(box.orientation);
  const points = [
    { label: current.pickupPosition ? "\uC784\uC2DC \uB300\uAE30\uB300 \xB7 \uD68C\uC218 \uB300\uAE30" : "\uC785\uACE0 \uC704\uCE58 \xB7 \uB300\uAE30", tcp: { ...pickup, z: safe }, carrying: false, hold: 0, yaw: 0 },
    { label: "\uC811\uADFC \xB7 \uC9D1\uAE30", tcp: pickup, carrying: false, hold: c.gripper.pickSeconds, yaw: 0 },
    { label: "\uC548\uC804 \uB192\uC774\uB85C \uC774\uB3D9", tcp: { ...pickup, z: safe }, carrying: true, hold: 0, yaw: 0 },
    ...yaw ? [{ label: "\uC548\uC804 \uB192\uC774 \xB7 \uD30C\uC9C0 \uBC29\uD5A5 \uD68C\uC804", tcp: { ...pickup, z: safe }, carrying: true, hold: 0, yaw }] : [],
    { label: "\uBAA9\uD45C \uC704\uB85C \uC774\uB3D9", tcp: { ...target, z: safe }, carrying: true, hold: 0, yaw },
    { label: "\uB0B4\uB824\uB193\uAE30", tcp: target, carrying: true, hold: c.gripper.placeSeconds, yaw },
    { label: "\uADF8\uB9AC\uD37C \uC774\uD0C8", tcp: { ...target, z: safe }, carrying: false, hold: 0, yaw },
    { label: current.pickupPosition ? "\uC784\uC2DC \uB300\uAE30\uB300\uB85C \uBCF5\uADC0" : "\uC785\uACE0 \uC704\uCE58\uB85C \uBCF5\uADC0", tcp: { ...pickup, z: safe }, carrying: false, hold: 0, yaw },
    ...yaw ? [{ label: "\uBE48 \uADF8\uB9AC\uD37C \uBC29\uD5A5 \uBCF5\uC6D0", tcp: { ...pickup, z: safe }, carrying: false, hold: 0, yaw: 0 }] : []
  ];
  const lengths = points.slice(1).map((p, i) => distance(points[i].tcp, p.tcp));
  const segmentSeconds = lengths.map((l, i) => Math.max(l / c.gripper.speed, Math.abs((points[i + 1].yaw || 0) - (points[i].yaw || 0)) / (c.gripper.rotationSpeed ?? 180)) + points[i + 1].hold);
  return { model: "gripper", points, lengthMm: lengths.reduce((a, b) => a + b, 0), seconds: segmentSeconds.reduce((a, b) => a + b, 0), segmentSeconds };
}
function swept2(a, b, w, d, zBelow, zAbove, margin) {
  return { position: { x: Math.min(a.x, b.x) - w / 2 - margin, y: Math.min(a.y, b.y) - d / 2 - margin, z: Math.min(a.z, b.z) - zBelow }, size: { w: Math.abs(a.x - b.x) + w + 2 * margin, d: Math.abs(a.y - b.y) + d + 2 * margin, h: Math.abs(a.z - b.z) + zBelow + zAbove } };
}
function inspectConstraints(box, current, placed, pallet, c, robot) {
  box = { ...box, packaging: current.packaging };
  const reasons = [], p = box.position, s = box.size;
  if (p.z < 0) reasons.push("\uD314\uB808\uD2B8 \uBC14\uB2E5 \uC544\uB798");
  if (current.packaging && !permittedOrientations(current.packaging).includes(box.orientation)) reasons.push("Orientation prohibited \xB7 BoxSpec / keepUpright");
  const observed = oriented(current.size, box.orientation);
  if (["w", "d", "h"].some((k) => Math.abs(s[k] - observed[k]) > EPS)) reasons.push("\uAD00\uCE21 \uCE58\uC218\uC640 \uBC30\uCE58 \uCE58\uC218 \uBD88\uC77C\uCE58");
  if (Math.abs(box.weight - current.weight) > EPS) reasons.push("\uAD00\uCE21 \uBB34\uAC8C\uC640 \uBC30\uCE58 \uBB34\uAC8C \uBD88\uC77C\uCE58");
  if (p.x < -EPS || p.y < -EPS || p.x + s.w > pallet.width + EPS || p.y + s.d > pallet.depth + EPS) reasons.push("\uD314\uB808\uD2B8 \uACBD\uACC4 \uBC16");
  if (p.z + s.h > pallet.maxHeight + EPS) reasons.push("\uCD5C\uB300 \uC801\uC7AC \uB192\uC774 \uCD08\uACFC");
  if (!current.orientationAllowed.includes(box.orientation)) reasons.push("\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uD68C\uC804");
  if (current.handling === "upright" && isStanding(box.orientation)) reasons.push("\uCDE8\uAE09 \uC81C\uD55C \xB7 \uC704\uC544\uB798 \uBC29\uD5A5 \uC720\uC9C0");
  const collided = placed.find((b) => intersects(box, b, c.horizontalGap));
  if (collided) reasons.push(`\uBC15\uC2A4 ${collided.id}\uC640 \uACB9\uCE68 / \uC791\uC5C5 \uC5EC\uC720 \uBBF8\uB2EC`);
  const skyline = standingHeight(box, placed, c);
  if (!skyline.valid) reasons.push(skyline.reason);
  const supports = contactsFor(box, placed, c.contactTolerance), supportArea = supports.reduce((a, b) => a + b.area, 0), supportRatio = p.z === 0 ? 1 : supportArea / (s.w * s.d);
  if (current.packaging) {
    if (supportRatio + EPS < current.packaging.minSupportRatio || !centerSupported(box, supports)) reasons.push(`SUPPORT: \uC9C0\uC9C0 \uC870\uAC74 \uBBF8\uB2EC ${(supportRatio * 100).toFixed(1)}% / \uD544\uC694 ${(current.packaging.minSupportRatio * 100).toFixed(1)}% \xB7 CoG \uC9C0\uC9C0 \uAC80\uC0AC`);
    if (reasons.length) {
      const failed = { ...box, supports, supportRatio };
      return { placement: failed, reasons: [...new Set(reasons)], path: idealPath(failed, current, placed), stack: [...placed, failed] };
    }
  }
  let updated = { ...box, supports, supportRatio };
  const solved = equilibrium([...placed, updated]);
  updated = solved.placements.at(-1);
  const stack = solved.placements;
  reasons.push(...solved.violations);
  if (supportRatio + EPS < (current.packaging?.minSupportRatio ?? c.supportRatio) || !centerSupported(updated, supports)) reasons.push(`SUPPORT: \uC9C0\uC9C0 \uC870\uAC74 \uBBF8\uB2EC ${(supportRatio * 100).toFixed(1)}% / \uD544\uC694 ${((current.packaging?.minSupportRatio ?? c.supportRatio) * 100).toFixed(1)}% \xB7 CoG \uC9C0\uC9C0 \uAC80\uC0AC`);
  for (const child of stack) for (const support of child.supports) {
    const lower = stack.find((b) => b.id === support.id);
    if (lower.handling === "no-top-load" || lower.packaging?.stackable === false) reasons.push(`\uCDE8\uAE09 \uC81C\uD55C \xB7 ${lower.id} \uC704 \uC801\uC7AC \uAE08\uC9C0`);
    const transmitted = c.heavyRule === "share" ? child.weight * support.share : child.weight;
    if (!current.packaging && c.heavyRule !== "off" && transmitted > lower.weight + EPS) {
      reasons.push(`\uBB34\uAC8C \uADDC\uCE59 \uC704\uBC18 \xB7 ${lower.id} (${lower.weight} kg)`);
      break;
    }
  }
  const layers = /* @__PURE__ */ new Map();
  for (const b of [...stack].sort((a, b2) => b2.position.z - a.position.z)) {
    const count = layers.get(b.id) ?? 1;
    if (b.packaging?.maxStackLayers && count > b.packaging.maxStackLayers) reasons.push(`LOAD: ${b.id} \uC801\uCE35 ${count} / \uCD5C\uB300 ${b.packaging.maxStackLayers}`);
    for (const support of b.supports) layers.set(support.id, Math.max(layers.get(support.id) ?? 1, count + 1));
  }
  const loads = calculateLoads(stack);
  stack.forEach((b) => b.loadAbove = loads[b.id]);
  const cfg = c.stability || DEFAULT_STABILITY;
  const overloaded = stack.find((b) => {
    const capacity = materialInfo(b, cfg).capacity;
    return capacity !== null && loads[b.id] > capacity + EPS;
  });
  if (overloaded) {
    const material = materialInfo(overloaded, cfg);
    reasons.push(`\uC7AC\uC9C8 \uD5C8\uC6A9 \uC9C0\uC9C0\uD558\uC911 \uCD08\uACFC \xB7 ${overloaded.id} (${loads[overloaded.id].toFixed(2)} / ${material.capacity.toFixed(2)} kg \xB7 ${material.name} ${material.source})`);
  }
  if (!reasons.length) reasons.push(...stability(stack, cfg, solved).violations);
  if (current.packaging) {
    const r = packagingRobot(updated, current, placed, c);
    if (box.weight + c.gripper.mass > c.gripper.payload + EPS) reasons.push(`ROBOT: \uAC00\uBC18 ${box.weight + c.gripper.mass} / \uCD5C\uB300 ${c.gripper.payload} kg`);
    return { placement: updated, reasons: [.../* @__PURE__ */ new Set([...reasons, ...r.reasons])], path: r.path ?? idealPath(updated, current, placed), stack };
  }
  if (c.robotMode === "ideal") return { placement: { ...updated, loadAbove: 0 }, reasons: [...new Set(reasons)], path: idealPath(updated, current, placed), stack };
  if (box.weight + c.gripper.mass > c.gripper.payload + EPS) reasons.push("\uC124\uC815\uB41C \uAC00\uBC18\uD558\uC911 \uCD08\uACFC");
  const path = gripperPath(updated, current, placed, c), workspace = c.workspace;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1].tcp, b = path.points[i].tcp;
    const from = path.points[i - 1].yaw || 0, to = path.points[i].yaw || 0, gripSize = yawEnvelope(c.gripper.width, c.gripper.depth, from, to), heldSize = yawEnvelope(current.size.w, current.size.d, from, to);
    const grip = swept2(a, b, gripSize.w, gripSize.d, 0, c.gripper.height, c.gripper.margin);
    const carrying = path.points[i].carrying, held = swept2(a, b, heldSize.w, heldSize.d, s.h, 0, 0);
    if (c.reach && !withinReach(a, b, c.reach)) {
      reasons.push("\uB85C\uBD07 TCP \uB3C4\uB2EC \uBC18\uACBD \uBC16 \xB7 \uACBD\uB85C \uD3EC\uD568");
      break;
    }
    const bounds = path.fixedGrasp ? tiltSweeps(path.points[i - 1], path.points[i], current, c) : [grip, ...carrying ? [held] : []];
    if (bounds.some((v) => v.position.x < workspace.xMin - EPS || v.position.x + v.size.w > workspace.xMax + EPS || v.position.y < workspace.yMin - EPS || v.position.y + v.size.d > workspace.yMax + EPS || v.position.z < -EPS || v.position.z + v.size.h > workspace.zMax + EPS)) {
      reasons.push("\uC124\uC815\uB41C \uC791\uC5C5\uACF5\uAC04 \uBC16");
      break;
    }
    const conflict = placed.find((other) => bounds.some((v) => intersects(v, other)));
    if (conflict) {
      reasons.push(`\uADF8\uB9AC\uD37C / \uC6B4\uBC18 \uC811\uADFC \uACBD\uB85C \uAC04\uC12D \xB7 ${conflict.id}`);
      break;
    }
  }
  if (robot) {
    const result = robot.inspect(path, placed);
    if (!result.valid) reasons.push(...result.reasons);
  }
  return { placement: { ...updated, loadAbove: 0 }, reasons: [...new Set(reasons)], path, stack };
}

// src/engine/vendor/pallet/candidates.ts
var candidateMeter = { calls: 0, generated: 0, checked: 0 };
function candidateOrigins(input, supportTargets = false) {
  const { current, pallet, placements, constraints, settings } = input;
  const raw = (current.packaging ? permittedOrientations(current.packaging).filter((o) => current.orientationAllowed.includes(o)) : allowedOrientations(current.size, current.orientationAllowed, current.handling, current.maxLoadByAxis)).flatMap((orientation) => {
    const size = oriented(current.size, orientation);
    const origins = (settings.candidateMode === "frontier" ? frontierOrigins : sparseOrigins)(pallet, size, placements, constraints.horizontalGap).map((position) => ({ position, size, orientation, balanceTarget: false }));
    if (supportTargets) {
      const targets = balancedOrigins(size, placements, current.weight);
      if (settings.policy === "online") {
        const x = (pallet.width - size.w) / 2, y = (pallet.depth - size.d) / 2;
        targets.push({ x, y, z: landingHeight(x, y, size, placements) });
      }
      for (const position of targets) {
        const existing = origins.find((r) => Math.abs(r.position.x - position.x) < 1e-6 && Math.abs(r.position.y - position.y) < 1e-6);
        if (existing) existing.balanceTarget = true;
        else origins.push({ position, size, orientation, balanceTarget: true });
      }
    }
    return origins;
  });
  raw.sort((a, b) => {
    const inside = (v) => v.position.x >= 0 && v.position.y >= 0 && v.position.x + v.size.w <= pallet.width && v.position.y + v.size.d <= pallet.depth;
    return Number(inside(b)) - Number(inside(a)) || a.position.z - b.position.z || a.position.y - b.position.y || a.position.x - b.position.x || orientationRank(a.orientation) - orientationRank(b.orientation);
  });
  const budget = settings.candidateMode === "frontier" ? diverseBudget(raw, placements, pallet, constraints, settings.maxCandidates, settings.stockPolicy === "compact", settings.interiorPacking) : raw.slice(0, settings.maxCandidates);
  return { budget, generated: raw.length, capped: raw.length > settings.maxCandidates };
}
var slotKey = (b) => [b.position.x, b.position.y, b.position.z, b.size.w, b.size.d, b.size.h].join(":");
function candidateSet(input, supportTargets = false, extra = []) {
  const { current, pallet, placements, constraints, settings } = input, root2 = candidateOrigins(input, supportTargets), budget = [...root2.budget], baseMap = surface(placements, pallet);
  const keys = new Set(budget.map(slotKey));
  for (const b of extra) if (!keys.has(slotKey(b))) {
    keys.add(slotKey(b));
    budget.push({ position: b.position, size: b.size, orientation: b.orientation, balanceTarget: false });
  }
  const candidates2 = budget.map((r, i) => {
    const inspected = inspectConstraints({ packaging: current.packaging, id: current.id, typeId: current.typeId, position: r.position, size: r.size, orientation: r.orientation, weight: current.weight, supports: [], supportRatio: 0, loadAbove: 0, maxLoadKg: current.maxLoadKg, maxLoadSource: current.maxLoadSource, handling: current.handling, material: current.material, maxLoadByAxis: current.maxLoadByAxis, strengthFactor: current.strengthFactor, friction: current.friction }, current, placements, pallet, constraints);
    const f = inspected.reasons.length ? { maxHeight: top(inspected.placement), meanHeight: 0, roughness: 0, blockedVolume: 0, flatRatio: 0, imbalance: 0, workSeconds: inspected.path.seconds, slenderness: 0, loadUtilization: 0, lowerBalance: 0, inventory: emptyInventory() } : features(inspected.stack, pallet, inspected.path.model === "ideal" ? 0 : inspected.path.seconds, input, baseMap), t = terms(f, pallet, settings.weights, constraints.stability);
    if (settings.policy === "online") t.lowerBalance = -2 * (settings.weights.balance + settings.weights.stability) * (f.lowerBalance ?? 0);
    const score2 = Object.values(t).reduce((a, b) => a + b, 0);
    return { id: `c${i}`, placement: inspected.placement, valid: !inspected.reasons.length, reasons: inspected.reasons, path: inspected.path, features: f, terms: t, fastScore: score2, score: score2, future: null, remainingCheck: settings.policy === "online" ? "pending" : void 0 };
  });
  candidateMeter.calls++;
  candidateMeter.generated += root2.generated;
  candidateMeter.checked += candidates2.length;
  return { candidates: candidates2, generated: root2.generated, capped: root2.capped };
}

// src/engine/vendor/pallet/randomPlanner.ts
function planRandom(input) {
  const start2 = performance.now(), draw = rng(input.settings.plannerSeed ^ Math.imul(input.stepId + 1, 2654435761));
  const boxes = input.available ? shuffled(input.available, draw) : [input.current];
  const candidates2 = [], rejections = {}, deferred = [];
  let generated = 0, capped = false, selected2;
  const checkedTypes = /* @__PURE__ */ new Set();
  for (const box of boxes) {
    checkedTypes.add(box.typeId);
    const remaining2 = { ...input.remaining };
    if (input.available) remaining2[box.typeId] = Math.max(0, (remaining2[box.typeId] || 0) - 1);
    const scoped = { ...input, current: box, available: void 0, remaining: remaining2, settings: { ...input.settings, inventoryMode: "none" } };
    const root2 = candidateSet(scoped);
    generated += root2.generated;
    capped ||= root2.capped;
    for (const c of root2.candidates) {
      c.id = `${box.id}:${c.id}`;
      if (c.valid && (input.buffer?.length ?? 0) > 0) {
        const after = inspectConstraints(c.placement, box, input.placements, input.pallet, input.constraints).stack;
        const protectedBoxes = input.buffer.filter((h) => h.observation.id !== box.id);
        if (protectedBoxes.some((h) => h.reservedTop.position.z < Math.max(0, ...after.map(top)) || inspectConstraints(h.reservedTop, { ...h.observation, pickupPosition: h.source }, after, input.pallet, input.constraints).reasons.length)) {
          c.valid = false;
          c.reasons.push("\uC784\uC2DC \uB300\uAE30 \uBC15\uC2A4\uC758 \uC0C1\uB2E8 \uBCF5\uADC0 \uC704\uCE58 \uBCF4\uC874 \uBD88\uAC00");
        }
      }
      for (const reason of c.reasons) rejections[reason] = (rejections[reason] || 0) + 1;
    }
    candidates2.push(...root2.candidates);
    const valid = root2.candidates.filter((c) => c.valid);
    if (valid.length) {
      selected2 = valid[Math.floor(draw() * valid.length)];
      break;
    }
    deferred.push({ id: box.id, reason: [...new Set(root2.candidates.flatMap((c) => c.reasons))].join(" / ") || "\uC720\uD6A8 \uD6C4\uBCF4 \uC5C6\uC74C" });
  }
  return {
    runId: input.runId,
    stepId: input.stepId,
    selectedId: selected2?.id ?? null,
    ...input.available ? { selectedBoxId: selected2?.placement.id, stockSelection: { available: boxes.length, checkedTypes: checkedTypes.size, deferred, foundation: 0 } } : {},
    ...input.buffer?.length ? { bufferPlan: { held: input.buffer.filter((h) => h.observation.id !== selected2?.placement.id), addedIds: [], releasedId: input.buffer.some((h) => h.observation.id === selected2?.placement.id) ? selected2?.placement.id : void 0, checkedPairs: 0 } } : {},
    candidates: candidates2,
    generated,
    checkedCandidates: candidates2.length,
    valid: candidates2.filter((c) => c.valid).length,
    rejections,
    nodes: candidates2.length,
    rolloutCalls: 0,
    milliseconds: performance.now() - start2,
    capped,
    virtualSequences: [],
    explanation: [
      selected2 ? "\uD544\uC218 \uC81C\uC57D\uC744 \uD1B5\uACFC\uD55C \uD6C4\uBCF4\uC5D0\uC11C \uC810\uC218 \uC21C\uC704 \uC5C6\uC774 \uADE0\uB4F1 \uBB34\uC791\uC704\uB85C \uC704\uCE58\xB7\uC790\uC138\uB97C \uC120\uD0DD\uD588\uC2B5\uB2C8\uB2E4." : "\uAC80\uD1A0\uD55C \uD6C4\uBCF4 \uC911 \uC81C\uC57D\uC744 \uB9CC\uC871\uD558\uB294 \uC704\uCE58\uAC00 \uC5C6\uC5B4 \uBC30\uCE58\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
      input.available ? "\uD604\uC7AC \uC120\uD0DD \uAC00\uB2A5\uD55C \uC7AC\uACE0\uB97C \uBB34\uC791\uC704 \uC21C\uC11C\uB85C \uAC80\uC0AC\uD558\uC5EC \uBC30\uCE58 \uAC00\uB2A5\uD55C \uCCAB \uBC15\uC2A4\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4." : "\uD604\uC7AC \uB3C4\uCC29\uD55C \uBC15\uC2A4\uB9CC \uC120\uD0DD\uD558\uBA70, \uC544\uC9C1 \uB3C4\uCC29\uD558\uC9C0 \uC54A\uC740 \uBC15\uC2A4\uB97C \uAC00\uC838\uC624\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
      `\uBC30\uCE58 \uB09C\uC218 \uC2DC\uB4DC ${input.settings.plannerSeed} \xB7 \uB2E8\uACC4 ${input.stepId + 1}. \uAC19\uC740 \uC785\uB825\xB7\uC2DC\uB4DC\uB294 \uAC19\uC740 \uBC30\uCE58\uB97C \uC7AC\uD604\uD569\uB2C8\uB2E4.`,
      "\uACBD\uACC4 \uAE30\uBC18 \uD6C4\uBCF4\uC640 \uD6C4\uBCF4 \uC218 \uC81C\uD55C\uC740 \uAE30\uC874 \uBC29\uC2DD\uACFC \uAC19\uC2B5\uB2C8\uB2E4. \uC804\uCCB4 \uC5F0\uC18D \uACF5\uAC04\uC5D0\uC11C \uBB34\uC791\uC704 \uC88C\uD45C\uB97C \uBF51\uB294 \uBC29\uC2DD\uC740 \uC544\uB2D9\uB2C8\uB2E4. \uD45C\uC2DC \uC810\uC218\uB294 \uC9C4\uB2E8\uC6A9\uC774\uBA70 \uC120\uD0DD\xB7\uBBF8\uB798 \uC608\uCE21\uC5D0 \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
    ]
  };
}

// src/engine/vendor/pallet/remainingSites.ts
function virtualObservation(type, id) {
  return { id, typeId: type.id, size: { ...type.size }, weight: type.weight, status: "normal", orientationAllowed: [...type.orientations], packaging: type.packaging, maxLoadKg: type.maxLoadKg, maxLoadSource: type.maxLoadSource, maxLoadByAxis: type.maxLoadByAxis, handling: type.handling, material: type.material, strengthFactor: type.strengthFactor, friction: type.friction };
}
function remainingSites(input, placed) {
  const types = [];
  let tested = 0, demand = 0, fitDemand = 0, opportunity = 0;
  for (const type of input.types) {
    const quantity = input.remaining[type.id] || 0;
    if (quantity <= 0) continue;
    const observation = virtualObservation(type, `reserve-${type.id}`), raw = allowedOrientations(type.size, type.orientations, type.handling, type.maxLoadByAxis).flatMap((orientation) => {
      const size = oriented(type.size, orientation);
      const origins = frontierOrigins(input.pallet, size, placed, input.constraints.horizontalGap).map((position) => ({ position, size, orientation, balanceTarget: false }));
      for (const position of balancedOrigins(size, placed, type.weight)) {
        const old = origins.find((r) => Math.abs(r.position.x - position.x) < 1e-6 && Math.abs(r.position.y - position.y) < 1e-6);
        if (old) old.balanceTarget = true;
        else origins.push({ position, size, orientation, balanceTarget: true });
      }
      return origins;
    });
    const probes = diverseBudget(raw, placed, input.pallet, input.constraints, input.settings.reserveProbes ?? 8);
    let fitSites = 0, sampleSites = 0;
    const reasons = /* @__PURE__ */ new Set();
    for (const r of probes) {
      sampleSites++;
      tested++;
      const b = { ...observation, position: r.position, size: r.size, orientation: r.orientation, supports: [], supportRatio: 0, loadAbove: 0 }, check = inspectConstraints(b, observation, placed, input.pallet, input.constraints);
      if (!check.reasons.length) fitSites++;
      else for (const reason of check.reasons) reasons.add(reason.split(" \xB7 ")[0]);
    }
    if (!sampleSites) reasons.add("\uAC80\uD1A0 \uC704\uCE58\uC5D0\uC11C \uACBD\uACC4\xB7\uB192\uC774\xB7\uC9C0\uC9C0 \uC870\uAC74\uC744 \uB9CC\uC871\uD558\uC9C0 \uBABB\uD568");
    const mass = quantity * volume(type.size);
    demand += mass;
    fitDemand += fitSites ? mass : 0;
    opportunity += mass * (sampleSites ? fitSites / sampleSites : 0);
    types.push({ id: type.id, quantity, fitSites, sampleSites, reasons: fitSites ? [] : [...reasons] });
  }
  return { fitFraction: demand ? fitDemand / demand : 1, opportunity: demand ? opportunity / demand : 1, tested, types };
}
function lostRemaining(input, before, after) {
  let demand = 0, lost = 0;
  for (const type of input.types) {
    const v = (input.remaining[type.id] || 0) * volume(type.size);
    demand += v;
    if (before.types.find((t) => t.id === type.id)?.fitSites && !after.types.find((t) => t.id === type.id)?.fitSites) lost += v;
  }
  return demand ? lost / demand : 0;
}

// src/engine/vendor/pallet/strategies/feasibility.ts
var causalInput = (input) => ({ ...input, available: void 0, buffer: void 0, types: [], remaining: {}, settings: { ...input.settings, inventoryMode: "none", policy: "online", candidateMode: "frontier", stockPolicy: void 0, interiorPacking: false } });
function approachVolume(slot, config2) {
  return { position: { x: slot.position.x - config2.approachMargin, y: slot.position.y - config2.approachMargin, z: top(slot) }, size: { w: slot.size.w + 2 * config2.approachMargin, d: slot.size.d + 2 * config2.approachMargin, h: config2.approachHeight } };
}
function approachClear(slot, stack, config2) {
  return !config2.approach || !stack.some((b) => intersects(approachVolume(slot, config2), b));
}
var Feasibility = class {
  constructor(input, config2) {
    this.input = input;
    this.config = config2;
  }
  input;
  config;
  nodes = 0;
  cache = /* @__PURE__ */ new Map();
  check(type, slot, stack) {
    this.nodes++;
    const observation = virtualObservation(type, `probe-${type.id}`), b = { ...slot, ...observation, size: slot.size, position: slot.position };
    const checked = inspectConstraints(b, observation, stack, this.input.pallet, this.input.constraints);
    return !checked.reasons.length && approachClear(checked.placement, stack, this.config) ? checked.placement : null;
  }
  sites(type, stack, retain = []) {
    const key = type.id + "|" + stack.map((b) => b.id + ":" + slotKey(b)).join(";") + "|" + retain.map(slotKey).join(";");
    const cached = this.cache.get(key);
    if (cached) return cached;
    const current = virtualObservation(type, `probe-${type.id}`), i = { ...causalInput(this.input), current, placements: stack, settings: { ...causalInput(this.input).settings, maxCandidates: this.config.futureCandidates } };
    const raw = candidateOrigins(i, true).budget;
    const unique = /* @__PURE__ */ new Map();
    const proposals = [...retain, ...raw.map((r) => ({ ...current, ...r, supports: [], supportRatio: 0, loadAbove: 0 }))];
    const seen = /* @__PURE__ */ new Set();
    for (const slot of proposals) {
      const key2 = slotKey(slot);
      if (seen.has(key2)) continue;
      seen.add(key2);
      const valid = this.check(type, slot, stack);
      if (valid) unique.set(key2, valid);
    }
    const result = [...unique.values()];
    this.cache.set(key, result);
    return result;
  }
};
function criticalBoxes(input, config2, probe) {
  const pending = input.types.filter((t) => (input.remaining[t.id] || 0) > 0), maxVolume = Math.max(1, ...input.types.map((t) => volume(t.size))), maxWeight = Math.max(1e-3, ...input.types.map((t) => t.weight)), minWeight = Math.min(input.current.weight, ...input.types.map((t) => t.weight));
  return pending.map((type) => {
    const slots = probe.sites(type, input.placements), sizes = Object.values(type.size), aspect = Math.max(...sizes) / Math.min(...sizes), orientations = allowedOrientations(type.size, type.orientations, type.handling, type.maxLoadByAxis).length;
    const factors = { volume: volume(type.size) / maxVolume, aspect: Math.min(1, (aspect - 1) / 5), weight: type.weight / maxWeight, orientation: 1 - Math.max(0, orientations - 1) / 5, scarcity: 1 / (1 + slots.length) };
    const weights = config2.criticalWeights, den = Math.max(1e-6, Object.values(weights).reduce((a, b) => a + b, 0)), criticality = Object.entries(factors).reduce((n2, [k, v]) => n2 + v * weights[k], 0) / den;
    const lowerZ = Math.min(...slots.map((s) => s.position.z)), lowerBefore = slots.filter((s) => s.position.z <= lowerZ + 1e-3).length;
    return {
      type,
      typeId: type.id,
      quantity: input.remaining[type.id],
      criticality,
      factors,
      shapeCritical: aspect >= 3 || factors.volume >= 0.6 || slots.length <= 2,
      weightCritical: type.weight >= maxWeight * 0.75 && type.weight > minWeight * 1.25,
      slots,
      lowerZ,
      feasibleBefore: slots.length,
      feasibleAfter: slots.length,
      lowerBefore,
      lowerAfter: lowerBefore,
      lost: 0,
      deadEnd: false
    };
  }).sort((a, b) => b.criticality - a.criticality || a.typeId.localeCompare(b.typeId));
}
function futureLoss(before, after, mode) {
  return Math.max(0, before - after) / (mode === "normalized" ? Math.max(1, before) : 1);
}
function assessCritical(critical, stack, probe, config2) {
  const slots = probe.sites(critical.type, stack, critical.slots), after = slots.length;
  const { type: _, slots: __, lowerZ, ...info } = critical;
  const result = { ...info, feasibleAfter: after, lowerAfter: slots.filter((s) => s.position.z <= lowerZ + 1e-3).length, lost: futureLoss(info.feasibleBefore, after, config2.lossMode), deadEnd: info.feasibleBefore > 0 && after === 0 };
  return { info: result, slots };
}

// src/engine/vendor/pallet/strategies/currentScore.ts
var unit = (n2) => Math.max(0, Math.min(1, n2));
function currentScore(candidate, input, config2) {
  const f = candidate.features, p = input.pallet, w = config2.weights;
  const components = {
    compactness: (input.placements.reduce((s, b) => s + volume(b.size), 0) + volume(candidate.placement.size)) / (p.width * p.depth * Math.max(1, f.maxHeight)),
    support: candidate.placement.supportRatio,
    stability: 1 - unit(Math.max(f.loadUtilization, f.lowerBalance ?? 0)),
    centerOfMass: 1 - unit(f.imbalance),
    flatness: f.flatRatio,
    heightPenalty: f.maxHeight / p.maxHeight
  };
  const score2 = w.compactness * components.compactness + w.support * components.support + w.stability * components.stability + w.centerOfMass * components.centerOfMass + w.flatness * components.flatness - w.height * components.heightPenalty;
  return { score: score2, components };
}

// src/engine/vendor/pallet/strategies/freeSpace.ts
function accessibleSpace(stack, p) {
  const edges = (axis, length) => {
    const all = [.../* @__PURE__ */ new Set([0, length, ...stack.flatMap((b) => [b.position[axis], b.position[axis] + (axis === "x" ? b.size.w : b.size.d)])])].filter((n2) => n2 >= 0 && n2 <= length).sort((a, b) => a - b);
    if (all.length <= 17) return all;
    return [...new Set(Array.from({ length: 17 }, (_, i) => all[Math.round(i * (all.length - 1) / 16)]))];
  };
  const xs = edges("x", p.width), ys = edges("y", p.depth), nx = xs.length - 1, ny = ys.length - 1;
  const heights = Array.from({ length: ny }, (_, y) => Array.from({ length: nx }, (_2, x) => Math.max(0, ...stack.filter((b) => overlapRect(footprint(b), { x: xs[x], y: ys[y], w: xs[x + 1] - xs[x], d: ys[y + 1] - ys[y] })).map(top))));
  let largest = 0, accessible = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) accessible += (xs[x + 1] - xs[x]) * (ys[y + 1] - ys[y]) * Math.max(0, p.maxHeight - heights[y][x]);
  for (let y0 = 0; y0 < ny; y0++) {
    const column = new Array(nx).fill(0);
    for (let y1 = y0; y1 < ny; y1++) {
      for (let x = 0; x < nx; x++) column[x] = Math.max(column[x], heights[y1][x]);
      for (let x0 = 0; x0 < nx; x0++) {
        let z = 0;
        for (let x1 = x0; x1 < nx; x1++) {
          z = Math.max(z, column[x1]);
          largest = Math.max(largest, (xs[x1 + 1] - xs[x0]) * (ys[y1 + 1] - ys[y0]) * Math.max(0, p.maxHeight - z));
        }
      }
    }
  }
  return { largest, accessible, score: largest / (p.width * p.depth * p.maxHeight), fragmentation: accessible ? 1 - largest / accessible : 0 };
}

// src/engine/vendor/pallet/strategies/lookaheadSimulation.ts
function sampleSequences(input, config2, difficulty) {
  const pool = input.types.flatMap((t) => Array.from({ length: Math.max(0, input.remaining[t.id] || 0) }, () => t.id));
  if (!pool.length) return [];
  if (config2.lookaheadMode === "worst") {
    const hard = [...pool].sort((a, b) => (difficulty.get(b) || 0) - (difficulty.get(a) || 0) || a.localeCompare(b));
    const prefix = hard.slice(0, config2.lookaheadDepth), late = [...hard.slice(1).reverse().slice(0, Math.max(0, config2.lookaheadDepth - 1)), hard[0]];
    return [prefix, late];
  }
  const random = rng((input.settings.plannerSeed ^ Math.imul(input.stepId + 1, 2654435761)) >>> 0);
  return Array.from({ length: config2.lookaheadSamples }, () => shuffled(pool, random).slice(0, config2.lookaheadDepth));
}
function simulateFuture(input, candidate, sequences, config2) {
  let nodes = 0, calls = 0, added = 0, amount = 0, height = 0, blocked = 0;
  const rewards = [];
  for (const sequence of sequences) {
    let stack = equilibrium([...input.placements, candidate.placement]).placements, count = 0, v = 0;
    for (const [step, id] of sequence.entries()) {
      const current = virtualObservation(input.types.find((t) => t.id === id), `virtual-${step}-${id}`), i = { ...causalInput(input), current, placements: stack, settings: { ...causalInput(input).settings, maxCandidates: config2.futureCandidates } };
      const options = candidateSet(i, true);
      nodes += options.candidates.length;
      calls++;
      const ranked = options.candidates.filter((c) => c.valid && approachClear(c.placement, stack, config2)).map((c) => ({ c, score: currentScore(c, i, config2).score })).sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
      const choice = ranked[0]?.c;
      if (!choice) break;
      stack = equilibrium([...stack, choice.placement]).placements;
      count++;
      v += volume(current.size);
    }
    const h = Math.max(0, ...stack.map(top));
    added += count;
    amount += v;
    height += h;
    blocked += Number(count < sequence.length);
    rewards.push(count / Math.max(1, sequence.length) - Number(count < sequence.length) + 0.1 * (1 - h / input.pallet.maxHeight));
  }
  const n2 = Math.max(1, sequences.length), score2 = !rewards.length ? 0 : config2.lookaheadMode === "worst" ? Math.min(...rewards) : rewards.reduce((a, b) => a + b, 0) / n2;
  return { score: score2, nodes, calls, future: { added: added / n2, volume: amount / n2, finalHeight: height / n2, blocked: blocked / n2, sequences, policies: ["Greedy \xB7 \uD604\uC7AC \uAC00\uC0C1 \uB3C4\uCC29\uB9CC"] } };
}

// src/engine/vendor/pallet/strategies/evaluator.ts
function makeEvaluator(input, config2, mode, scorer) {
  const probe = new Feasibility(input, config2), needsFuture = !["strategy-greedy", "macs"].includes(mode);
  const all = needsFuture ? criticalBoxes(input, config2, probe) : [], critical = all.slice(0, mode === "tetris-reserved" ? 1 : config2.criticalK);
  const sequences = mode === "lookahead" ? sampleSequences(input, config2, new Map(all.map((c) => [c.typeId, c.criticality]))) : [];
  const previous = input.strategyState?.algorithm === mode ? input.strategyState.slots : [];
  let fixed;
  if (mode === "tetris-reserved") {
    fixed = previous.find((s) => {
      const type = input.types.find((t) => t.id === s.typeId);
      return type && ((input.remaining[s.typeId] || 0) > 0 || input.current.typeId === s.typeId) && probe.check(type, s.placement, input.placements);
    });
    if (!fixed) {
      const c = critical.find((c2) => c2.slots.length);
      const slot = c?.slots.slice().sort((a, b) => a.position.z - b.position.z || a.position.y - b.position.y || a.position.x - b.position.x)[0];
      if (c && slot) fixed = { typeId: c.typeId, placement: slot };
    }
  }
  let nodes = 0, calls = 0;
  const memo = /* @__PURE__ */ new Map();
  const evaluate = (candidate) => {
    const cached = memo.get(candidate.id);
    if (cached) return cached;
    const base = currentScore(candidate, input, config2), stack = [...input.placements, candidate.placement];
    let fpl = 0, deadEnds = 0, lowerLoss = 0, reservationPenalty = 0;
    let reservedSlots = [];
    const components = { ...base.components, current: base.score };
    const selectedCritical = [...critical];
    if (fixed && !selectedCritical.some((c) => c.typeId === fixed.typeId)) {
      const c = all.find((c2) => c2.typeId === fixed.typeId);
      if (c) selectedCritical.push(c);
    }
    const criticalResults = needsFuture ? selectedCritical.map((c) => assessCritical(c, stack, probe, config2)) : [];
    if (mode === "dynamic-reservation" || mode === "future-hybrid") {
      for (const { info, slots } of criticalResults) {
        fpl += info.criticality * info.lost;
        if (info.deadEnd) deadEnds++;
        if (info.weightCritical) lowerLoss += info.criticality * futureLoss(info.lowerBefore, info.lowerAfter, config2.lossMode);
        reservedSlots.push(...slots.map((placement) => ({ typeId: info.typeId, placement })));
      }
    }
    if (mode === "tetris-reserved" && fixed) {
      const targetArrived = input.current.typeId === fixed.typeId;
      const invades = intersects(candidate.placement, fixed.placement) || config2.approach && intersects(candidate.placement, approachVolume(fixed.placement, config2));
      reservationPenalty = targetArrived ? slotKey(candidate.placement) === slotKey(fixed.placement) ? -1 : 0 : Number(invades);
      const type = input.types.find((t) => t.id === fixed.typeId);
      if (!targetArrived && probe.check(type, fixed.placement, stack)) reservedSlots = [fixed];
      else if ((input.remaining[fixed.typeId] || 0) > 0) {
        const replacement = probe.sites(type, stack)[0];
        if (replacement) reservedSlots = [{ typeId: fixed.typeId, placement: replacement }];
      }
    }
    if (mode === "macs" || mode === "future-hybrid" || mode === "dynamic-reservation") {
      const free = accessibleSpace(stack, input.pallet);
      components.macs = free.score;
      components.fragmentation = free.fragmentation;
    }
    if (mode === "lookahead") {
      const future = simulateFuture(input, candidate, sequences, config2);
      nodes += future.nodes;
      calls += future.calls;
      candidate.future = future.future;
      components.lookahead = future.score;
    }
    if (mode === "tetris-reserved" || mode === "lookahead") for (const { info } of criticalResults) {
      fpl += info.criticality * info.lost;
      deadEnds += Number(info.deadEnd);
    }
    Object.assign(components, { futurePlacementLoss: fpl, deadEnds, lowerSpaceLoss: lowerLoss, reservationPenalty });
    const key = (s) => s.typeId + ":" + slotKey(s.placement), oldKeys = new Set(previous.map(key)), newKeys = new Set(reservedSlots.map(key));
    const reservationChanges = [...oldKeys].filter((k) => !newKeys.has(k)).length + [...newKeys].filter((k) => !oldKeys.has(k)).length;
    const score2 = scorer(components, config2.weights);
    const debug = { algorithm: mode, selectedScore: score2, scoreComponents: components, criticalBoxes: criticalResults.map((r) => r.info), futurePlacementLoss: fpl, deadEnds, reservedSlots, reservationChanges, sampled: true, candidateBudget: config2.futureCandidates, sequences };
    candidate.score = score2;
    candidate.fastScore = base.score;
    candidate.strategyDebug = debug;
    memo.set(candidate.id, debug);
    return debug;
  };
  return { evaluate, sequences, fixed, counts: () => ({ nodes: nodes + probe.nodes, calls }) };
}

// src/engine/vendor/pallet/strategies/GreedyStrategy.ts
var GreedyStrategy = {
  id: "strategy-greedy",
  name: "Greedy",
  score(v, w) {
    return v.current;
  },
  choosePlacement(context) {
    return select(context, "strategy-greedy");
  }
};

// src/engine/vendor/pallet/strategies/MacsStrategy.ts
var MacsStrategy = {
  id: "macs",
  name: "MACS",
  score(v, w) {
    return v.current + w.macs * v.macs - w.fragmentation * v.fragmentation;
  },
  choosePlacement(context) {
    return select(context, "macs");
  }
};

// src/engine/vendor/pallet/strategies/TetrisReservationStrategy.ts
var TetrisReservationStrategy = {
  id: "tetris-reserved",
  name: "Tetris Reserved Slot",
  score(v, w) {
    return v.current - w.reservation * v.reservationPenalty;
  },
  choosePlacement(context) {
    return select(context, "tetris-reserved");
  }
};

// src/engine/vendor/pallet/strategies/DynamicReservationStrategy.ts
var DynamicReservationStrategy = {
  id: "dynamic-reservation",
  name: "Dynamic Reservation",
  score(v, w) {
    return v.current - w.fpl * v.futurePlacementLoss - w.deadEnd * v.deadEnds - w.lowerSpace * v.lowerSpaceLoss - w.fragmentation * v.fragmentation;
  },
  choosePlacement(context) {
    return select(context, "dynamic-reservation");
  }
};

// src/engine/vendor/pallet/strategies/LookaheadStrategy.ts
var LookaheadStrategy = {
  id: "lookahead",
  name: "Lookahead",
  score(v, w) {
    return v.current + w.lookahead * v.lookahead;
  },
  choosePlacement(context) {
    return select(context, "lookahead");
  }
};

// src/engine/vendor/pallet/strategies/HybridStrategy.ts
var HybridStrategy = {
  id: "future-hybrid",
  name: "Future-Aware Hybrid",
  score(v, w) {
    return v.current + w.macs * v.macs - w.fragmentation * v.fragmentation - w.fpl * v.futurePlacementLoss - w.deadEnd * v.deadEnds - w.lowerSpace * v.lowerSpaceLoss;
  },
  choosePlacement(context) {
    return select(context, "future-hybrid");
  }
};

// src/engine/vendor/pallet/strategies/index.ts
var PACKING_STRATEGIES = {
  "strategy-greedy": GreedyStrategy,
  macs: MacsStrategy,
  "tetris-reserved": TetrisReservationStrategy,
  "dynamic-reservation": DynamicReservationStrategy,
  lookahead: LookaheadStrategy,
  "future-hybrid": HybridStrategy
};
function planStrategy(input) {
  if (input.available) throw Error("\uC0C8 \uBE44\uAD50 \uC804\uB7B5\uC740 \uD604\uC7AC \uB3C4\uCC29 \uBC15\uC2A4\uB9CC \uBC30\uCE58\uD569\uB2C8\uB2E4. \uBC15\uC2A4 \uACF5\uAE09 \uBC29\uC2DD\uC744 \uC21C\uCC28 \uD22C\uC785\uC73C\uB85C \uBC14\uAFB8\uC138\uC694.");
  if (!isStrategy(input.algorithm)) throw Error("\uB4F1\uB85D\uB418\uC9C0 \uC54A\uC740 \uC801\uC7AC \uC804\uB7B5");
  if (!Number.isInteger(input.settings.maxCandidates) || input.settings.maxCandidates < 4 || input.settings.maxCandidates > 256) throw Error("\uD604\uC7AC \uD6C4\uBCF4 \uC0C1\uD55C\uC740 4~256 \uC815\uC218\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  const start2 = performance.now(), config2 = strategyConfig(input.settings.strategy), evaluator = makeEvaluator(input, config2, input.algorithm, PACKING_STRATEGIES[input.algorithm].score);
  const fixed = evaluator.fixed, extra = fixed?.typeId === input.current.typeId ? [fixed.placement] : [];
  const root2 = candidateSet(causalInput(input), true, extra), rejections = {};
  for (const c of root2.candidates) {
    if (c.valid && !approachClear(c.placement, input.placements, config2)) {
      c.valid = false;
      c.reasons.push("\uC218\uC9C1 \uC811\uADFC \uC5EC\uC720 \uAC04\uC12D");
    }
    for (const r of c.reasons) rejections[r.split(" \xB7 ")[0]] = (rejections[r.split(" \xB7 ")[0]] || 0) + 1;
  }
  const valid = root2.candidates.filter((c) => c.valid);
  let choices = valid;
  if (input.algorithm === "lookahead") {
    const ranked = [...valid].sort((a, b) => currentScore(b, input, config2).score - currentScore(a, input, config2).score), limit = config2.lookaheadCandidates;
    choices = ranked.slice(0, Math.min(2, limit));
    const seen = new Set(choices.map((c) => `${c.placement.position.z}:${c.placement.orientation}:${Math.floor(2 * (c.placement.position.x + c.placement.size.w / 2) / input.pallet.width)}:${Math.floor(2 * (c.placement.position.y + c.placement.size.d / 2) / input.pallet.depth)}`));
    for (const c of ranked) {
      const p = c.placement, key = `${p.position.z}:${p.orientation}:${Math.floor(2 * (p.position.x + p.size.w / 2) / input.pallet.width)}:${Math.floor(2 * (p.position.y + p.size.d / 2) / input.pallet.depth)}`;
      if (!seen.has(key) && choices.length < limit) {
        choices.push(c);
        seen.add(key);
      }
    }
    for (const c of ranked) if (choices.length < limit && !choices.includes(c)) choices.push(c);
  }
  const decision = PACKING_STRATEGIES[input.algorithm].choosePlacement({ input, config: config2, candidates: choices, evaluate: evaluator.evaluate }), debug = decision.debugInfo, counts2 = evaluator.counts();
  return {
    runId: input.runId,
    stepId: input.stepId,
    selectedId: decision.candidateId,
    selectedBoxId: decision.placement ? input.current.id : void 0,
    candidates: root2.candidates,
    generated: root2.generated,
    valid: valid.length,
    rejections,
    nodes: root2.candidates.length + counts2.nodes,
    rolloutCalls: counts2.calls,
    milliseconds: performance.now() - start2,
    capped: root2.capped || choices.length < valid.length,
    strategyDebug: debug ?? void 0,
    strategyState: { algorithm: input.algorithm, slots: debug?.reservedSlots ?? [] },
    virtualSequences: evaluator.sequences,
    explanation: [
      `${PACKING_STRATEGIES[input.algorithm].name}: \uD604\uC7AC \uB3C4\uCC29 ${input.current.id}\uB9CC \uBC30\uCE58\uD569\uB2C8\uB2E4. \uC2E4\uC81C \uBBF8\uB798 \uC21C\uC11C\uB294 \uACC4\uD68D\uAE30\uC5D0 \uC804\uB2EC\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`,
      input.algorithm === "strategy-greedy" ? "\uBBF8\uB798 \uC7AC\uACE0\xB7\uC608\uC57D\uC744 \uD3C9\uAC00\uD558\uC9C0 \uC54A\uB294 \uD604\uC7AC \uBC15\uC2A4 \uAE30\uC900\uC120\uC785\uB2C8\uB2E4." : input.algorithm === "macs" ? "\uC704\uC5D0\uC11C \uC811\uADFC \uAC00\uB2A5\uD55C \uCD5C\uB300 \uBE48 \uC9C1\uC721\uBA74\uCCB4\uB85C MACS\uB97C \uADFC\uC0AC\uD569\uB2C8\uB2E4. \uBBF8\uB798 \uC885\uB958\uBCC4 \uC801\uD569\uC131\uC740 \uD3C9\uAC00\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." : `\uB0A8\uC740 \uC218\uB7C9\uC5D0\uC11C \uBBF8\uB798 \uBC30\uCE58 \uD6C4\uBCF4\uB97C \uAC80\uC0AC\uD569\uB2C8\uB2E4. \uD6C4\uBCF4 \uC218\uB294 \uC81C\uD55C\uB41C \uD45C\uBCF8\uC774\uBA70 \uC804\uCCB4 \uC801\uC7AC \uAC00\uB2A5\uC131 \uBCF4\uC7A5\uC774 \uC544\uB2D9\uB2C8\uB2E4.`,
      debug ? `\uC120\uD0DD \uC810\uC218 ${debug.selectedScore.toFixed(3)} \xB7 FPL ${debug.futurePlacementLoss.toFixed(3)} \xB7 \uBBF8\uB798 \uD6C4\uBCF4 \uC18C\uBA78 ${debug.deadEnds}\uC885 \xB7 \uBCF4\uD638 \uC704\uCE58 ${debug.reservedSlots.length}\uAC1C` : "\uD604\uC7AC \uBC15\uC2A4\uC758 \uC720\uD6A8 \uD6C4\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uBBF8\uC785\uACE0 \uBC15\uC2A4\uB85C \uAD50\uCCB4\uD558\uC9C0 \uC54A\uACE0 \uC911\uB2E8\uD569\uB2C8\uB2E4.",
      "\uAD00\uD1B5\xB7\uACBD\uACC4\xB7\uB192\uC774\xB7\uBC29\uD5A5\xB7\uC9C0\uC9C0\xB7\uB204\uC801 \uD558\uC911\xB7\uC815\uC801 \uD3C9\uD615\uC740 \uAE30\uC874 \uACF5\uD1B5 \uAC80\uC0AC\uC640 \uD655\uC815 \uC2DC \uC7AC\uAC80\uC0AC\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4."
    ]
  };
}

// src/engine/vendor/pallet/temporaryBuffer.ts
var BUFFER_SOURCE = { x: -1300, y: 850, z: 0 };
var BUFFER_SIZE = { w: 800, d: 650 };
var ctx = (input, box, placed) => ({ ...input, available: void 0, buffer: void 0, current: box, placements: placed, remaining: {}, settings: { ...input.settings, policy: "legacy", inventoryMode: "none", temporaryBuffer: false, maxCandidates: Math.min(64, input.settings.maxCandidates) } });
function topSearch(input, box, placed) {
  const height = Math.max(0, ...placed.map(top));
  if (height <= EPS) return { site: void 0, tested: 0, generated: 0, capped: false };
  const root2 = candidateSet(ctx(input, { ...box, pickupPosition: { ...BUFFER_SOURCE } }, placed), true);
  return { tested: root2.candidates.length, generated: root2.generated, capped: root2.capped, site: root2.candidates.filter((c) => c.valid && c.placement.position.z >= height - EPS).sort((a, b) => top(a.placement) - top(b.placement) || b.score - a.score)[0] };
}
var stackAfter = (input, c) => equilibrium([...input.placements, c.placement]).placements;
function chooseWithBuffer(input, selected2, valid, choices) {
  let nodes = 0, checkedPairs = 0, generated = 0, capped = false;
  const extra = [], held = (input.buffer || []).filter((h) => input.available?.some((b) => b.id === h.observation.id));
  const upper = (box, stack) => {
    checkedPairs++;
    const result2 = topSearch(input, box, stack);
    nodes += result2.tested;
    generated += result2.generated;
    capped ||= result2.capped;
    return result2.site;
  };
  const result = (c, after, addedIds = [], releasedId) => ({ selected: c, plan: { held: after, addedIds, releasedId, checkedPairs }, nodes, generated, capped, extra });
  if (held.length) {
    const h = held[0], others = valid.filter((c) => c.placement.id !== h.observation.id), options = [];
    if (selected2 && selected2.placement.id !== h.observation.id) options.push(selected2);
    for (const c of [...choices, ...others]) if (c.placement.id !== h.observation.id && !options.some((o) => o.placement.id === c.placement.id) && options.length < 6) options.push(c);
    for (const c of others) if (!options.includes(c) && options.length < 8) options.push(c);
    for (const c of options) {
      const site = upper(h.observation, stackAfter(input, c));
      if (site) return result(c, [{ ...h, reservedTop: site.placement }]);
    }
    const release = upper(h.observation, input.placements);
    if (release) {
      release.id = `buffer-return:${h.observation.id}`;
      extra.push(release);
      return result(release, [], [], h.observation.id);
    }
    return result(void 0, held);
  }
  if (!selected2) return result(selected2, []);
  const risky = choices.filter((c) => c === selected2 && (c.reservation?.lostFraction || 0) > EPS);
  let budget = 0;
  for (const risk of risky) {
    const box = input.available.find((b) => b.id === risk.placement.id);
    if (box.size.w > BUFFER_SIZE.w || box.size.d > BUFFER_SIZE.d || box.handling === "upright" && box.size.h > input.pallet.maxHeight) continue;
    const lost = risk.reservation.before.types.filter((t) => t.fitSites > 0 && !risk.reservation.after.types.find((a) => a.id === t.id)?.fitSites);
    for (const t of lost) {
      const alternative = valid.find((c) => c.placement.typeId === t.id && c.placement.id !== box.id);
      if (!alternative) continue;
      if (budget++ >= 4) return result(selected2, []);
      const other = input.available.find((b) => b.id === alternative.placement.id);
      const check = candidateSet(ctx(input, other, stackAfter(input, risk)), true);
      nodes += check.candidates.length;
      generated += check.generated;
      capped ||= check.capped;
      checkedPairs++;
      if (check.candidates.some((c) => c.valid)) continue;
      const site = upper(box, stackAfter(input, alternative));
      if (!site) continue;
      const reason = `${box.id} \uBA3C\uC800 \uBC30\uCE58\uD558\uBA74 ${other.id}\uC758 \uAC80\uD1A0 \uC704\uCE58\uAC00 \uB9C9\uD798 \xB7 ${other.id} \uBA3C\uC800 + ${box.id} \uC0C1\uB2E8 \uBC30\uCE58 \uAC80\uC99D`;
      return result(alternative, [{ observation: { ...box, pickupPosition: void 0 }, sinceStep: input.stepId + 1, reason, protects: [other.id], source: { ...BUFFER_SOURCE }, reservedTop: site.placement }], [box.id]);
    }
  }
  return result(selected2, []);
}

// src/engine/vendor/pallet/compactPlanner.ts
var counts = (stock) => {
  const r = {};
  for (const b of stock) r[b.typeId] = (r[b.typeId] || 0) + 1;
  return r;
};
var low = (a, b) => a.placement.position.z - b.placement.position.z;
var quality = (a, b) => low(a, b) || b.score - a.score || top(a.placement) - top(b.placement) || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x || a.placement.id.localeCompare(b.placement.id);
function forBox(input, box, budget) {
  return { ...input, available: void 0, current: box, remaining: counts(input.available.filter((b) => b.id !== box.id)), settings: { ...input.settings, policy: "legacy", candidateMode: "frontier", inventoryMode: "none", maxCandidates: budget } };
}
function planCompactStock(input, precise = true) {
  const start2 = performance.now(), stock = input.available, active = stock.filter((b) => !input.buffer?.some((h) => h.observation.id === b.id)), unique = active.filter((b, i) => active.findIndex((a) => a.typeId === b.typeId) === i), deferred = [], rejections = {};
  let generated = 0, nodes = 0, capped = false, rolloutCalls = 0;
  const inspect = (box, budget) => {
    const ctx2 = forBox(input, box, budget), root2 = candidateSet(ctx2, true);
    generated += root2.generated;
    nodes += root2.candidates.length;
    capped ||= root2.capped;
    for (const c of root2.candidates) {
      c.id = `${box.id}:${budget}:${c.id}`;
      if (c.valid) {
        compactScore(c, ctx2);
        c.remainingCheck = "pending";
      } else for (const reason of c.reasons) {
        const key = reason.split(" \xB7 ")[0].replace(/\([^)]*\)/g, "").trim();
        rejections[key] = (rejections[key] || 0) + 1;
      }
    }
    return root2.candidates;
  };
  const groups = unique.map((box) => ({ box, candidates: inspect(box, Math.min(input.settings.maxCandidates, 32)) }));
  if (precise && !groups.some((g) => g.candidates.some((c) => c.valid))) for (const g of groups) g.candidates = inspect(g.box, input.settings.maxCandidates);
  for (const group of groups) if (!group.candidates.some((c) => c.valid)) deferred.push({ id: group.box.typeId, reason: [...new Set(group.candidates.flatMap((c) => c.reasons))].join(" / ") || "\uD6C4\uBCF4 \uC0C1\uD55C \uB0B4 \uC720\uD6A8 \uBC30\uCE58 \uC5C6\uC74C" });
  let candidates2 = groups.flatMap((g) => g.candidates);
  if (precise) {
    const promising = groups.map((g) => ({ ...g, best: g.candidates.filter((c) => c.valid).sort(quality)[0] })).filter((g) => g.best).sort((a, b) => quality(a.best, b.best)).slice(0, 4);
    for (const g of promising) {
      candidates2 = candidates2.filter((c) => c.placement.typeId !== g.box.typeId);
      candidates2.push(...inspect(g.box, input.settings.maxCandidates));
    }
  }
  const valid = candidates2.filter((c) => c.valid).sort(quality), choices = [];
  const lowPlane = valid.filter((c) => !valid.length || c.placement.position.z === valid[0].placement.position.z);
  for (const c of lowPlane) if (!choices.some((a) => a.placement.typeId === c.placement.typeId) && choices.length < Math.min(3, input.settings.topK)) choices.push(c);
  for (const c of lowPlane) if (!choices.includes(c) && choices.length < input.settings.topK) choices.push(c);
  if (input.algorithm === "bl" && valid.length) {
    choices.length = 0;
    choices.push([...valid].sort((a, b) => low(a, b) || top(a.placement) - top(b.placement) || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x)[0]);
  }
  if (precise) for (const c of choices) {
    const box = stock.find((b) => b.id === c.placement.id), ctx2 = forBox(input, box, input.settings.maxCandidates), before = remainingSites(ctx2, input.placements), after = remainingSites(ctx2, [...input.placements, c.placement]), lostFraction = lostRemaining(ctx2, before, after);
    nodes += before.tested + after.tested;
    c.reservation = { before, after, lostFraction };
    c.remainingCheck = "checked";
    c.features.inventory = { ...c.features.inventory, fitFraction: after.fitFraction, opportunity: after.opportunity, types: after.types.map(({ id, quantity, fitSites, sampleSites }) => ({ id, quantity, fitSites, sampleSites })) };
    c.terms.reservation = input.settings.weights.inventory * (after.opportunity - before.opportunity - 2 * lostFraction);
    c.fastScore += c.terms.reservation;
    c.score = c.fastScore;
    if (input.algorithm === "rollout") {
      let available = stock.filter((b) => b.id !== box.id), placed = equilibrium([...input.placements, c.placement]).placements, added = 0, amount = 0;
      const sequence = [];
      for (let i = 0; i < Math.min(2, input.settings.depth) && available.length; i++) {
        const result = planCompactStock({ ...input, placements: placed, current: available[0], available, remaining: counts(available), algorithm: "greedy" }, false);
        nodes += result.nodes;
        rolloutCalls++;
        const next = result.candidates.find((v) => v.id === result.selectedId);
        if (!next) break;
        available = available.filter((b) => b.id !== next.placement.id);
        placed = equilibrium([...placed, next.placement]).placements;
        added++;
        amount += volume(next.placement.size);
        sequence.push(next.placement.typeId);
      }
      c.future = { added, volume: amount, finalHeight: Math.max(0, ...placed.map(top)), blocked: added < Math.min(2, input.settings.depth, stock.length - 1) ? 1 : 0, sequences: [sequence], policies: ["\uB0AE\uC740 \uBE48\uC790\uB9AC \uC6B0\uC120"] };
      c.score += input.settings.weights.future * (added / Math.max(1, Math.min(2, input.settings.depth)) + 0.5 * amount / (input.pallet.width * input.pallet.depth * input.pallet.maxHeight));
    }
  }
  const ranked = (precise ? choices : valid).sort(input.algorithm === "bl" ? (a, b) => low(a, b) || top(a.placement) - top(b.placement) || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x : quality);
  let selected2 = ranked[0], bufferPlan;
  if (precise && input.settings.temporaryBuffer) {
    const decision = chooseWithBuffer(input, selected2, valid, choices);
    selected2 = decision.selected;
    bufferPlan = decision.plan;
    nodes += decision.nodes;
    generated += decision.generated;
    capped ||= decision.capped;
    candidates2.push(...decision.extra);
  }
  const displayed = [];
  const keep = (c) => {
    if (c && !displayed.includes(c) && displayed.length < 96) displayed.push(c);
  };
  keep(selected2);
  choices.forEach(keep);
  for (const box of unique) {
    keep(valid.find((c) => c.placement.typeId === box.typeId));
    keep(candidates2.filter((c) => !c.valid && c.placement.typeId === box.typeId).sort((a, b) => b.placement.supportRatio - a.placement.supportRatio)[0]);
  }
  [...valid, ...candidates2.filter((c) => !c.valid)].forEach(keep);
  return { bufferPlan, runId: input.runId, stepId: input.stepId, selectedId: selected2?.id || null, selectedBoxId: selected2?.placement.id, stockSelection: { available: stock.length, checkedTypes: (/* @__PURE__ */ new Set([...unique.map((b) => b.typeId), ...selected2 ? [selected2.placement.typeId] : []])).size, deferred, foundation: 0, sizePriority: "low-space-fit", footprintMm2: selected2 ? selected2.placement.size.w * selected2.placement.size.d : void 0, volumeMm3: selected2 ? volume(selected2.placement.size) : void 0 }, candidates: displayed, checkedCandidates: candidates2.length, generated, valid: candidates2.filter((c) => c.valid).length, rejections, nodes, rolloutCalls, milliseconds: performance.now() - start2, capped, virtualSequences: selected2?.future?.sequences || [], explanation: selected2 ? [
    `\uC120\uD0DD \uAC00\uB2A5\uD55C \uC7AC\uACE0 ${stock.length}\uAC1C / ${new Set(stock.map((b) => b.typeId)).size}\uC885\uC758 \uBC15\uC2A4\uBCC4 \uD5C8\uC6A9 \uC790\uC138(\uCD5C\uB300 6\uC790\uC138)\uC640 \uC704\uCE58\uB97C \uD568\uAED8 \uAC80\uC0AC\uD588\uC2B5\uB2C8\uB2E4. \uC2E4\uC81C \uBBF8\uB798 \uC785\uACE0\uC5D0\uC11C \uBC15\uC2A4\uB97C \uAEBC\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`,
    ...bufferPlan?.addedIds.length ? [bufferPlan.held[0].reason] : [],
    ...bufferPlan?.held.length ? [`\uC784\uC2DC \uB300\uAE30 ${bufferPlan.held[0].observation.id}: \uC774\uBC88 \uBC30\uCE58 \uB4A4\uC5D0\uB3C4 \uC0C1\uB2E8 \uBCF5\uADC0 \uC704\uCE58 z=${bufferPlan.held[0].reservedTop.position.z} mm\uAC00 \uC720\uD6A8\uD569\uB2C8\uB2E4. \uB2E4\uC74C \uB2E8\uACC4\uC5D0 \uB2E4\uC2DC \uAC80\uC0AC\uD569\uB2C8\uB2E4.`] : [],
    ...bufferPlan?.releasedId ? [`\uC784\uC2DC \uB300\uAE30 ${bufferPlan.releasedId}\uB97C \uC678\uBD80 \uB300\uAE30\uB300\uC5D0\uC11C \uD68C\uC218\uD558\uC5EC \uD604\uC7AC \uCD5C\uC0C1\uB2E8\uC5D0 \uC801\uC7AC\uD569\uB2C8\uB2E4.`] : [],
    `\uC548\uC804 \uAC80\uC0AC\uB97C \uD1B5\uACFC\uD55C \uBC30\uCE58 \uC704\uCE58 z=${selected2.placement.position.z} mm\uB97C \uCC44\uC6C1\uB2C8\uB2E4. \uAC19\uC740 \uB192\uC774\uC5D0\uC11C\uB294 \uBA74\uC801\xB7\uBD80\uD53C\xB7\uC8FC\uBCC0 \uBC15\uC2A4 \uC811\uCD09\xB7\uB192\uC774\uB300\uBCC4 \uB0B4\uBD80 \uBE48 \uACF5\uAC04\xB7\uC794\uB7C9\uC758 \uD6C4\uC18D \uBC30\uCE58\uB97C \uBE44\uAD50\uD569\uB2C8\uB2E4.`,
    ...(input.constraints.standingHeight ?? DEFAULT_STANDING_HEIGHT).enabled ? [standingHeight(selected2.placement, input.placements, input.constraints).tall ? `\uC138\uB85C \uBC15\uC2A4 \uC0C1\uB2E8\uC744 \uC778\uC811\uD55C \uB215\uD78C \uC801\uC7AC \uB192\uC774\uC5D0 \uB9DE\uCDC4\uC2B5\uB2C8\uB2E4. \uB3CC\uCD9C ${standingHeight(selected2.placement, input.placements, input.constraints).riseMm.toFixed(0)} mm / \uD5C8\uC6A9 ${standingHeight(selected2.placement, input.placements, input.constraints).limitMm.toFixed(0)} mm.` : "\uB215\uD78C \uBC15\uC2A4\uB85C \uB0AE\uC740 \uACF5\uAC04\uACFC \uC8FC\uBCC0 \uCE35\uC744 \uCC44\uC6C1\uB2C8\uB2E4. \uB192\uC774\uAC00 \uB9DE\uC9C0 \uC54A\uB294 \uC138\uB85C \uBC15\uC2A4\uB294 \uC7AC\uACE0\uC5D0 \uBCF4\uB958\uD558\uACE0 \uB2E4\uC74C \uB2E8\uACC4\uC5D0 \uB2E4\uC2DC \uAC80\uC0AC\uD569\uB2C8\uB2E4."] : [],
    `\uD55C \uBC1B\uCE68 \uC911\uC559 \uC815\uB82C\uC774\uB098 \uD070 \uBC15\uC2A4 \uC21C\uC11C\uB97C \uAC15\uC81C\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB0AE\uC740 \uD2C8\uC5D0 \uB9DE\uB294 \uC791\uC740 \uBC15\uC2A4\uAC00 \uB192\uC740 \uACF3\uC758 \uD070 \uBC15\uC2A4\uBCF4\uB2E4 \uBA3C\uC800 \uC120\uD0DD\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.`,
    `\uC9C0\uC9C0 ${(selected2.placement.supportRatio * 100).toFixed(1)}% / \uBC1B\uCE68 ${selected2.placement.supports.length}\uAC1C. \uB2E4\uC911 \uBC1B\uCE68\uB3C4 \uAC19\uC740 \uBC18\uB825\xB7\uBB34\uAC8C\uC911\uC2EC\xB7\uB204\uC801 \uD558\uC911\xB7\uC811\uADFC \uAC80\uC0AC\uB97C \uD1B5\uACFC\uD574\uC57C \uD569\uB2C8\uB2E4. \uC11C\uB85C \uB2E4\uB978 \uB192\uC774\uB97C \uD3C9\uD0C4\uD558\uAC8C \uBCF4\uC815\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`,
    `\uC885\uB958\uBCC4 \uCD5C\uB300 32\uACF3 \uC0AC\uC804 \uAC80\uC0AC \u2192 \uC0C1\uC704 4\uC885 \uCD5C\uB300 ${input.settings.maxCandidates}\uACF3 \u2192 \uCD5C\uB300 ${input.settings.topK}\uAC1C \uC120\uD0DD \uD6C4\uBCF4\uC758 \uC794\uB7C9 \uACF5\uAC04 \uAC80\uC0AC. \uD45C\uBCF8 \uD0D0\uC0C9\uC774\uBA70 \uCD5C\uB300 \uC801\uC7AC\uC758 \uBCF4\uC7A5\uC740 \uC544\uB2D9\uB2C8\uB2E4.`,
    `\uC774\uBC88 \uB2E8\uACC4\uC758 \uCD5C\uC885 \uD6C4\uBCF4\uAD70 ${candidates2.length}\uACF3 \uC911 \uC120\uD0DD\xB7\uBE44\uAD50\xB7\uC885\uB958\uBCC4 \uB300\uD45C \uD6C4\uBCF4 ${displayed.length}\uACF3\uC744 \uD504\uB808\uC784\uC5D0 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4. \uD0C8\uB77D \uC0AC\uC720 \uC9D1\uACC4\uB294 \uC804\uCCB4 \uAC80\uC0AC \uAE30\uC900\uC785\uB2C8\uB2E4.`
  ] : [`\uB0A8\uC740 \uC7AC\uACE0 ${stock.length}\uAC1C / ${unique.length}\uC885\uC758 \uAC80\uD1A0 \uD6C4\uBCF4\uC5D0\uC11C \uC720\uD6A8 \uBC30\uCE58\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC81C\uC57D\uC744 \uB0AE\uCD94\uAC70\uB098 \uB0A8\uC740 \uBC15\uC2A4\uB97C \uC0AD\uC81C\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`] };
}

// src/engine/vendor/pallet/stockPlanner.ts
function remaining(stock) {
  const counts2 = {};
  for (const b of stock) counts2[b.typeId] = (counts2[b.typeId] || 0) + 1;
  return counts2;
}
function forBox2(input, box, maxCandidates, precise) {
  return { ...input, available: void 0, current: box, remaining: remaining(input.available.filter((b) => b.id !== box.id)), settings: { ...input.settings, policy: "legacy", maxCandidates, inventoryMode: precise ? input.settings.inventoryMode : "none" } };
}
function foundation(input, box, size, orientation) {
  const capacity = materialInfo({ ...box, orientation }, input.constraints.stability).capacity;
  if (capacity === null || capacity === 0 || box.handling === "no-top-load") return 0;
  let demand = 0, covered = 0;
  for (const other of input.available) {
    if (other.id === box.id) continue;
    const v = volume(other.size);
    demand += v;
    if (other.weight <= capacity && allowedOrientations(other.size, other.orientationAllowed, other.handling, other.maxLoadByAxis).some((o) => {
      const s = oriented(other.size, o);
      return s.w <= size.w && s.d <= size.d;
    })) covered += v;
  }
  if (!demand) return 0;
  return (0.75 * covered / demand + 0.25 * size.w * size.d / (input.pallet.width * input.pallet.depth)) * Math.min(1, Math.min(size.w, size.d) / size.h);
}
function score(input, box, c) {
  const potential = foundation(input, box, c.placement.size, c.placement.orientation), bonus = 45 * potential * (1 - c.placement.position.z / input.pallet.maxHeight), lowerBalance = -2 * (input.settings.weights.balance + input.settings.weights.stability) * (c.features.lowerBalance ?? 0);
  c.terms.foundation += bonus;
  c.terms.lowerBalance = lowerBalance;
  c.fastScore += bonus + lowerBalance;
  c.score = c.fastScore;
  return potential;
}
var fullSeat = (c) => c.placement.position.z === 0 || c.placement.supports.some((s) => s.area >= c.placement.size.w * c.placement.size.d - EPS);
var lowerCenter = (a, b) => {
  const delta = (a.features.lowerBalance ?? 0) - (b.features.lowerBalance ?? 0);
  return Math.abs(delta) > EPS ? delta : 0;
};
var order2 = (a, b) => b.placement.size.w * b.placement.size.d - a.placement.size.w * a.placement.size.d || volume(b.placement.size) - volume(a.placement.size) || Number(fullSeat(b)) - Number(fullSeat(a)) || lowerCenter(a, b) || b.score - a.score || top(a.placement) - top(b.placement) || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x || a.placement.id.localeCompare(b.placement.id);
function planStock(input, precise = true) {
  if (input.settings.stockPolicy === "compact") return planCompactStock(input, precise);
  const start2 = performance.now(), stock = input.available, unique = stock.filter((b, i) => stock.findIndex((a) => a.typeId === b.typeId) === i), deferred = [], options = [];
  let generated = 0, nodes = 0, capped = false;
  const rejections = {};
  for (const box2 of unique) {
    const root2 = candidateSet(forBox2(input, box2, Math.min(input.settings.maxCandidates, 16), false), true);
    generated += root2.generated;
    nodes += root2.candidates.length;
    capped ||= root2.capped;
    root2.candidates.forEach((c) => {
      c.id = `${box2.id}:${c.id}`;
      if (c.valid) score(input, box2, c);
      for (const reason of c.reasons) {
        const key = reason.split(" \xB7 ")[0].replace(/\([^)]*\)/g, "").trim();
        rejections[key] = (rejections[key] || 0) + 1;
      }
    });
    const valid2 = root2.candidates.filter((c) => c.valid).sort(order2);
    if (valid2.length) options.push({ box: box2, best: valid2[0], candidates: root2.candidates });
    else deferred.push({ id: box2.typeId, reason: [...new Set(root2.candidates.flatMap((c) => c.reasons))].join(" / ") || "\uD604\uC7AC \uAC80\uD1A0 \uC704\uCE58\uC5D0 \uC720\uD6A8 \uD6C4\uBCF4 \uC5C6\uC74C" });
  }
  options.sort((a, b) => order2(a.best, b.best));
  let candidates2 = [];
  if (precise) for (const option of options.slice(0, 3)) {
    const root2 = candidateSet(forBox2(input, option.box, Math.min(input.settings.maxCandidates, 24), true), true);
    generated += root2.generated;
    nodes += root2.candidates.length;
    capped ||= root2.capped;
    for (const c of root2.candidates) {
      c.id = `${option.box.id}:${c.id}`;
      if (c.valid) score(input, option.box, c);
    }
    candidates2.push(...root2.candidates);
  }
  else candidates2 = options.flatMap((o) => o.candidates);
  const valid = candidates2.filter((c) => c.valid).sort(order2);
  let shortlist2 = valid.slice(0, Math.min(6, input.settings.topK)), rolloutCalls = 0;
  if (precise && input.algorithm === "rollout") for (const c of shortlist2) {
    let available = stock.filter((b) => b.id !== c.placement.id), placed = [...input.placements, c.placement], added = 0, v = 0;
    const sequence = [];
    for (let depth = 0; depth < Math.min(2, input.settings.depth) && available.length; depth++) {
      const future = planStock({ ...input, algorithm: "greedy", placements: placed, current: available[0], available, remaining: remaining(available) }, false);
      nodes += future.nodes;
      rolloutCalls++;
      const choice = future.candidates.find((c2) => c2.id === future.selectedId);
      if (!choice) break;
      available = available.filter((b) => b.id !== choice.placement.id);
      placed.push(choice.placement);
      added++;
      v += volume(choice.placement.size);
      sequence.push(choice.placement.typeId);
    }
    c.future = { added, volume: v, finalHeight: Math.max(0, ...placed.map(top)), blocked: added < Math.min(2, input.settings.depth, stock.length - 1) ? 1 : 0, sequences: [sequence], policies: ["\uC7AC\uACE0 \uC120\uD0DD"] };
    c.score = c.fastScore + input.settings.weights.future * added / Math.max(1, Math.min(2, input.settings.depth));
  }
  if (!shortlist2.length) shortlist2 = valid;
  let ranked = (input.algorithm === "rollout" ? shortlist2 : valid).sort(order2);
  if (input.algorithm === "bl" && valid.length) {
    const pool = valid.filter((c) => c.placement.typeId === valid[0].placement.typeId), fit = Math.max(0, ...pool.map((c) => c.features.inventory.fitFraction));
    ranked = pool.filter((c) => c.features.inventory.fitFraction >= fit - 1e-6).sort((a, b) => top(a.placement) - top(b.placement) || (a.features.lowerBalance ?? 0) - (b.features.lowerBalance ?? 0) || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x);
  }
  const selected2 = ranked[0], box = stock.find((b) => b.id === selected2?.placement.id);
  if (!candidates2.length) candidates2 = unique.flatMap((box2) => candidateSet(forBox2(input, box2, 2, false), true).candidates.map((c) => ({ ...c, id: `${box2.id}:${c.id}` })));
  const potential = selected2 && box ? foundation(input, box, selected2.placement.size, selected2.placement.orientation) : 0;
  const explanation = selected2 ? [
    `\uC120\uD0DD \uAC00\uB2A5\uD55C \uC7AC\uACE0 ${stock.length}\uAC1C / ${unique.length}\uC885\uC744 \uAC80\uC0AC\uD558\uACE0 ${box.id}\uC758 \uC21C\uC11C\uC640 \uBC30\uCE58 \uC704\uCE58\uB97C \uD568\uAED8 \uC120\uD0DD\uD588\uC2B5\uB2C8\uB2E4.`,
    `\uC548\uC804 \uC81C\uC57D\uC744 \uD1B5\uACFC\uD55C \uBC15\uC2A4 \uC911 \uBC14\uB2E5 \uBA74\uC801\uC774 \uD070 \uC21C\uC11C, \uAC19\uC740 \uBA74\uC801\uC774\uBA74 \uBD80\uD53C\uAC00 \uD070 \uC21C\uC11C\uB85C \uC120\uD0DD\uD569\uB2C8\uB2E4. \uC120\uD0DD \uBA74\uC801 ${(selected2.placement.size.w * selected2.placement.size.d / 1e6).toFixed(3)} m\xB2 / \uBD80\uD53C ${(volume(selected2.placement.size) / 1e9).toFixed(3)} m\xB3.`,
    `\uC544\uB7AB\uB2E8\uB9C8\uB2E4 \uC790\uCCB4 \uBB34\uAC8C\uC640 \uC704\uC5D0\uC11C \uC804\uB2EC\uB41C \uD558\uC911\uC758 \uC911\uC2EC\uC744 \uB2E4\uC2DC \uACC4\uC0B0\uD569\uB2C8\uB2E4. \uBC1B\uCE68 \uC911\uC2EC\uC5D0\uC11C\uC758 \uCE58\uC6B0\uCE68 ${(100 * (selected2.features.lowerBalance ?? 0)).toFixed(1)}%\uB97C \uBC30\uCE58 \uC810\uC218\uC5D0 \uBC18\uC601\uD558\uACE0, \uBAA8\uB4E0 \uC811\uCD09\uBA74\uC758 \uC804\uB3C4 \uC5EC\uC720\uC640 \uAC15\uB3C4\uB97C \uC7AC\uAC80\uC0AC\uD569\uB2C8\uB2E4.`,
    ...input.algorithm === "bl" ? [] : [`\uAC19\uC740 \uD06C\uAE30 \uBC15\uC2A4\uC758 \uC704\uCE58\uB294 \uC804\uCCB4 \uBC14\uB2E5\uC744 \uC9C0\uC9C0\uD558\uB294 \uD55C \uBC1B\uCE68 \u2192 \uC544\uB7AB\uB2E8 \uB204\uC801 \uD558\uC911 \uC911\uC2EC \uC815\uB82C \u2192 \uC885\uD569 \uC810\uC218 \uC21C\uC73C\uB85C \uBE44\uAD50\uD569\uB2C8\uB2E4. \uB2E8\uC77C \uBC1B\uCE68 \uD6C4\uBCF4\uAC00 \uC5C6\uC73C\uBA74 \uAE30\uC874 \uC9C0\uC9C0 \uC870\uAC74\uC744 \uD1B5\uACFC\uD55C \uB2E4\uC911 \uBC1B\uCE68\uB3C4 \uAC80\uD1A0\uD569\uB2C8\uB2E4.`],
    `\uB113\uC740 \uBC1B\uCE68\xB7\uBC15\uC2A4\uBCC4 \uD5C8\uC6A9 \uD558\uC911\xB7\uB0A8\uC740 \uBC15\uC2A4\uAC00 \uC62C\uB77C\uAC08 \uCE58\uC218\uB85C \uBC1B\uCE68 \uAE30\uD68C ${(potential * 100).toFixed(1)}%\uB97C \uD3C9\uAC00\uD588\uC2B5\uB2C8\uB2E4. \uC7AC\uC9C8 \uC774\uB984\uB9CC\uC73C\uB85C \uD558\uB2E8\uC744 \uC815\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`,
    `\uD604\uC7AC \uB193\uC774\uC9C0 \uC54A\uB294 ${deferred.length}\uC885\uC740 \uC7AC\uACE0\uC5D0 \uC720\uC9C0\uD558\uACE0, \uB2E4\uB978 \uAC00\uB2A5\uD55C \uBC15\uC2A4\uB97C \uBA3C\uC800 \uBC30\uCE58\uD569\uB2C8\uB2E4. \uD558\uBD80\uAC00 \uB9CC\uB4E4\uC5B4\uC9C4 \uB2E4\uC74C \uB2E8\uACC4\uC5D0\uC11C \uB2E4\uC2DC \uAC80\uC0AC\uD569\uB2C8\uB2E4.`,
    `\uC885\uB958\uBCC4 \uC704\uCE58 \uD6C4\uBCF4 \uCD5C\uB300 16\uAC1C\uB85C \uC0AC\uC804 \uD3C9\uAC00, \uC0C1\uC704 3\uC885\uC740 \uCD5C\uB300 24\uAC1C \uC704\uCE58\uC5D0\uC11C \uC794\uB7C9 \uACF5\uAC04\uAE4C\uC9C0 \uC0C1\uC138 \uD3C9\uAC00\uD569\uB2C8\uB2E4.${input.algorithm === "rollout" ? " \uC120\uD0DD \uD6C4\uBCF4\uC758 \uD6C4\uC18D \uC7AC\uACE0 \uC120\uD0DD\uB3C4 \uCD5C\uB300 2\uB2E8\uACC4 \uAC80\uC0AC\uD569\uB2C8\uB2E4." : ""}`
  ] : [`\uB0A8\uC740 \uC7AC\uACE0 ${stock.length}\uAC1C / ${unique.length}\uC885\uC744 \uBAA8\uB450 \uAC80\uC0AC\uD588\uC9C0\uB9CC \uD604\uC7AC \uAC80\uD1A0 \uC704\uCE58\uC5D0\uC11C \uC720\uD6A8 \uBC30\uCE58\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uB193\uC774\uC9C0 \uC54A\uB294 \uC7AC\uACE0\uB97C \uC0AD\uC81C\uD558\uAC70\uB098 \uC81C\uC57D\uC744 \uB0AE\uCD94\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`];
  return { runId: input.runId, stepId: input.stepId, selectedId: selected2?.id || null, selectedBoxId: box?.id, stockSelection: { available: stock.length, checkedTypes: unique.length, deferred, foundation: potential, sizePriority: "footprint-volume", footprintMm2: selected2 ? selected2.placement.size.w * selected2.placement.size.d : void 0, volumeMm3: selected2 ? volume(selected2.placement.size) : void 0 }, candidates: candidates2, generated, valid: valid.length, rejections, nodes, rolloutCalls, milliseconds: performance.now() - start2, capped, explanation, virtualSequences: selected2?.future?.sequences || [] };
}

// src/engine/vendor/pallet/onlinePlanner.ts
var bottom = (a, b) => top(a.placement) - top(b.placement) || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x || orientationRank(a.placement.orientation) - orientationRank(b.placement.orientation);
var quality2 = (a, b) => b.score - a.score || bottom(a, b);
var preserve = (a, b) => (a.reservation?.lostFraction ?? 0) - (b.reservation?.lostFraction ?? 0) || quality2(a, b);
function shortlist(valid, limit, pallet) {
  const ranked = [...valid].sort(quality2), chosen = ranked.slice(0, Math.min(2, limit)), groups = /* @__PURE__ */ new Map();
  const baseline = [...valid].sort(bottom)[0];
  if (baseline && !chosen.includes(baseline) && chosen.length < limit) chosen.push(baseline);
  for (const c of ranked) {
    const p = c.placement, q = Number(p.position.x + p.size.w / 2 >= pallet.width / 2) + 2 * Number(p.position.y + p.size.d / 2 >= pallet.depth / 2), key = `${p.position.z}:${p.orientation}:${p.supports.map((s) => s.id).sort().join(",")}:${q}`;
    groups.set(key, [...groups.get(key) || [], c]);
  }
  for (let i = 0; chosen.length < limit; i++) {
    let found = false;
    for (const list of groups.values()) if (list[i] && !chosen.includes(list[i]) && chosen.length < limit) {
      chosen.push(list[i]);
      found = true;
    }
    if (!found && i >= ranked.length) break;
  }
  return chosen;
}
function reserve(input, c, before) {
  const after = remainingSites(input, [...input.placements, c.placement]), lostFraction = lostRemaining(input, before, after), term = input.settings.weights.inventory * (after.opportunity - before.opportunity - 2 * lostFraction);
  c.remainingCheck = "checked";
  c.reservation = { before, after, lostFraction };
  c.features.inventory = { ...c.features.inventory, opportunity: after.opportunity, fitFraction: after.fitFraction, types: after.types.map(({ id, quantity, fitSites, sampleSites }) => ({ id, quantity, fitSites, sampleSites })) };
  c.terms.reservation = term;
  c.fastScore += term;
  c.score = c.fastScore;
  return after.tested;
}
function planOnline(input) {
  if (input.available) throw Error("\uC628\uB77C\uC778 \uACC4\uD68D\uAE30\uC5D0\uB294 \uD604\uC7AC \uB3C4\uCC29 \uBC15\uC2A4\uC640 \uBBF8\uC785\uACE0 \uC218\uB7C9\uB9CC \uC804\uB2EC\uD569\uB2C8\uB2E4.");
  const start2 = performance.now(), fastInput = { ...input, settings: { ...input.settings, inventoryMode: "none" } }, root2 = candidateSet(fastInput, true), valid = root2.candidates.filter((c) => c.valid), rejections = {};
  for (const c of root2.candidates) for (const reason of c.reasons) {
    const key = reason.split(" \xB7 ")[0].replace(/\([^)]*\)/g, "").trim();
    rejections[key] = (rejections[key] || 0) + 1;
  }
  let nodes = root2.candidates.length, rolloutCalls = 0, reserveChecks = 0, selected2, sequences = [];
  if (valid.length) {
    const before = remainingSites(input, input.placements);
    reserveChecks += before.tested;
    const choices = input.algorithm === "bl" ? [[...valid].sort(bottom)[0]] : shortlist(valid, input.settings.topK, input.pallet);
    for (const c of choices) reserveChecks += reserve(input, c, before);
    if (input.algorithm === "rollout") {
      sequences = virtualSequences(input);
      const targetDepth = Math.max(1, sequences[0]?.length || 0), maxVolume = Math.max(1, ...sequences.map((s) => s.reduce((n2, id) => n2 + volume(input.types.find((t) => t.id === id).size), 0)));
      for (const c of choices) {
        let added = 0, v = 0, height = 0, blocked = 0;
        for (const sequence of sequences) {
          let placed = [...input.placements, c.placement], count = 0, amount = 0;
          const remaining2 = { ...input.remaining };
          for (const id of sequence) {
            remaining2[id]--;
            const type = input.types.find((t) => t.id === id), current = virtualObservation(type, `virtual-${count}-${id}`), future = candidateSet({ ...fastInput, current, remaining: remaining2, placements: placed, algorithm: "greedy", settings: { ...fastInput.settings, maxCandidates: input.settings.virtualCandidates ?? 16 } }, true);
            nodes += future.candidates.length;
            rolloutCalls++;
            const choice = future.candidates.filter((c2) => c2.valid).sort(quality2)[0];
            if (!choice) break;
            placed = equilibrium([...placed, choice.placement]).placements;
            count++;
            amount += volume(current.size);
          }
          added += count;
          v += amount;
          height += Math.max(0, ...placed.map(top));
          if (count < sequence.length) blocked++;
        }
        const samples = Math.max(1, sequences.length);
        c.future = { added: added / samples, volume: v / samples, finalHeight: height / samples, blocked: blocked / samples, sequences, policies: ["\uD604\uC7AC \uAD00\uCE21\uB9CC \uC4F0\uB294 \uACE0\uC815 Greedy"] };
        const f = c.future;
        c.score = c.fastScore + input.settings.weights.future * (0.55 * f.added / targetDepth + 0.2 * f.volume / maxVolume + 0.15 * (1 - f.finalHeight / input.pallet.maxHeight) - 0.35 * f.blocked);
      }
      selected2 = choices.sort((a, b) => a.reservation.lostFraction - b.reservation.lostFraction || a.future.blocked - b.future.blocked || b.future.added - a.future.added || quality2(a, b))[0];
    } else selected2 = input.algorithm === "bl" ? choices[0] : choices.sort(preserve)[0];
  }
  nodes += reserveChecks;
  const explanation = [
    `\uC628\uB77C\uC778 \uC21C\uCC28 \uD22C\uC785: \uD604\uC7AC \uAD00\uCE21 ${input.current.id}\uB9CC \uBC30\uCE58\uD569\uB2C8\uB2E4. \uBBF8\uC785\uACE0 ${Object.values(input.remaining).reduce((a, b) => a + b, 0)}\uAC1C\uB294 \uC885\uB958\uBCC4 \uC218\uB7C9\uB9CC \uACF5\uAC1C\uD558\uBA70 \uC2E4\uC81C \uBBF8\uB798 \uC21C\uC11C\uB294 \uC77D\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`,
    `\uBAA8\uB4E0 \uD6C4\uBCF4\uC5D0\uC11C \uAD00\uD1B5\xB7\uB3CC\uCD9C\xB7\uB192\uC774\xB7\uBC29\uD5A5\xB7\uC9C0\uC9C0\xB7\uC544\uB7AB\uB2E8 \uBC18\uB825\xB7\uAC15\uB3C4\uC640 ${input.constraints.heavyRule === "each" ? "\uBAA8\uB4E0 \uC9C1\uACC4 \uBC1B\uCE68\uBCF4\uB2E4 \uBB34\uAC81\uC9C0 \uC54A\uC740 \uC870\uAC74" : input.constraints.heavyRule === "share" ? "\uBC1B\uCE68\uBCC4 \uBD84\uB2F4 \uBB34\uAC8C \uC870\uAC74" : "\uC0AC\uC6A9\uC790\uAC00 \uB048 \uBB34\uAC8C \uC21C\uC11C \uADDC\uCE59"}\uC744 \uAC80\uC0AC\uD569\uB2C8\uB2E4. ${input.constraints.robotMode === "ideal" ? "\uD604\uC7AC\uB294 \uC774\uC0C1\uC801 \uC5F0\uAD6C \uBAA8\uB4DC\uB85C \uADF8\uB9AC\uD37C \uAC80\uC0AC\uB97C \uC81C\uC678\uD588\uC2B5\uB2C8\uB2E4." : "\uAC00\uBC18\uD558\uC911\xB7\uC791\uC5C5\uACF5\uAC04\xB7\uC704\uCABD \uC811\uADFC\xB7\uC774\uD0C8 \uC2A4\uC715\uC744 \uAC80\uC0AC\uD569\uB2C8\uB2E4. \uB85C\uBD07 \uAD00\uC808\xB7IK\uB294 \uBBF8\uAC80\uC99D\uC785\uB2C8\uB2E4."}`,
    ...selected2 ? [
      `${valid.length}\uAC1C \uC720\uD6A8 \uD6C4\uBCF4 \uC911 ${input.algorithm === "bl" ? "\uCD5C\uC800 \uB192\uC774 \u2192 y \u2192 x" : input.algorithm === "greedy" ? "\uAE30\uC874 \uD6C4\uC18D \uACF5\uAC04 \uC190\uC2E4 \uCD5C\uC18C \u2192 \uD488\uC9C8 \uC810\uC218" : "\uD6C4\uC18D \uACF5\uAC04 \uC190\uC2E4 \uCD5C\uC18C \u2192 \uAC00\uC0C1 \uB9C9\uD798 \uCD5C\uC18C \u2192 \uAC00\uC0C1 \uCD94\uAC00 \uC801\uC7AC \u2192 \uC810\uC218"}\uB85C \uC120\uD0DD\uD588\uC2B5\uB2C8\uB2E4.`,
      `\uC794\uB7C9 \uC704\uCE58 \uD45C\uBCF8 ${reserveChecks}\uAC1C\uC5D0 \uC2E4\uC81C \uBC30\uCE58\uC640 \uAC19\uC740 \uD558\uB4DC \uAC80\uC0AC\uB97C \uC801\uC6A9\uD588\uC2B5\uB2C8\uB2E4. \uC120\uD0DD \uD6C4 \uD45C\uBCF8\uC774 \uC788\uB294 \uBB3C\uB7C9 ${(selected2.reservation.after.fitFraction * 100).toFixed(1)}%, \uC774\uBC88 \uBC30\uCE58\uB85C \uD45C\uBCF8\uC744 \uC783\uB294 \uBB3C\uB7C9 ${(selected2.reservation.lostFraction * 100).toFixed(1)}%\uC785\uB2C8\uB2E4. \uC804\uCCB4 \uBB3C\uB7C9\uC744 \uB3D9\uC2DC\uC5D0 \uB193\uC744 \uC218 \uC788\uB2E4\uB294 \uBCF4\uC7A5\uC740 \uC544\uB2D9\uB2C8\uB2E4.`,
      `\uC544\uB7AB\uB2E8 \uC911\uC2EC \uCE58\uC6B0\uCE68 \uC9C0\uC218 ${((selected2.features.lowerBalance ?? 0) * 100).toFixed(1)}% \xB7 \uC0C1\uBD80 \uD558\uC911 \uCD5C\uB300 \uC0AC\uC6A9 ${(selected2.features.loadUtilization * 100).toFixed(1)}% \xB7 ${selected2.path.model === "ideal" ? "\uB85C\uBD07 \uC2DC\uAC04 \uBBF8\uD3C9\uAC00" : `\uC791\uC5C5 \uC608\uC0C1 ${selected2.path.seconds.toFixed(2)}\uCD08`}.`,
      ...selected2.future ? [`\uB0A8\uC740 \uC218\uB7C9\uC5D0\uC11C \uB9CC\uB4E0 \uAC00\uC0C1 \uC21C\uC11C ${sequences.length}\uAC1C\uB97C \uD6C4\uBCF4\uB9C8\uB2E4 \uB611\uAC19\uC774 \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4. \uACE0\uC815\uB41C \uC778\uACFC\uC801 \uD6C4\uC18D \uC815\uCC45\uC758 \uD3C9\uADE0 \uCD94\uAC00 ${selected2.future.added.toFixed(2)}\uAC1C, \uB9C9\uD798 ${(selected2.future.blocked * 100).toFixed(1)}%. \uC2E4\uC81C \uB2E4\uC74C \uC785\uACE0\uC758 \uC608\uCE21\uAC12\uC774 \uC544\uB2D9\uB2C8\uB2E4.`] : []
    ] : [`\uD604\uC7AC \uC815\uC0C1 \uBC15\uC2A4\uC758 \uAC80\uD1A0 \uC704\uCE58\uC5D0 \uC720\uD6A8 \uBC30\uCE58\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC74C \uBC15\uC2A4\uB97C \uBA3C\uC800 \uAEBC\uB0B4\uAC70\uB098 \uC815\uC0C1 \uBC15\uC2A4\uB97C \uC0AD\uC81C\uD558\uC9C0 \uC54A\uACE0 \uC774 \uB2E8\uACC4\uC5D0\uC11C \uBA48\uCDA5\uB2C8\uB2E4.`],
    ...input.current.status === "resized" ? [`\uADDC\uACA9 \uC218\uC815 \uAD00\uCE21 ${input.current.size.w}\xD7${input.current.size.d}\xD7${input.current.size.h}mm\uB85C \uD604\uC7AC \uD6C4\uBCF4\uC640 \uBBF8\uD655\uC815 \uD6C4\uC18D \uD328\uD134\uC744 \uB2E4\uC2DC \uACC4\uC0B0\uD588\uC2B5\uB2C8\uB2E4. \uD655\uC815 \uBC30\uCE58\uB294 \uC774\uB3D9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`] : []
  ];
  return { runId: input.runId, stepId: input.stepId, selectedId: selected2?.id || null, selectedBoxId: selected2 ? input.current.id : void 0, online: { currentOnly: true, futureSource: "remaining-counts", robot: input.constraints.robotMode === "ideal" ? "ideal" : "gripper-proxy", heavyRule: input.constraints.heavyRule, reserveChecks, policy: "causal-greedy" }, candidates: root2.candidates, generated: root2.generated, valid: valid.length, rejections, nodes, rolloutCalls, milliseconds: performance.now() - start2, capped: root2.capped, explanation, virtualSequences: sequences };
}

// src/engine/vendor/pallet/planner.ts
var bottomLeft = (a, b) => top(a.placement) - top(b.placement) || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x || orientationRank(a.placement.orientation) - orientationRank(b.placement.orientation);
var fastOrder = (a, b) => b.fastScore - a.fastScore || bottomLeft(a, b);
function virtualSequences(input) {
  const pool = input.types.flatMap((t) => Array.from({ length: input.remaining[t.id] || 0 }, () => t.id));
  const random = rng((input.settings.plannerSeed ^ Math.imul(input.stepId + 1, 2654435761)) >>> 0);
  return Array.from({ length: input.settings.samples }, () => shuffled(pool, random).slice(0, input.settings.depth));
}
function chooseBaseline(valid) {
  const bestFit = Math.max(0, ...valid.map((c) => c.features.inventory.fitFraction));
  const viable = valid.filter((c) => c.features.inventory.fitFraction >= bestFit - 1e-6), opportunity = Math.max(0, ...viable.map((c) => c.features.inventory.opportunity));
  return viable.filter((c) => c.features.inventory.opportunity >= opportunity - 0.02).sort(bottomLeft)[0];
}
function diverseShortlist(valid, limit) {
  const ranked = [...valid].sort(fastOrder), chosen = ranked.slice(0, Math.min(2, limit)), baseline = chooseBaseline(valid);
  if (baseline && !chosen.includes(baseline) && chosen.length < limit) chosen.push(baseline);
  const groups = /* @__PURE__ */ new Map();
  for (const c of ranked) {
    const key = `${c.placement.position.z}:${c.placement.orientation}:${c.placement.supports.map((s) => s.id).sort().join(",")}`;
    groups.set(key, [...groups.get(key) || [], c]);
  }
  for (let i = 0; chosen.length < limit; i++) {
    let any = false;
    for (const list of groups.values()) {
      const c = list[i];
      if (c && !chosen.includes(c) && chosen.length < limit) {
        chosen.push(c);
        any = true;
      }
    }
    if (!any && i >= ranked.length) break;
  }
  return chosen;
}
function plan(input) {
  return input.algorithm === "random" ? planRandom(input) : isStrategy(input.algorithm) ? planStrategy(input) : input.available ? planStock(input) : input.settings.policy === "online" ? planOnline(input) : planArrival(input);
}
function planArrival(input) {
  const start2 = performance.now(), root2 = candidateSet(input), valid = root2.candidates.filter((c) => c.valid);
  let nodes = root2.candidates.length, rolloutCalls = 0;
  const sequences = input.algorithm === "rollout" ? virtualSequences(input) : [];
  let selected2;
  if (input.algorithm === "bl") selected2 = chooseBaseline(valid);
  else if (input.algorithm === "greedy") selected2 = [...valid].sort(fastOrder)[0];
  else {
    const portfolio = input.settings.portfolio ?? false, policies = portfolio ? ["greedy", "bl"] : ["greedy"];
    const shortlist2 = portfolio ? diverseShortlist(valid, input.settings.topK) : [...valid].sort(fastOrder).slice(0, input.settings.topK);
    for (const candidate of shortlist2) {
      let added = 0, totalVolume = 0, finalHeight = 0, blocked = 0;
      for (const sequence of sequences) {
        const outcomes = [];
        for (const policy of policies) {
          let placed = [...input.placements, candidate.placement], n2 = 0, v = 0;
          const remaining2 = { ...input.remaining };
          for (const typeId of sequence) {
            remaining2[typeId]--;
            const type = input.types.find((t) => t.id === typeId);
            const current = { id: `virtual-${n2}-${typeId}`, typeId, size: type.size, weight: type.weight, status: "normal", orientationAllowed: type.orientations, packaging: type.packaging, maxLoadKg: type.maxLoadKg, maxLoadSource: type.maxLoadSource, maxLoadByAxis: type.maxLoadByAxis, handling: type.handling, material: type.material, strengthFactor: type.strengthFactor, friction: type.friction };
            const future = candidateSet({ ...input, current, remaining: remaining2, placements: placed, algorithm: policy, settings: { ...input.settings, maxCandidates: Math.min(input.settings.maxCandidates, input.settings.virtualCandidates ?? input.settings.maxCandidates) } });
            nodes += future.candidates.length;
            rolloutCalls++;
            const available = future.candidates.filter((c) => c.valid), chosen = policy === "bl" ? chooseBaseline(available) : available.sort(fastOrder)[0];
            if (!chosen) break;
            placed = [...placed, chosen.placement];
            n2++;
            v += volume(current.size);
          }
          outcomes.push({ n: n2, v, height: Math.max(0, ...placed.map(top)) });
        }
        const best = outcomes.sort((a, b) => b.n - a.n || b.v - a.v || a.height - b.height)[0];
        added += best.n;
        totalVolume += best.v;
        finalHeight += best.height;
        if (best.n < sequence.length) blocked++;
      }
      const count = Math.max(1, sequences.length), depth = Math.max(1, sequences[0]?.length || 0), maxVolume = Math.max(1, ...sequences.map((seq) => seq.reduce((s, id) => s + volume(input.types.find((t) => t.id === id).size), 0)));
      candidate.future = { added: added / count, volume: totalVolume / count, finalHeight: finalHeight / count, blocked: blocked / count, sequences, policies: [...policies] };
      const f = candidate.future;
      candidate.score = candidate.fastScore + input.settings.weights.future * (0.55 * f.added / depth + 0.2 * f.volume / maxVolume + 0.15 * (1 - f.finalHeight / input.pallet.maxHeight) - 0.35 * f.blocked);
    }
    selected2 = shortlist2.sort((a, b) => portfolio ? a.future.blocked - b.future.blocked || b.future.added - a.future.added || b.score - a.score || bottomLeft(a, b) : b.score - a.score || bottomLeft(a, b))[0];
  }
  const rejections = {};
  for (const c of root2.candidates) for (const reason of c.reasons) {
    const key = reason.split(" \xB7 ")[0].replace(/\([^)]*\)/g, "").trim();
    rejections[key] = (rejections[key] || 0) + 1;
  }
  const explanation = selected2 ? [`\uC720\uD6A8 \uD6C4\uBCF4 ${valid.length}\uAC1C \uC911 ${input.algorithm === "bl" ? "\uC794\uB7C9 \uACF5\uAC04 \uBCF4\uC874 \uD6C4 \uCD5C\uC800 \uB192\uC774 \u2192 y \u2192 x" : input.algorithm === "greedy" ? "\uC794\uB7C9\xB7\uC7AC\uC9C8\xB7\uC548\uC815\uC131\uC744 \uD3EC\uD568\uD55C \uD3C9\uAC00 \uC810\uC218 \uCD5C\uB300" : input.settings.portfolio ? "\uAC00\uC0C1 \uB9C9\uD798 \uCD5C\uC18C \u2192 \uD3C9\uADE0 \uCD94\uAC00 \uC801\uC7AC \uCD5C\uB300 \u2192 \uD569\uC0B0 \uC810\uC218" : "\uAC00\uC0C1 \uC21C\uC11C \uD3C9\uADE0 \uC810\uC218"}\uB85C \uC120\uD0DD\uD588\uC2B5\uB2C8\uB2E4.`, `\uCD5C\uB300 \uB192\uC774 ${selected2.features.maxHeight} mm \xB7 \uC9C0\uC9C0 ${(selected2.placement.supportRatio * 100).toFixed(1)}% \xB7 \uAE30\uB465 \uB192\uC774/\uBC1B\uCE68 ${selected2.features.slenderness.toFixed(2)}`, `\uB0A8\uC740 ${Object.values(input.remaining).reduce((a, b) => a + b, 0)}\uAC1C\uB97C \uD56D\uC0C1 \uD3C9\uAC00 \xB7 \uBC30\uCE58 \uACF5\uAC04 \uD45C\uBCF8\uC774 \uC788\uB294 \uBB3C\uB7C9 ${(selected2.features.inventory.fitFraction * 100).toFixed(1)}% \xB7 \uC0C1\uBD80 \uD558\uC911 \uCD5C\uB300 \uC0AC\uC6A9 ${(selected2.features.loadUtilization * 100).toFixed(1)}%`, ...selected2.features.futureSurfacePenalty ? [`\uB0A8\uC740 \uD070 \uBC15\uC2A4\uC6A9 \uBC1B\uCE68 \uC190\uC2E4 \uBE44\uC6A9 ${(selected2.features.futureSurfacePenalty * 100).toFixed(1)}% \xB7 \uCE21\uBA74 \uC811\uCD09 \uBA74\uC801 ${(100 * (selected2.features.contactRatio || 0)).toFixed(1)}%`] : [], ...selected2.features.inventory.foundationPenalty > 0 ? [`\uAC15\uD55C \uBC1B\uCE68 ${selected2.features.inventory.strongerRemaining}\uAC1C \uC794\uB7C9\uACFC \uAE30\uC874 \uBC1B\uCE68\uC758 \uC5EC\uC720 \uBA74\uC801\uC744 \uACE0\uB824\uD55C \uBC14\uB2E5 \uBC30\uCE58 \uBE44\uC6A9 ${selected2.features.inventory.foundationPenalty.toFixed(2)}\uB97C \uBC18\uC601\uD588\uC2B5\uB2C8\uB2E4.`] : [], ...selected2.future ? [`\uC2E4\uC81C \uBBF8\uB798 \uC785\uACE0\uC640 \uB3C5\uB9BD\uC778 ${sequences.length}\uAC1C \uAC00\uC0C1 \uC21C\uC11C \xB7 \uD6C4\uC18D \uC815\uCC45 ${selected2.future.policies?.join(" / ")} \xB7 \uD3C9\uADE0 ${selected2.future.added.toFixed(2)}\uAC1C \uCD94\uAC00 \uC801\uC7AC \xB7 \uAC00\uC0C1 \uC911\uB2E8 ${(selected2.future.blocked * 100).toFixed(0)}%`] : []] : ["\uBAA8\uB4E0 \uAC80\uD1A0 \uD6C4\uBCF4\uAC00 \uC81C\uC57D\uC744 \uC704\uBC18\uD588\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uBC15\uC2A4\uB97C \uAC74\uB108\uB6F0\uC9C0 \uC54A\uACE0 \uC774 \uC2E4\uD589\uC744 \uC911\uB2E8\uD569\uB2C8\uB2E4."];
  return { ...root2, runId: input.runId, stepId: input.stepId, selectedId: selected2?.id || null, valid: valid.length, rejections, nodes, rolloutCalls, milliseconds: performance.now() - start2, explanation, virtualSequences: sequences };
}

// src/engine/vendor/pallet/environment.ts
var ArrivalEnvironment = class {
  constructor(scenario2) {
    this.scenario = scenario2;
    const pool = scenario2.types.flatMap((t) => Array.from({ length: t.quantity }, (_, i) => ({ id: `${t.id}-${String(i + 1).padStart(2, "0")}`, typeId: t.id, size: { ...t.size }, weight: t.weight, status: "normal", orientationAllowed: [...t.orientations], packaging: t.packaging, maxLoadKg: t.maxLoadKg, maxLoadSource: t.maxLoadSource, maxLoadByAxis: t.maxLoadByAxis, handling: t.handling, material: t.material, strengthFactor: t.strengthFactor, friction: t.friction })));
    this.#pool = pool;
    this.#total = pool.length;
    this.#draw = rng(scenario2.arrival.seed);
    if (scenario2.supplyMode === "stock-select") {
      this.#queue = [];
    } else if (scenario2.arrival.pattern === "random-draw") {
      this.#queue = [];
      this.#available = pool;
    } else {
      this.#queue = scenario2.arrival.pattern === "ordered" ? pool : shuffled(pool, this.#draw);
      if (scenario2.arrival.pattern === "large-late") this.#queue.sort((a, b) => volume(a.size) - volume(b.size));
      if (scenario2.arrival.pattern === "heavy-late") this.#queue.sort((a, b) => a.weight - b.weight);
      this.#queue = this.#queue.map((o, i) => this.#event(o, i));
    }
  }
  scenario;
  #queue;
  #pool;
  #available = [];
  #draw;
  #total;
  #event(o, index) {
    const event = this.scenario.events.find((e) => e.step === index + 1);
    if (!event) return o;
    const next = { ...o, status: event.kind === "resize" ? "resized" : event.kind, ...event.kind === "resize" ? { size: { ...event.size } } : {} };
    if (event.kind === "resize" && o.packaging) {
      const spec = structuredClone(o.packaging), size = event.size;
      spec.centerOfGravity = { x: spec.centerOfGravity.x * size.w / spec.length, y: spec.centerOfGravity.y * size.d / spec.width, z: spec.centerOfGravity.z * size.h / spec.height };
      spec.length = size.w;
      spec.width = size.d;
      spec.height = size.h;
      next.packaging = spec;
    }
    return next;
  }
  current(processed) {
    if (this.scenario.supplyMode === "stock-select") return null;
    if (!Number.isInteger(processed) || processed < 0 || processed >= this.#total) return null;
    if (this.scenario.arrival.pattern === "random-draw") while (this.#queue.length <= processed) {
      const index = Math.floor(this.#draw() * this.#available.length), o = this.#available.splice(index, 1)[0];
      this.#queue.push(this.#event(o, this.#queue.length));
    }
    return structuredClone(this.#queue[processed]);
  }
  available(frame) {
    const used = new Set(frame.records.filter((r) => r.disposition !== "blocked").map((r) => r.observation.id));
    return structuredClone(this.#pool.filter((o) => !used.has(o.id)).map((o) => {
      const held = frame.buffer?.find((h) => h.observation.id === o.id);
      return held ? { ...o, pickupPosition: held.source } : o;
    }));
  }
  currentFor(frame, analysis) {
    if (this.scenario.supplyMode !== "stock-select") return this.current(frame.processed);
    const stock = this.available(frame);
    return stock.find((o) => o.id === analysis?.selectedBoxId) || stock[0] || null;
  }
  get total() {
    return this.#total;
  }
  get sampledCount() {
    return this.scenario.arrival.pattern === "random-draw" ? this.#queue.length : 0;
  }
  remaining(frame) {
    const counts2 = Object.fromEntries(this.scenario.types.map((t) => [t.id, t.quantity]));
    for (const r of frame.records) if (r.disposition !== "blocked") counts2[r.observation.typeId]--;
    const current = this.scenario.supplyMode === "stock-select" ? null : this.current(frame.processed);
    if (current) counts2[current.typeId]--;
    return counts2;
  }
  input(frame, algorithm, settings, runId) {
    const current = this.currentFor(frame);
    if (!current || frame.blocked) return null;
    return { runId, stepId: frame.processed, pallet: structuredClone(this.scenario.pallet), types: structuredClone(this.scenario.types), constraints: structuredClone(this.scenario.constraints), placements: structuredClone(frame.placements), current, remaining: this.remaining(frame), ...this.scenario.supplyMode === "stock-select" ? { available: this.available(frame), buffer: structuredClone(frame.buffer || []) } : {}, algorithm, settings: structuredClone(settings), ...isStrategy(algorithm) ? { strategyState: structuredClone([...frame.records].reverse().find((r) => r.analysis?.strategyState)?.analysis?.strategyState) } : {} };
  }
};

// src/engine/vendor/pallet/benchmark/version.ts
var BUNDLED_ALGORITHM_VERSION = "adapter-1.0 / planners-f6ec11d4259a";

// src/engine/vendor/pallet/packaging/planner.ts
var PACKAGE_SETTINGS = { seed: 2026, samples: 20, depth: 5, beamWidth: 10, rootCandidates: 3, maxCandidates: 96, maxFutureChecks: 12e3, weights: { space: 24, support: 18, load: 16, cog: 12, flat: 8, compatibility: 30, access: 8, height: 10, fragility: 14, cycle: 4, failure: 30, future: 25 } };
function validateSettings(s) {
  if (![20, 50, 100].includes(s.samples) || ![3, 5, 10].includes(s.depth) || !Number.isInteger(s.seed) || !Number.isInteger(s.beamWidth) || s.beamWidth < 1 || s.beamWidth > 30 || !Number.isInteger(s.rootCandidates) || s.rootCandidates < 1 || s.rootCandidates > 8 || !Number.isInteger(s.maxCandidates) || s.maxCandidates < 8 || s.maxCandidates > 256 || !Number.isInteger(s.maxFutureChecks) || s.maxFutureChecks < 100 || s.maxFutureChecks > 1e5 || Object.values(s.weights).some((v) => !Number.isFinite(v) || v < 0 || v > 100)) throw Error("\uD0D0\uC0C9 \uC124\uC815 \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694.");
}
function freeFloor(placed, p) {
  let regions = [{ x: 0, y: 0, w: p.width, d: p.depth }];
  for (const b of placed.filter((v) => v.position.z === 0)) {
    const bx = b.position.x, by = b.position.y, ex = bx + b.size.w, ey = by + b.size.d;
    regions = regions.flatMap((r) => {
      const rx = r.x + r.w, ry = r.y + r.d;
      if (bx >= rx || by >= ry || ex <= r.x || ey <= r.y) return [r];
      return [
        { x: r.x, y: r.y, w: bx - r.x, d: r.d },
        { x: ex, y: r.y, w: rx - ex, d: r.d },
        { x: r.x, y: r.y, w: r.w, d: by - r.y },
        { x: r.x, y: ey, w: r.w, d: ry - ey }
      ].filter((v) => v.w > 0 && v.d > 0);
    });
    regions = regions.filter((r, i, a) => !a.some((q, j) => i !== j && (q.w * q.d > r.w * r.d || j < i) && q.x <= r.x && q.y <= r.y && q.x + q.w >= r.x + r.w && q.y + q.d >= r.y + r.d)).sort((a, b2) => b2.w * b2.d - a.w * a.d).slice(0, 64);
  }
  return regions;
}
function futureSpace(placed, input) {
  const { pallet, types } = input.scenario, regions = freeFloor(placed, pallet), large = types.filter((t) => input.remaining[t.id] > 0).sort((a, b) => volume(b.size) - volume(a.size)).slice(0, 3), loads = calculateLoads(placed);
  let total2 = 0, value = 0;
  for (const t of large) {
    const quantity = input.remaining[t.id], mass = volume(t.size) * quantity;
    total2 += mass;
    let fit = 0;
    for (const o of t.packaging ? permittedOrientations(t.packaging) : t.orientations) {
      const s = oriented(t.size, o);
      for (const r of regions) if (s.w <= r.w && s.d <= r.d && s.h <= pallet.maxHeight) fit = Math.max(fit, Math.min(quantity, Math.floor(r.w / s.w) * Math.floor(r.d / s.d)));
      for (const b of placed) if (b.packaging?.stackable !== false && s.w <= b.size.w && s.d <= b.size.d && top(b) + s.h <= pallet.maxHeight && (b.packaging?.maxTopLoad ?? b.maxLoadKg ?? 0) >= loads[b.id] + t.weight) {
        const v = { position: { ...b.position, z: top(b) }, size: s };
        if (!placed.some((other) => intersects(v, other))) fit = Math.max(fit, 1);
      }
    }
    value += mass * Math.min(1, fit / Math.max(1, quantity));
  }
  return { value: total2 ? value / total2 : 1, area: Math.max(0, ...regions.map((r) => r.w * r.d)), regions };
}
function classify(reason) {
  return /회전|Orientation|방향 유지/.test(reason) ? "orientation" : /경계|최대 적재|바닥 아래/.test(reason) ? "boundary" : /겹침/.test(reason) ? "collision" : /하중|적재 금지|LOAD/.test(reason) ? "load" : /지지|무게중심|기둥|SUPPORT/.test(reason) ? "support" : "robot";
}
function scored(c, input, futureProbe) {
  const { pallet } = input.scenario, stack = c.stack, b = c.placement, height = Math.max(1, ...stack.map(top)), center = balance(stack, pallet).center, totalVolume = stack.reduce((n2, b2) => n2 + volume(b2.size), 0), space = totalVolume / (pallet.width * pallet.depth * height), cog = 1 - Math.min(1, Math.hypot(center.x - pallet.width / 2, center.y - pallet.depth / 2) / Math.hypot(pallet.width / 2, pallet.depth / 2));
  const mean = stack.reduce((n2, b2) => n2 + top(b2), 0) / stack.length, spread = Math.sqrt(stack.reduce((n2, b2) => n2 + (top(b2) - mean) ** 2, 0) / stack.length) / pallet.maxHeight;
  const future = futureProbe ? futureSpace(stack, input) : { value: 0, area: 0 };
  c.compatibility = future.value;
  c.regionArea = future.area;
  let fragility = 0;
  for (const s of stack) {
    const spec = s.packaging, load = c.loads[s.id] || 0;
    fragility += (spec?.fragility === "HIGH" ? 1 : spec?.fragility === "MEDIUM" ? 0.4 : 0) * load / Math.max(1, spec?.maxTopLoad ?? 100);
  }
  fragility += b.packaging?.fragility === "HIGH" ? 0.25 * Math.max(0, 1 - top(b) / pallet.maxHeight) : 0;
  const values = { space, support: b.supportRatio, load: 1 - Math.min(1, c.maxLoadUtilization), cog, flat: 1 - Math.min(1, spread), compatibility: future.value, access: input.scenario.constraints.packagingRobot ? Math.max(0, 1 - c.reach / input.scenario.constraints.packagingRobot.maxReach) : 1, height: -top(b) / pallet.maxHeight * (1 + b.weight / input.scenario.constraints.gripper.payload), fragility: -fragility, cycle: -c.path.seconds / 30, failure: 0, future: 0 };
  const terms2 = {};
  for (const key of Object.keys(values)) terms2[key] = values[key] * input.settings.weights[key];
  if (input.method === "first" || input.method === "greedy" || input.method === "tetris") terms2.compatibility = 0;
  if (input.method === "tetris") {
    terms2.flat = (values.flat ?? 0) * input.settings.weights.flat * 2;
    terms2.height = (values.height ?? 0) * input.settings.weights.height * 2;
  }
  c.values = values;
  c.terms = terms2;
  c.score = Object.values(terms2).reduce((a, b2) => a + b2, 0);
  return c;
}
function rolloutOrigins(p, size, placed) {
  const points = /* @__PURE__ */ new Map();
  const add3 = (x, y) => {
    if (x >= 0 && y >= 0 && x + size.w <= p.width && y + size.d <= p.depth) points.set(`${x}:${y}`, { x, y });
  };
  for (const x of [0, p.width - size.w]) for (const y of [0, p.depth - size.d]) add3(x, y);
  for (const b of placed) {
    const x = b.position.x, y = b.position.y;
    for (const dx of [0, b.size.w - size.w]) for (const dy of [0, b.size.d - size.d]) add3(x + dx, y + dy);
    add3(x + b.size.w, y);
    add3(x, y + b.size.d);
    add3(x - size.w, y);
    add3(x, y - size.d);
  }
  return [...points.values()].map((v) => ({ ...v, z: landingHeight(v.x, v.y, size, placed) }));
}
function candidates(input, limit = input.settings.maxCandidates, futureProbe = true) {
  const { scenario: s, current, placements } = input, orientations = current.packaging ? permittedOrientations(current.packaging).filter((o) => current.orientationAllowed.includes(o)) : current.orientationAllowed;
  const raw = orientations.flatMap((orientation) => {
    const size = oriented(current.size, orientation);
    return (futureProbe ? frontierOrigins(s.pallet, size, placements, s.constraints.horizontalGap) : rolloutOrigins(s.pallet, size, placements)).map((position) => ({ size, position, orientation }));
  });
  const inside = (r) => r.position.x >= 0 && r.position.y >= 0 && r.position.x + r.size.w <= s.pallet.width && r.position.y + r.size.d <= s.pallet.depth && top(r) <= s.pallet.maxHeight;
  raw.sort((a, b) => Number(inside(b)) - Number(inside(a)) || a.position.z - b.position.z || a.position.y - b.position.y || a.position.x - b.position.x);
  const buckets = /* @__PURE__ */ new Map();
  for (const r of raw) {
    const key = `${r.orientation}:${r.position.z}:${Number(r.position.x + r.size.w / 2 > s.pallet.width / 2)}:${Number(r.position.y + r.size.d / 2 > s.pallet.depth / 2)}:${inside(r)}`;
    const v = buckets.get(key) ?? [];
    v.push(r);
    buckets.set(key, v);
  }
  const budget = [];
  for (let i = 0; budget.length < limit; i++) {
    let any = false;
    for (const b of buckets.values()) if (b[i] && budget.length < limit) {
      budget.push(b[i]);
      any = true;
    }
    if (!any) break;
  }
  const checked = budget.map((r, i) => {
    const box = { ...current, ...r, supports: [], supportRatio: 0, loadAbove: 0 }, inspected = inspectConstraints(box, current, placements, s.pallet, s.constraints), loads = calculateLoads(inspected.stack);
    const maxLoadUtilization = Math.max(0, ...inspected.stack.map((b) => {
      const cap = b.packaging?.maxTopLoad ?? b.maxLoadKg ?? 100;
      return cap ? loads[b.id] / cap : loads[b.id] > 0 ? Infinity : 0;
    }));
    const target = inspected.path.points.find((p) => p.label === "\uB0B4\uB824\uB193\uAE30")?.tcp ?? massCenter(box), reach = s.constraints.packagingRobot ? reachability(target, s.constraints.packagingRobot).distance : 0;
    const c = { id: `pkg-${i}`, placement: inspected.placement, valid: !inspected.reasons.length, reasons: inspected.reasons, path: inspected.path, score: null, terms: {}, values: {}, future: null, loads, maxLoadUtilization, reach, grasp: inspected.path.graspFace ?? null, compatibility: 0, regionArea: 0, stack: withLoads(inspected.stack) };
    return c.valid ? scored(c, input, futureProbe) : c;
  });
  return { candidates: checked, generated: raw.length, orientationRejected: 6 - orientations.length, orientationOptions: 6, capped: raw.length > limit };
}
function virtualSequences2(remaining2, settings, step = 0) {
  const random = rng(settings.seed + step * 7919), entries2 = Object.entries(remaining2).sort(([a], [b]) => a.localeCompare(b));
  return Array.from({ length: settings.samples }, () => {
    const counts2 = Object.fromEntries(entries2), seq = [];
    for (let d = 0; d < settings.depth; d++) {
      let total2 = Object.values(counts2).reduce((a, b) => a + b, 0);
      if (!total2) break;
      let k = random() * total2;
      for (const [id] of entries2) {
        k -= counts2[id];
        if (k < 0) {
          seq.push(id);
          counts2[id]--;
          break;
        }
      }
    }
    return seq;
  });
}
function robustStatistics(scores) {
  const sorted = [...scores].sort((a, b) => a - b), mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length), worst = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.1))).reduce((a, b) => a + b, 0) / Math.max(1, Math.ceil(sorted.length * 0.1));
  return { mean, worst, robust: 0.7 * mean + 0.3 * worst };
}
var rank = (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.id.localeCompare(b.id);
function planPackaging(input) {
  validateSettings(input.settings);
  const started2 = performance.now(), root2 = candidates(input), valid = root2.candidates.filter((c) => c.valid).sort(rank), sequences = virtualSequences2(input.remaining, input.settings, input.step);
  let checks = 0, hits = 0, capped = root2.capped;
  const useFuture = input.method === "future" || input.method === "robust", shortlist2 = valid.slice(0, input.settings.rootCandidates), cache2 = /* @__PURE__ */ new Map();
  if (useFuture && sequences.some((s) => s.length)) {
    const perRun = Math.max(8, Math.floor(input.settings.maxFutureChecks / Math.max(1, shortlist2.length * sequences.length)));
    for (const initial of shortlist2) {
      const scores = [], failures = [], depths = [];
      let incomplete = false;
      for (const sequence of sequences) {
        let beam = [{ stack: initial.stack, value: 0, failures: 0, key: initial.id }], used = 0, completed = 0;
        for (let d = 0; d < sequence.length; d++) {
          const type = input.scenario.types.find((t) => t.id === sequence[d]);
          if (!type) throw Error("\uC54C \uC218 \uC5C6\uB294 \uC794\uB7C9 \uC885\uB958");
          const next = [], levelBudget = Math.max(8, Math.floor((perRun - used) / Math.max(1, sequence.length - d)));
          let levelUsed = 0;
          for (const state of beam) {
            const key = `${state.key}/${d}:${type.id}`;
            let found = cache2.get(key);
            if (!found) {
              if (used + 8 > perRun || levelUsed + 8 > levelBudget) {
                incomplete = true;
                continue;
              }
              const context = { ...input, current: virtualObservation(type, `future-${d}`), placements: state.stack, remaining: {}, method: "greedy" }, result = candidates(context, 8, false);
              found = { children: result.candidates.filter((v) => v.valid).sort(rank).slice(0, 3), count: result.candidates.length };
              cache2.set(key, found);
              used += found.count;
              levelUsed += found.count;
              checks += found.count;
            } else hits++;
            if (!found.children.length) next.push({ ...state, failures: state.failures + 1, value: state.value - 1, key: `${key}:fail` });
            else for (const child of found.children) {
              const added = volume(child.placement.size) / (input.scenario.pallet.width * input.scenario.pallet.depth * input.scenario.pallet.maxHeight);
              next.push({ stack: child.stack, value: state.value + 1 + added, failures: state.failures, key: `${key}:${child.id}` });
            }
          }
          if (!next.length) {
            incomplete = true;
            break;
          }
          beam = next.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)).slice(0, input.settings.beamWidth);
          completed++;
        }
        const best = beam[0], unexplored = sequence.length - completed;
        incomplete ||= unexplored > 0;
        scores.push(Math.max(-1, Math.min(1, best.value / Math.max(1, sequence.length))));
        failures.push((best.failures + unexplored) / Math.max(1, sequence.length));
        depths.push(completed);
      }
      const stats = robustStatistics(scores), failure = failures.reduce((a, b) => a + b, 0) / failures.length;
      initial.future = { ...stats, failure, samples: scores.length, minDepth: Math.min(...depths), maxDepth: Math.max(...depths), capped: incomplete };
      const f = input.method === "robust" ? stats.robust : stats.mean;
      initial.values.future = f;
      initial.values.failure = -failure;
      initial.terms.future = input.settings.weights.future * f;
      initial.terms.failure = -input.settings.weights.failure * failure;
      initial.score = Object.values(initial.terms).reduce((a, b) => a + b, 0);
      capped ||= incomplete;
    }
  }
  const selected2 = input.method === "first" ? root2.candidates.find((c) => c.valid) : useFuture && shortlist2.length ? shortlist2.sort(rank)[0] : valid[0];
  const rejected = { orientation: 0, boundary: 0, collision: 0, load: 0, support: 0, robot: 0 };
  for (const c of root2.candidates.filter((c2) => !c2.valid)) for (const category of new Set(c.reasons.map(classify))) rejected[category]++;
  return { ...root2, checked: root2.candidates.length, selectedId: selected2?.id ?? null, valid: valid.length, rejected, milliseconds: performance.now() - started2, futureChecks: checks, cacheHits: hits, sequences: useFuture ? sequences : [], capped };
}
function sceneCandidate(c) {
  return { id: c.id, placement: c.placement, valid: c.valid, reasons: c.reasons, path: c.path, score: c.score ?? -Infinity, fastScore: c.score ?? -Infinity, future: null, terms: {}, features: {} };
}

// src/engine/vendor/pallet/benchmark/registry.ts
var entries = /* @__PURE__ */ new Map();
function registerAlgorithm(entry) {
  if (!entry.id || entries.has(entry.id)) throw Error("\uC911\uBCF5 \uC54C\uACE0\uB9AC\uC998 ID");
  entries.set(entry.id, entry);
}
for (const [id, name] of Object.entries(ALGORITHM_NAMES)) registerAlgorithm({ id, name, version: BUNDLED_ALGORITHM_VERSION, scope: "online", family: "\uAE30\uC874 \uACF5\uD1B5 \uACC4\uD68D\uAE30", description: "\uD604\uC7AC \uB3C4\uCC29 \uBC15\uC2A4\xB7\uC794\uC5EC \uC885\uB958\uBCC4 \uC218\uB7C9\uB9CC \uC0AC\uC6A9", plan: (i) => plan({ ...i, algorithm: id, available: void 0 }) });
registerAlgorithm({ id: "blb", name: "Bottom-Left-Back", version: BUNDLED_ALGORITHM_VERSION, scope: "online", family: "\uAE30\uC900\uC120", description: "\uACF5\uD1B5 \uC81C\uC57D \uD1B5\uACFC \uD6C4 z \u2192 y \u2192 x, \uBBF8\uB798 \uD3C9\uAC00 \uC5C6\uC74C", plan: (i) => {
  const start2 = performance.now(), r = candidateSet({ ...i, settings: { ...i.settings, inventoryMode: "none" } }), valid = r.candidates.filter((c) => c.valid).sort((a, b) => a.placement.position.z - b.placement.position.z || a.placement.position.y - b.placement.position.y || a.placement.position.x - b.placement.position.x);
  return { ...r, runId: i.runId, stepId: i.stepId, selectedId: valid[0]?.id ?? null, valid: valid.length, rejections: {}, nodes: r.candidates.length, rolloutCalls: 0, milliseconds: performance.now() - start2, virtualSequences: [], explanation: ["\uCD5C\uC800 z \u2192 y \u2192 x"] };
} });
for (const [id, name, method] of [["pack-first", "First Fit", "first"], ["pack-greedy", "Greedy \xB7 \uD3EC\uC7A5 \uD6C4\uBCF4", "greedy"], ["pack-tetris", "3D Tetris \xB7 \uD3EC\uC7A5 \uD734\uB9AC\uC2A4\uD2F1", "tetris"], ["pack-beam", "Beam \xB7 Future-aware", "future"], ["pack-robust", "Robust Beam \xB7 Future-aware", "robust"]]) {
  registerAlgorithm({ id, name, version: BUNDLED_ALGORITHM_VERSION, scope: "online", family: "\uAE30\uC874 \uD3EC\uC7A5 \uACC4\uD68D\uAE30 \uC5B4\uB311\uD130", description: method === "future" || method === "robust" ? "\uAE30\uC874 Beam + \uAC00\uC0C1 \uC794\uB7C9 \uC21C\uC11C. \uC2E4\uC81C \uBBF8\uB798 \uBE44\uACF5\uAC1C" : "\uAE30\uC874 \uD3EC\uC7A5 \uACC4\uD68D\uAE30. \uACF5\uD1B5 \uD655\uC815 \uAC80\uC0AC \uC7AC\uC0AC\uC6A9", plan: (i) => {
    const r = planPackaging({ scenario: { pallet: i.pallet, types: i.types, constraints: i.constraints }, placements: i.placements, current: i.current, remaining: i.remaining, method, step: i.stepId, settings: { ...structuredClone(PACKAGE_SETTINGS), seed: i.settings.plannerSeed, maxCandidates: i.settings.maxCandidates } });
    return { runId: i.runId, stepId: i.stepId, selectedId: r.selectedId, candidates: r.candidates.map(sceneCandidate), generated: r.generated, checkedCandidates: r.checked, valid: r.valid, rejections: r.rejected, nodes: r.checked, rolloutCalls: r.futureChecks, milliseconds: r.milliseconds, capped: r.capped, virtualSequences: r.sequences, explanation: ["\uAE30\uC874 \uD3EC\uC7A5 \uACC4\uD68D\uAE30\uB97C \uACF5\uD1B5 \uC778\uD130\uD398\uC774\uC2A4\uB85C \uC5F0\uACB0"] };
  } });
}
registerAlgorithm({ id: "offline-stock", name: "\uC624\uD504\uB77C\uC778 \uAE30\uC900\uD574 \xB7 \uC804\uCCB4 \uC7AC\uACE0", version: BUNDLED_ALGORITHM_VERSION, scope: "offline", family: "\uCC38\uACE0\uC6A9, \uC21C\uC704 \uC81C\uC678", description: "\uC804\uCCB4 \uC7AC\uACE0 \uC7AC\uC815\uB82C \uD5C8\uC6A9 Greedy. \uCD5C\uC801\uD574 \uC544\uB2D8; \uC628\uB77C\uC778 \uC815\uBCF4 \uC870\uAC74\uACFC \uB2E4\uB984", plan: (i) => plan({ ...i, algorithm: "greedy" }) });

// src/engine/vendor/pallet/benchmark/statistics.ts
function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), x = Math.max(0, Math.min(1, p)) * (s.length - 1), lo = Math.floor(x);
  return s[lo] + (s[Math.ceil(x)] - s[lo]) * (x - lo);
}
function fingerprint(value) {
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",")}}` : JSON.stringify(v) ?? "null";
  let h = 2166136261;
  for (const c of canonical(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

// src/engine/vendor/pallet/strategies/demo.ts
function strategyDemo() {
  const s = scenario("online-task");
  delete s.generation;
  s.id = "strategy-lab";
  s.name = "\uBBF8\uB798 \uACF5\uAC04 \uBE44\uAD50 \xB7 \uD63C\uD569 \uBC15\uC2A4 18\uAC1C";
  s.pallet = { width: 1e3, depth: 800, maxHeight: 1400 };
  s.supplyMode = "arrival";
  s.arrival = { seed: 42, pattern: "random-draw" };
  s.events = [];
  const t = (id, size, weight, quantity, color) => ({ id, name: id, size, weight, quantity, color, orientations: [0, 90], material: "plastic", maxLoadKg: 120 });
  s.types = [t("Wide", { w: 487, d: 363, h: 193 }, 12, 3, "#e1b65f"), t("Long", { w: 731, d: 143, h: 127 }, 6, 2, "#aa9de5"), t("Small", { w: 223, d: 177, h: 151 }, 3, 5, "#6abbaa"), t("Medium", { w: 341, d: 269, h: 217 }, 8, 4, "#72b5c6"), t("Heavy", { w: 417, d: 311, h: 179 }, 18, 2, "#ca879f"), t("Tall", { w: 197, d: 233, h: 357 }, 5, 2, "#8bbb89")];
  s.types.find((t2) => t2.id === "Tall").orientations = [0, 90, "whd", "hwd", "hdw", "dhw"];
  Object.assign(s.types.find((t2) => t2.id === "Small"), { material: "paper", maxLoadKg: 18 });
  s.constraints.robotMode = "ideal";
  s.constraints.heavyRule = "each";
  s.constraints.standingHeight = { enabled: true, maxRiseMm: 240 };
  return s;
}

// src/engine/vendor/pallet/capacity/experiment.ts
var ALGORITHMS = { blb: "Bottom-Left-Back", "capacity-compact": "\uACF5\uAC04 \uCC44\uC6C0 \xB7 Compact", "strategy-greedy": "Greedy", lookahead: "Lookahead", "future-hybrid": "Future-Aware Hybrid" };
var COLORS = ["#bf8c43", "#479b92", "#7f8ab9"];
function retailScenario(quantity = 12) {
  const s = strategyDemo();
  s.id = "team-retail-capacity";
  s.name = "\uD300 \uB17C\uC758 \xB7 \uB300\uD615\uB9C8\uD2B8 6\uD488\uBAA9";
  s.pallet = { width: 1200, depth: 1e3, maxHeight: 1200, robotLayout: { count: 1, architecture: "floor", floorCount: 1 } };
  const specs = [
    ["\uC0DD\uC218", 400, 300, 280, 12, 85],
    ["\uACFC\uC790", 500, 340, 250, 3, 24],
    ["\uC138\uC81C", 320, 240, 320, 8, 55],
    ["\uC0DD\uD65C\uC6A9\uD488", 400, 300, 220, 4, 40],
    ["\uD5E4\uC5B4\uCF00\uC5B4", 300, 250, 240, 6, 45],
    ["\uC2A4\uD0A8\uCF00\uC5B4", 250, 200, 200, 4, 30]
  ];
  s.types = specs.map(([name, w, d, h, weight, maxLoadKg], i) => ({
    id: `S${i + 1}`,
    name,
    size: { w, d, h },
    weight,
    maxLoadKg,
    maxLoadSource: "synthetic",
    quantity,
    color: COLORS[Math.floor(i / 2)],
    orientations: [0, 90],
    handling: "upright",
    material: "paper",
    friction: 0.45
  }));
  s.constraints.robotMode = "gripper";
  s.constraints.heavyRule = "off";
  s.constraints.supportRatio = 0.85;
  s.constraints.standingHeight = { enabled: false, maxRiseMm: 100 };
  s.constraints.stability = { ...s.constraints.stability, lateralAccelerationG: 0, minMarginRatio: 0.05, loadSafetyFactor: 1.2, slendernessMode: "score" };
  s.constraints.gripper = { width: 180, depth: 160, height: 160, mass: 8, payload: 38, margin: 5, lift: 180, speed: 650, pickSeconds: 0.7, placeSeconds: 0.45, rotationSpeed: 90 };
  s.constraints.reach = { baseX: -700, baseY: 500, minRadius: 0, maxRadius: 2700 };
  s.constraints.workspace = { xMin: -1400, xMax: 1800, yMin: -600, yMax: 1600, zMax: 2600 };
  s.events = [];
  return s;
}
function defaultCapacityConfig() {
  return {
    scenario: retailScenario(),
    groups: { S1: 0, S2: 0, S3: 1, S4: 1, S5: 2, S6: 2 },
    settings: {
      ...structuredClone(ONLINE_SEARCH),
      maxCandidates: 48,
      topK: 4,
      samples: 2,
      depth: 2,
      reserveProbes: 4,
      virtualCandidates: 8,
      strategy: { ...structuredClone(DEFAULT_STRATEGY), futureCandidates: 4, lookaheadDepth: 2, lookaheadSamples: 2, lookaheadCandidates: 3 }
    },
    algorithms: Object.keys(ALGORITHMS),
    heights: [1200],
    discoverySeeds: [42, 43],
    holdoutSeeds: [1042, 1043],
    bufferCapacity: 2,
    decisionMs: 250,
    trialMs: 6e4,
    groupStrength: 1,
    groupHeightSlack: 100
  };
}
var overlapsXY = (a, b) => a.position.x < b.position.x + b.size.w - 1e-6 && b.position.x < a.position.x + a.size.w - 1e-6 && a.position.y < b.position.y + b.size.d - 1e-6 && b.position.y < a.position.y + a.size.d - 1e-6;
function crossZoneBlockers(stack, groups) {
  return stack.filter((upper) => stack.some((lower) => groups[upper.typeId] !== groups[lower.typeId] && upper.position.z >= top(lower) - 0.5 && overlapsXY(upper, lower))).length;
}

// src/benchmark1000/workloads.ts
var BENCHMARK_ALGORITHMS = ["blb", "capacity-compact", "strategy-greedy", "lookahead", "future-hybrid", "floor-dense", "cluster-layer"];
var CONDITIONS = [
  { id: "h1200-n30-s6", height: 1200, boxes: 30, skus: 6 },
  { id: "h1200-n30-s8", height: 1200, boxes: 30, skus: 8 }
];
function workload(c) {
  const s = retailScenario(1);
  const added = [
    ["\uC74C\uB8CC", 380, 260, 230, 7, 50],
    ["\uC8FC\uBC29\uC6A9\uD488", 450, 300, 210, 5, 40],
    ["\uC704\uC0DD\uC6A9\uD488", 280, 220, 260, 3, 30],
    ["\uC18C\uD615\uC2DD\uD488", 350, 280, 180, 4, 35]
  ];
  for (const [i, [name, w, d, h, weight, maxLoadKg]] of added.entries()) s.types.push({ ...structuredClone(s.types[0]), id: `S${7 + i}`, name, size: { w, d, h }, weight, maxLoadKg, color: "#798ba0" });
  s.types = s.types.slice(0, c.skus).map((t, i) => ({ ...t, quantity: Math.floor(c.boxes / c.skus) + (i < c.boxes % c.skus ? 1 : 0) }));
  s.id = c.id;
  s.name = `\uD569\uC131 \uC785\uB825 ${c.boxes}\uAC1C / ${c.skus} SKU`;
  s.pallet.maxHeight = c.height;
  s.supplyMode = "arrival";
  s.arrival = { seed: 0, pattern: "random-draw" };
  s.events = [];
  return s;
}
function arrivalSequence(scenario2, seed) {
  const s = structuredClone(scenario2);
  s.arrival = { seed, pattern: "random-draw" };
  s.supplyMode = "arrival";
  const env = new ArrivalEnvironment(s);
  return Array.from({ length: env.total }, (_, i) => env.current(i).typeId);
}
function uniqueOrders(scenario2, n2, firstSeed) {
  if (!Number.isInteger(n2) || n2 < 1 || n2 > 1e3) throw Error("Order count must be 1..1000");
  const seen = /* @__PURE__ */ new Set(), orders = [];
  let rejectedDuplicates = 0;
  for (let seed = firstSeed; orders.length < n2; seed++) {
    if (seed >= firstSeed + 1e5) throw Error("Insufficient unique orders");
    const sequence = arrivalSequence(scenario2, seed), key = sequence.join(",");
    if (seen.has(key)) {
      rejectedDuplicates++;
      continue;
    }
    seen.add(key);
    orders.push({ seed, sequence });
  }
  return { orders, rejectedDuplicates };
}

// src/engine/config.ts
var ALGORITHMS2 = [
  { id: "blb", name: "Bottom-Left-Back" },
  { id: "capacity-compact", name: "Compact" },
  { id: "strategy-greedy", name: "Greedy" },
  { id: "lookahead", name: "Lookahead" },
  { id: "future-hybrid", name: "Future Hybrid" },
  { id: "mcts", name: "UCT MCTS" },
  { id: "floor-dense", name: "ALPS Tetris \xB7 \uBC14\uB2E5 \uBC00\uC9D1" },
  { id: "cluster-floor", name: "ALPS \uAD70\uC9D1 \xB7 \uCE35 \uC6B0\uC120" },
  { id: "cluster-layer", name: "ALPS \uAD70\uC9D1 \xB7 \uC5F0\uACB0 \uC6B0\uC120" },
  { id: "dispersed", name: "\uBD84\uC0B0 \uC801\uC7AC \xB7 \uB300\uC870\uAD70" }
];
var DEFAULT_CONFIG = {
  cycleSeconds: 10,
  recognitionDelaySeconds: 0,
  reserveSeconds: 1,
  maxHeightMm: 1200,
  quantityPerSku: 12,
  searchBudgetMs: null,
  maxCandidates: 48,
  mcts: { depth: 3, scenarios: 3, maxIterations: 384 }
};
function availablePlanningMs(c) {
  return (c.cycleSeconds - c.recognitionDelaySeconds - c.reserveSeconds) * 1e3;
}
function validateConfig(c) {
  if (![10, 12].includes(c.cycleSeconds)) throw Error("\uB85C\uBD07 \uC6B4\uC601 \uBAA9\uD45C\uB294 10\uCD08 \uB610\uB294 12\uCD08\uC785\uB2C8\uB2E4.");
  if (![c.recognitionDelaySeconds, c.reserveSeconds].every((n2) => Number.isFinite(n2) && n2 >= 0) || availablePlanningMs(c) <= 0) throw Error("\uC778\uC9C0\xB7\uAC80\uC99D \uC5EC\uC720\uB97C \uC81C\uC678\uD55C \uACC4\uC0B0 \uC2DC\uAC04\uC774 \uC591\uC218\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  if (!Number.isInteger(c.quantityPerSku) || c.quantityPerSku < 1 || c.quantityPerSku > 24) throw Error("\uD488\uBAA9\uB2F9 \uC218\uB7C9\uC740 1~24\uAC1C\uC785\uB2C8\uB2E4.");
  if (!Number.isFinite(c.maxHeightMm) || c.maxHeightMm < 400 || c.maxHeightMm > 2400) throw Error("\uB192\uC774 \uBC94\uC704\uB294 400~2400mm\uC785\uB2C8\uB2E4.");
  if (c.searchBudgetMs !== null && (!Number.isFinite(c.searchBudgetMs) || c.searchBudgetMs < 1 || c.searchBudgetMs > availablePlanningMs(c))) throw Error("\uD0D0\uC0C9 \uC608\uC0B0\uC740 \uAC00\uC6A9 \uC2DC\uAC04 \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  if (!Number.isInteger(c.maxCandidates) || c.maxCandidates < 1 || c.maxCandidates > 128) throw Error("\uD6C4\uBCF4 \uC218\uB294 1~128\uAC1C\uC785\uB2C8\uB2E4.");
  if (![c.mcts.depth, c.mcts.scenarios, c.mcts.maxIterations].every(Number.isInteger) || c.mcts.depth < 1 || c.mcts.depth > 6 || c.mcts.scenarios < 1 || c.mcts.scenarios > 8 || c.mcts.maxIterations < 1 || c.mcts.maxIterations > 2048) throw Error("MCTS \uD0D0\uC0C9 \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694.");
}

// src/engine/validation.ts
function validateCandidate(input, candidate) {
  const p = candidate.placement, o = input.current, reasons = [];
  if (!candidate.valid) reasons.push("Candidate marked invalid");
  if (p.id !== o.id || p.typeId !== o.typeId) reasons.push("Current observation identity mismatch");
  if (!o.orientationAllowed.includes(p.orientation)) reasons.push("Disallowed orientation");
  const expected = oriented(o.size, p.orientation);
  if (["w", "d", "h"].some((k) => Math.abs(p.size[k] - expected[k]) > 1e-7)) reasons.push("Cargo dimensions changed");
  if (p.weight !== o.weight || p.maxLoadKg !== o.maxLoadKg || p.material !== o.material || p.handling !== o.handling) reasons.push("Cargo properties changed");
  if (![...Object.values(p.position), ...Object.values(p.size), p.weight].every(Number.isFinite)) reasons.push("Non-finite geometry");
  if (reasons.length) return { reasons, stack: input.placements, placement: p, path: candidate.path };
  return inspectConstraints(p, o, input.placements, input.pallet, input.constraints);
}

// src/engine/core.ts
var SOURCE_VERSION = "common-engine-cycle/2-floor-dense";
var decisionRunCounter = 0;
function trialMetrics(scenario2, stack, decisions, total2) {
  const pallet = scenario2.pallet, v = stack.reduce((s, p) => s + volume(p.size), 0), height = Math.max(0, ...stack.map(top)), mass = stack.reduce((s, p) => s + p.weight, 0);
  const center = { x: mass ? stack.reduce((s, p) => s + p.weight * (p.position.x + p.size.w / 2), 0) / mass : pallet.width / 2, y: mass ? stack.reduce((s, p) => s + p.weight * (p.position.y + p.size.d / 2), 0) / mass : pallet.depth / 2, z: mass ? stack.reduce((s, p) => s + p.weight * (p.position.z + p.size.h / 2), 0) / mass : 0 };
  const xs = [.../* @__PURE__ */ new Set([0, pallet.width, ...stack.flatMap((p) => [p.position.x, p.position.x + p.size.w])])].sort((a, b) => a - b), ys = [.../* @__PURE__ */ new Set([0, pallet.depth, ...stack.flatMap((p) => [p.position.y, p.position.y + p.size.d])])].sort((a, b) => a - b);
  let column = 0, projectedArea = 0;
  for (let x = 1; x < xs.length; x++) for (let y = 1; y < ys.length; y++) {
    const mx = (xs[x] + xs[x - 1]) / 2, my = (ys[y] + ys[y - 1]) / 2;
    const area = (xs[x] - xs[x - 1]) * (ys[y] - ys[y - 1]), localTop = Math.max(0, ...stack.filter((p) => mx >= p.position.x && mx < p.position.x + p.size.w && my >= p.position.y && my < p.position.y + p.size.d).map(top));
    column += area * localTop;
    if (localTop > 0) projectedArea += area;
  }
  const loads = stack.map((p) => {
    const capacity = materialInfo(p, scenario2.constraints.stability).capacity;
    return capacity === null ? null : capacity > 0 ? p.loadAbove / capacity : p.loadAbove ? Infinity : 0;
  });
  const times = decisions.map((d) => d.decisionMs), compute = decisions.reduce((s, d) => s + d.decisionMs, 0), robot = decisions.filter((d) => d.accepted).reduce((s, d) => s + (d.timing.robotEnd - d.timing.robotStart), 0), wait = decisions.reduce((s, d) => s + d.timing.exposedWaitSeconds, 0);
  const groups = Object.fromEntries(scenario2.types.map((t, i) => [t.id, Math.floor(i / 2)]));
  const floorArea = stack.filter((p) => Math.abs(p.position.z) < 1e-6).reduce((s, p) => s + p.size.w * p.size.d, 0);
  return {
    floorContactAreaMm2: floorArea,
    floorCoverage: floorArea / (pallet.width * pallet.depth),
    projectedFootprintAreaMm2: projectedArea,
    projectedFootprintCoverage: projectedArea / (pallet.width * pallet.depth),
    count: stack.length,
    total: total2,
    fill: v / (pallet.width * pallet.depth * pallet.maxHeight),
    volumeMm3: v,
    usedHeightMm: height,
    envelopeFill: height ? v / (pallet.width * pallet.depth * height) : 0,
    allowedEmptyMm3: pallet.width * pallet.depth * pallet.maxHeight - v,
    envelopeEmptyMm3: pallet.width * pallet.depth * height - v,
    columnVoidMm3: Math.max(0, column - v),
    massKg: mass,
    center,
    cogHorizontalOffsetMm: Math.hypot(center.x - pallet.width / 2, center.y - pallet.depth / 2),
    cogHeightMm: center.z,
    minSupportRatio: stack.length ? Math.min(...stack.map((p) => p.supportRatio)) : null,
    maxLoadRatio: loads.length && loads.every((v2) => v2 !== null && Number.isFinite(v2)) ? Math.max(...loads) : null,
    computeMs: compute,
    meanDecisionMs: times.length ? times.reduce((s, n2) => s + n2, 0) / times.length : null,
    p95DecisionMs: percentile(times, 0.95),
    maxDecisionMs: times.length ? Math.max(...times) : null,
    deadlineMisses: decisions.filter((d) => !d.validDeadline).length,
    fallbackCount: decisions.filter((d) => d.fallback).length,
    robotSeconds: robot,
    planningWaitSeconds: wait,
    totalSeconds: robot + wait,
    storeProxy: { crossZoneBlockers: crossZoneBlockers(stack, groups), label: "Different-department boxes vertically obstructing another department; geometric explanatory proxy, not measured store time or ranking objective.", measuredSeconds: null }
  };
}
async function runTrial(config2, algorithm, seed, options) {
  validateConfig(config2);
  if (!ALGORITHMS2.some((a) => a.id === algorithm)) throw Error("Unknown algorithm");
  if (!Number.isInteger(seed)) throw Error("Seed must be an integer");
  const scenario2 = options.scenario ? structuredClone(options.scenario) : retailScenario(config2.quantityPerSku);
  if (!scenario2.types.length || new Set(scenario2.types.map((t) => t.id)).size !== scenario2.types.length || scenario2.types.some((t) => !t.id || !Number.isInteger(t.quantity) || t.quantity < 1 || !Object.values(t.size).every((n2) => Number.isFinite(n2) && n2 > 0) || !Number.isFinite(t.weight) || t.weight <= 0) || scenario2.types.reduce((n2, t) => n2 + t.quantity, 0) > 240) throw Error("Invalid benchmark SKU inventory");
  if (![scenario2.pallet.width, scenario2.pallet.depth].every((n2) => Number.isFinite(n2) && n2 > 0) || scenario2.events.length) throw Error("Benchmark scenario must have positive pallet dimensions and no events");
  scenario2.pallet.maxHeight = config2.maxHeightMm;
  scenario2.supplyMode = "arrival";
  scenario2.arrival = { seed, pattern: "random-draw" };
  const env = new ArrivalEnvironment(scenario2), arrivals = Array.from({ length: env.total }, (_, i) => env.current(i)), pending = Object.fromEntries(scenario2.types.map((t) => [t.id, t.quantity]));
  const settings = defaultCapacityConfig().settings;
  settings.maxCandidates = config2.maxCandidates;
  settings.temporaryBuffer = false;
  settings.plannerSeed = 91473;
  const id = `cycle-${config2.cycleSeconds}:${seed}:${algorithm}`, decisionRunId = ++decisionRunCounter, decisions = [], violations = [];
  let stack = [], state, status = "finished", reason = "", processed = 0;
  let nextPlanningStart = 0, robotStart = 0, robotEnd = 0;
  for (const box of arrivals) {
    if (options.signal?.aborted) {
      status = "cancelled";
      reason = "Cancelled by user";
      break;
    }
    pending[box.typeId]--;
    const input = { runId: "common-online-trial", stepId: processed, pallet: structuredClone(scenario2.pallet), types: structuredClone(scenario2.types), constraints: structuredClone(scenario2.constraints), placements: structuredClone(stack), current: structuredClone(box), remaining: { ...pending }, algorithm: "greedy", settings: structuredClone(settings), strategyState: structuredClone(state) };
    const availableMs = availablePlanningMs(config2), searchBudgetMs = config2.searchBudgetMs ?? availableMs;
    let result;
    try {
      result = await options.planDecision({ id: `decision-${decisionRunId}-${processed}`, algorithm, input, availableMs, searchBudgetMs, mcts: config2.mcts }, options.signal);
    } catch (error) {
      if (options.signal?.aborted || error instanceof Error && error.name === "AbortError") {
        status = "cancelled";
        reason = "Cancelled by user";
        break;
      }
      status = "error";
      reason = error instanceof Error ? error.message : String(error);
      break;
    }
    if (options.signal?.aborted) {
      status = "cancelled";
      reason = "Cancelled by user";
      break;
    }
    const checkStarted = performance.now(), checked = result.candidate ? validateCandidate(input, result.candidate) : null;
    const errors = checked?.reasons ?? [], validationMs = performance.now() - checkStarted;
    if (errors.length) violations.push(...errors.map((e) => `${box.id}: ${e}`));
    const finite = [result.elapsedMs, result.planningMs].every((v) => Number.isFinite(v) && v >= 0);
    const validDeadline = finite && result.validDeadline && config2.recognitionDelaySeconds * 1e3 + result.elapsedMs + validationMs <= config2.cycleSeconds * 1e3;
    const accepted = Boolean(result.candidate && checked && !errors.length && validDeadline);
    const decisionMs = finite ? result.elapsedMs : 0, prep = (config2.recognitionDelaySeconds * 1e3 + decisionMs + validationMs) / 1e3, start2 = nextPlanningStart, end2 = start2 + prep;
    const overlap2 = Math.max(0, Math.min(end2, robotEnd) - Math.max(start2, robotStart)), exposed = Math.max(0, prep - overlap2);
    let moveStart = null, moveEnd = null;
    if (accepted) {
      stack = checked.stack;
      state = structuredClone(result.strategyState);
      moveStart = Math.max(end2, robotEnd);
      moveEnd = moveStart + config2.cycleSeconds;
      robotStart = moveStart;
      robotEnd = moveEnd;
      nextPlanningStart = moveStart;
    } else nextPlanningStart = end2;
    const trace = {
      index: processed,
      box: structuredClone(box),
      accepted,
      reason: accepted ? "Validated current-box placement" : errors.join(" / ") || (!validDeadline ? "Decision missed available deadline" : result.message || "No valid candidate"),
      placement: accepted ? structuredClone(checked.placement) : void 0,
      recognitionMs: config2.recognitionDelaySeconds * 1e3,
      planningMs: finite ? result.planningMs : 0,
      decisionMs,
      validationMs,
      availableMs,
      searchBudgetMs,
      fallback: result.fallback,
      fallbackReason: result.fallbackReason,
      validDeadline,
      watchdog: result.watchdog,
      simulations: result.simulations,
      completeScenarios: result.completeScenarios,
      searchDiagnostics: result.searchDiagnostics,
      remaining: { ...pending },
      timing: { start: start2, end: end2, robotStart: moveStart, robotEnd: moveEnd, exposedWaitSeconds: exposed, overlappedPlanningSeconds: overlap2 }
    };
    decisions.push(trace);
    processed++;
    options.onProgress?.({ algorithm, seed, completedTrials: 0, totalTrials: 1, processed, totalBoxes: arrivals.length, placements: structuredClone(stack), decision: structuredClone(trace) });
  }
  const placedIds = new Set(stack.map((p) => p.id)), unplaced = arrivals.slice(0, processed).filter((o) => !placedIds.has(o.id)), unprocessed = arrivals.slice(processed);
  if (placedIds.size !== stack.length || new Set([...stack, ...unplaced, ...unprocessed].map((p) => p.id)).size !== arrivals.length || stack.length + unplaced.length + unprocessed.length !== arrivals.length) violations.push("Box identity / quantity conservation failed");
  for (let i = 0; i < stack.length; i++) {
    const p = stack[i];
    if (stack.slice(0, i).some((q) => intersects(p, q))) violations.push(`${p.id}: independent overlap audit`);
    if (p.position.x < 0 || p.position.y < 0 || p.position.z < 0 || p.position.x + p.size.w > scenario2.pallet.width + 1e-6 || p.position.y + p.size.d > scenario2.pallet.depth + 1e-6 || top(p) > scenario2.pallet.maxHeight + 1e-6) violations.push(`${p.id}: independent boundary audit`);
  }
  if (violations.length && status === "finished") {
    status = "error";
    reason = "Independent audit failed";
  }
  return { id, algorithm, seed, config: structuredClone(config2), scenario: scenario2, status, reason, arrivals, placements: stack, unplaced, unprocessed, decisions, violations, metrics: trialMetrics(scenario2, stack, decisions, arrivals.length), sourceVersion: SOURCE_VERSION, inputFingerprint: fingerprint({ scenario: scenario2, config: config2, arrivals }) };
}

// src/engine/supervisor.ts
function createPlannerSupervisor(factory2, options = {}) {
  const now = options.now ?? (() => performance.now()), setTimer = options.setTimer ?? setTimeout, clearTimer = options.clearTimer ?? clearTimeout;
  let worker = null, ready = null, activeCancel = null, cancelStartup = null;
  const stop = () => {
    worker?.terminate();
    worker = null;
    ready = null;
  };
  const ensureReady = () => {
    if (ready) return ready;
    const w = factory2();
    worker = w;
    ready = new Promise((resolve2, reject) => {
      const timer = setTimer(() => {
        stop();
        reject(Error("Planner worker startup timeout"));
      }, options.startupTimeoutMs ?? 15e3);
      cancelStartup = () => {
        clearTimer(timer);
        cancelStartup = null;
        stop();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      w.onmessage = (event) => {
        if (worker === w && event.data.type === "ready") {
          clearTimer(timer);
          cancelStartup = null;
          resolve2();
        }
      };
      w.onerror = (event) => {
        if (worker !== w) return;
        clearTimer(timer);
        cancelStartup = null;
        stop();
        reject(Error(event.message));
      };
    });
    return ready;
  };
  const planDecision = async (request, signal) => {
    if (activeCancel) throw Error("Only one decision may be in flight");
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const readiness = ensureReady();
    const abortStartup = () => {
      cancelStartup?.();
      stop();
    };
    activeCancel = abortStartup;
    signal?.addEventListener("abort", abortStartup, { once: true });
    try {
      await readiness;
    } finally {
      signal?.removeEventListener("abort", abortStartup);
      activeCancel = null;
    }
    if (signal?.aborted || !worker) {
      stop();
      throw new DOMException("Cancelled", "AbortError");
    }
    return new Promise((resolve2, reject) => {
      const w = worker, started2 = now(), budget = Math.min(request.availableMs, request.searchBudgetMs);
      let closed = false, incumbent = null, incumbentMs = 0;
      const clean = () => {
        closed = true;
        clearTimer(timer);
        signal?.removeEventListener("abort", cancel);
        activeCancel = null;
        if (worker === w) {
          w.onmessage = null;
          w.onerror = null;
        }
      };
      const finish = (result, terminate = false) => {
        if (closed) return;
        clean();
        if (terminate) stop();
        resolve2(result);
      };
      const fallback = (reason, message) => {
        finish({
          candidate: incumbent,
          planningMs: incumbentMs,
          elapsedMs: now() - started2,
          fallback: true,
          fallbackReason: reason,
          validDeadline: incumbent !== null,
          watchdog: reason === "watchdog" || reason === "search_budget",
          simulations: 0,
          completeScenarios: 0,
          message
        }, true);
      };
      const cancel = () => {
        if (closed) return;
        clean();
        stop();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      activeCancel = cancel;
      const timer = setTimer(() => fallback(request.searchBudgetMs < request.availableMs ? "search_budget" : "watchdog", "Worker stopped at the search deadline; only an earlier validated incumbent can be used."), budget);
      signal?.addEventListener("abort", cancel, { once: true });
      w.onmessage = ({ data }) => {
        if (closed || worker !== w || data.type === "ready" || data.id !== request.id) return;
        const elapsed = now() - started2;
        if (elapsed > budget) {
          fallback(request.searchBudgetMs < request.availableMs ? "search_budget" : "watchdog", "Late worker message discarded.");
          return;
        }
        if (data.type === "incumbent") {
          if (!validateCandidate(request.input, data.candidate).reasons.length) {
            incumbent = data.candidate;
            incumbentMs = data.planningMs;
          }
        } else if (data.type === "result") {
          const errors = data.outcome.candidate ? validateCandidate(request.input, data.outcome.candidate).reasons : [];
          if (errors.length) {
            fallback("planner_error", errors.join(" / "));
            return;
          }
          finish({ ...data.outcome, elapsedMs: elapsed, validDeadline: true, watchdog: false });
        } else fallback("planner_error", data.message);
      };
      w.onerror = (event) => {
        if (!closed && worker === w) fallback("planner_error", event.message);
      };
      w.postMessage({ type: "plan", request });
    });
  };
  return { planDecision, dispose() {
    activeCancel?.();
    stop();
  } };
}

// src/metrics/clustering.ts
var department = (typeId) => Math.floor((Number(typeId.replace(/\D/g, "")) - 1) / 2);
var eps = 1e-5;
var overlap = (a, al, b, bl) => Math.max(0, Math.min(a + al, b + bl) - Math.max(a, b));
function contact(a, b) {
  const x = overlap(a.position.x, a.size.w, b.position.x, b.size.w), y = overlap(a.position.y, a.size.d, b.position.y, b.size.d), z = overlap(a.position.z, a.size.h, b.position.z, b.size.h);
  const touching = (axis, size) => Math.abs(a.position[axis] + a.size[size] - b.position[axis]) < eps || Math.abs(b.position[axis] + b.size[size] - a.position[axis]) < eps;
  const vertical = touching("z", "h") ? x * y : 0;
  return { vertical, area: vertical + (touching("x", "w") ? y * z : 0) + (touching("y", "d") ? x * z : 0) };
}
function clusteringMetrics(boxes) {
  let total2 = 0, same = 0, zone = 0, vertical = 0, sameVertical = 0;
  const edges = new Map(boxes.map((b) => [b.id, []]));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j], c = contact(a, b);
    total2 += c.area;
    vertical += c.vertical;
    if (department(a.typeId) === department(b.typeId)) zone += c.area;
    if (a.typeId === b.typeId) {
      same += c.area;
      sameVertical += c.vertical;
      if (c.area > eps) {
        edges.get(a.id).push(b.id);
        edges.get(b.id).push(a.id);
      }
    }
  }
  const seen = /* @__PURE__ */ new Set(), largest = {};
  let components = 0;
  for (const box of boxes) {
    if (seen.has(box.id)) continue;
    components++;
    const queue = [box.id];
    seen.add(box.id);
    let size = 0;
    for (let q = 0; q < queue.length; q++) {
      size++;
      for (const id of edges.get(queue[q])) if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
    largest[box.typeId] = Math.max(largest[box.typeId] ?? 0, size);
  }
  return {
    contactAreaMm2: total2,
    sameSkuContactAreaMm2: same,
    sameSkuContact: total2 ? same / total2 : null,
    sameDepartmentContact: total2 ? zone / total2 : null,
    verticalContactAreaMm2: vertical,
    sameSkuVertical: vertical ? sameVertical / vertical : null,
    largestComponentShare: boxes.length ? Object.values(largest).reduce((a, b) => a + b, 0) / boxes.length : null,
    components
  };
}

// src/metrics/footprint.ts
function footprintUnionArea(boxes) {
  const xs = [...new Set(boxes.flatMap((p) => [p.position.x, p.position.x + p.size.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = (xs[i - 1] + xs[i]) / 2;
    const intervals = boxes.filter((p) => p.position.x <= x && x < p.position.x + p.size.w).map((p) => [p.position.y, p.position.y + p.size.d]).sort((a, b) => a[0] - b[0]);
    let bottom2 = null, top2 = 0, length = 0;
    for (const [lo, hi] of intervals) {
      if (bottom2 === null) {
        bottom2 = lo;
        top2 = hi;
      } else if (lo <= top2) top2 = Math.max(top2, hi);
      else {
        length += top2 - bottom2;
        bottom2 = lo;
        top2 = hi;
      }
    }
    if (bottom2 !== null) length += top2 - bottom2;
    area += (xs[i] - xs[i - 1]) * length;
  }
  return area;
}
function footprintMetrics(boxes, pallet) {
  const base = pallet.width * pallet.depth;
  if (!(base > 0)) throw Error("Invalid pallet footprint");
  const floorContactAreaMm2 = footprintUnionArea(boxes.filter((p) => Math.abs(p.position.z) <= 1e-7));
  const projectedFootprintAreaMm2 = footprintUnionArea(boxes);
  return {
    floorContactAreaMm2,
    floorContactCoverage: floorContactAreaMm2 / base,
    projectedFootprintAreaMm2,
    projectedCoverage: projectedFootprintAreaMm2 / base
  };
}

// src/metrics/quality.ts
function qualityMetrics(placements, pallet) {
  if ([pallet.width, pallet.depth, pallet.maxHeight].some((x) => !Number.isFinite(x) || x <= 0)) throw new Error("Invalid pallet dimensions");
  if (new Set(placements.map((p) => p.id)).size !== placements.length) throw new Error("Duplicate placement identity");
  for (const p of placements) {
    if ([...Object.values(p.position), ...Object.values(p.size), p.weight, p.supportRatio, p.loadAbove].some((x) => !Number.isFinite(x))) throw new Error(`Nonfinite placement: ${p.id}`);
    if (Object.values(p.size).some((x) => x <= 0) || p.weight < 0) throw new Error(`Invalid placement geometry/mass: ${p.id}`);
  }
  const volume2 = placements.reduce((v, p) => v + p.size.w * p.size.d * p.size.h, 0);
  const massKg = placements.reduce((m, p) => m + p.weight, 0);
  const usedHeightMm = Math.max(0, ...placements.map((p) => p.position.z + p.size.h));
  const center = (axis, dimension) => massKg > 0 ? placements.reduce((s, p) => s + p.weight * (p.position[axis] + p.size[dimension] / 2), 0) / massKg : null;
  const cogXMm = center("x", "w"), cogYMm = center("y", "d"), cogHeightMm = center("z", "h");
  const knownLoads = placements.filter((p) => p.effectiveMaxLoadKg != null && Number.isFinite(p.effectiveMaxLoadKg) && p.effectiveMaxLoadKg >= 0);
  const ratios = knownLoads.map((p) => p.effectiveMaxLoadKg === 0 ? p.loadAbove > 0 ? Infinity : 0 : p.loadAbove / p.effectiveMaxLoadKg);
  const envelopeLiters = pallet.width * pallet.depth * usedHeightMm / 1e6;
  const xs = [.../* @__PURE__ */ new Set([0, pallet.width, ...placements.flatMap((p) => [p.position.x, p.position.x + p.size.w])])].sort((a, b) => a - b);
  const ys = [.../* @__PURE__ */ new Set([0, pallet.depth, ...placements.flatMap((p) => [p.position.y, p.position.y + p.size.d])])].sort((a, b) => a - b);
  let beneathLocalTopMm3 = 0;
  for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++) {
    const x = (xs[i - 1] + xs[i]) / 2, y = (ys[j - 1] + ys[j]) / 2;
    const height = Math.max(0, ...placements.filter((p) => x >= p.position.x && x < p.position.x + p.size.w && y >= p.position.y && y < p.position.y + p.size.d).map((p) => p.position.z + p.size.h));
    beneathLocalTopMm3 += (xs[i] - xs[i - 1]) * (ys[j] - ys[j - 1]) * height;
  }
  return {
    count: placements.length,
    volumeLiters: volume2 / 1e6,
    fill: volume2 / (pallet.width * pallet.depth * pallet.maxHeight),
    massKg,
    cogXMm,
    cogYMm,
    cogHeightMm,
    cogOffsetMm: cogXMm === null || cogYMm === null ? null : Math.hypot(cogXMm - pallet.width / 2, cogYMm - pallet.depth / 2),
    usedHeightMm,
    envelopeLiters,
    voidLiters: envelopeLiters - volume2 / 1e6,
    columnVoidLiters: Math.max(0, beneathLocalTopMm3 - volume2) / 1e6,
    occupiedEnvelopeFraction: envelopeLiters > 0 ? volume2 / 1e6 / envelopeLiters : null,
    minSupport: placements.length ? Math.min(...placements.map((p) => p.supportRatio)) : null,
    maxLoadRatio: knownLoads.length === placements.length && placements.length && ratios.every(Number.isFinite) ? Math.max(...ratios) : null,
    loadCapacityKnownCount: knownLoads.length,
    trappedVoidLiters: null,
    dynamicVibrationResistance: null
  };
}

// src/cluster/evaluation.ts
var SELECTION_RULE = {
  version: "cluster-selection/1",
  selectionSeeds: [21010, 21011, 21012, 21013],
  evaluationSeeds: Array.from({ length: 12 }, (_, i) => 22010 + i),
  weights: { fill: 30, floor: 25, sameSkuContact: 30, voidEfficiency: 10, balance: 5 },
  gate: "All selection runs finished, zero violations and deadline misses. ALPS selection mean fill must be within 5 percentage points of the best conventional selection mean fill.",
  rule: "Highest weighted mean on selection seeds only. Baseline = best conventional score. ALPS = best of floor-dense/cluster-floor/cluster-layer after fill gate. Lowest = lowest score among all eligible tested policies, including the deliberately dispersed control.",
  displaySeed: 22010,
  caution: "User-priority decision score, not an industry standard or universal optimality certificate. Independent evaluation never changes selected IDs or display seed."
};
var clamp = (v) => Math.max(0, Math.min(1, v));
function evaluateTrial(row) {
  const cluster = clusteringMetrics(row.placements), floor = footprintMetrics(row.placements, row.scenario.pallet), quality3 = qualityMetrics(row.placements, { ...row.scenario.pallet, maxHeight: row.config.maxHeightMm });
  const voidEfficiency = quality3.volumeLiters ? 1 - quality3.columnVoidLiters / quality3.volumeLiters : 0;
  const balance2 = 1 - row.metrics.cogHorizontalOffsetMm / (Math.hypot(row.scenario.pallet.width, row.scenario.pallet.depth) / 2);
  const score2 = 30 * clamp(quality3.fill) + 25 * clamp(floor.floorContactCoverage) + 30 * clamp(cluster.sameSkuContact ?? 0) + 10 * clamp(voidEfficiency) + 5 * clamp(balance2);
  return {
    algorithm: row.algorithm,
    seed: row.seed,
    id: row.id,
    eligible: row.status === "finished" && !row.violations.length && row.metrics.deadlineMisses === 0,
    count: row.placements.length,
    total: row.arrivals.length,
    fill: quality3.fill,
    floor: floor.floorContactCoverage,
    sameSkuContact: cluster.sameSkuContact ?? 0,
    sameSkuVertical: cluster.sameSkuVertical,
    sameDepartmentContact: cluster.sameDepartmentContact,
    componentShare: cluster.largestComponentShare,
    columnVoidLiters: quality3.columnVoidLiters,
    cogOffsetMm: row.metrics.cogHorizontalOffsetMm,
    cogHeightMm: row.metrics.cogHeightMm,
    minSupport: row.metrics.minSupportRatio,
    maxLoadRatio: row.metrics.maxLoadRatio,
    deadlineMisses: row.metrics.deadlineMisses,
    maxDecisionMs: row.metrics.maxDecisionMs,
    score: score2
  };
}

// scripts/benchmark-1000.ts
var args = process.argv.slice(2);
var arg = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw Error(`Missing ${name}`);
  return args[i + 1];
};
var integer = (name, fallback, min, max) => {
  const n2 = Number(arg(name, String(fallback)));
  if (!Number.isInteger(n2) || n2 < min || n2 > max) throw Error(`Invalid ${name}`);
  return n2;
};
var root = process.cwd();
var pilot = args.includes("--pilot");
var n = integer("--orders", integer("--n", pilot ? 2 : 1e3, 1, 1e3), 1, 1e3);
var concurrency = integer("--concurrency", 1, 1, 32);
var batchSize = integer("--batch-size", 25, 1, 1e3);
var out = resolve(root, arg("--out", `docs/benchmark-1000/${pilot ? "pilot-v2" : "evaluation-v2"}`));
var ciArg = arg("--condition", "all");
var start = integer("--start", 0, 0, n - 1);
var end = integer("--end", n, 1, n);
if (end <= start) throw Error("Empty seed range");
if (ciArg !== "all" && !CONDITIONS.some((c) => c.id === ciArg)) throw Error("Unknown condition");
var shard = ciArg === "all" && start === 0 && end === n ? "serial" : `${ciArg}-${String(start).padStart(4, "0")}-${String(end).padStart(4, "0")}`;
var shardOut = shard === "serial" ? out : join(out, "shards", shard);
var sha = (v) => createHash("sha256").update(v).digest("hex");
var atomic = (path, v) => {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(v, null, 2) + "\n");
  renameSync(path + ".tmp", path);
};
var binaryAtomic = (path, bytes) => {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path + ".tmp", bytes);
  renameSync(path + ".tmp", path);
};
var walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => f.isDirectory() ? walk(join(dir, f.name)) : [join(dir, f.name)]).sort();
var paths = [...walk(join(root, "src/engine")), ...walk(join(root, "src/metrics")), ...walk(join(root, "src/benchmark1000")), join(root, "src/cluster/evaluation.ts"), join(root, "scripts/benchmark-1000-audit.py"), join(root, "docs/benchmark-1000/STATISTICS.md"), join(root, "docs/benchmark-1000/PROTOCOL.md"), join(root, "docs/benchmark-1000/score-plan.json"), ...["benchmark-1000.ts", "benchmark-1000.mjs", "benchmark-worker.ts", "benchmark-worker.mjs", "benchmark-1000-pool.py"].map((p) => join(root, "scripts", p))];
var source = paths.map((p) => ({ path: relative(root, p), sha256: sha(readFileSync(p)) }));
var manifests = CONDITIONS.map((c, i) => ({ condition: c, scenario: workload(c), ...uniqueOrders(workload(c), n, (pilot ? 91e7 : 46e7) + i * 1e5) }));
var config = { ...DEFAULT_CONFIG, quantityPerSku: 5 };
var execution = { mode: concurrency > 1 ? "parallel-shared-machine" : "serial", concurrency, batchSize };
var signature = sha(JSON.stringify({ source, manifests, config, algorithms: BENCHMARK_ALGORITHMS, execution }));
var freezePath = join(out, "freeze.json");
if (existsSync(freezePath)) {
  const f = JSON.parse(readFileSync(freezePath, "utf8"));
  if (f.signature !== signature) throw Error("Source/protocol/execution changed: use a new versioned output directory.");
} else {
  if (!args.includes("--prepare")) throw Error("Prepare canonical freeze before launching shards: use --prepare.");
  mkdirSync(out, { recursive: true });
  for (const p of paths) {
    const target = join(out, "source-snapshot", relative(root, p));
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, readFileSync(p));
  }
  atomic(freezePath, {
    schema: "alps-paired-1000/2",
    signature,
    source,
    manifests,
    config,
    algorithms: BENCHMARK_ALGORITHMS,
    n,
    pilot,
    execution,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceGitCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() || null,
    environment: { node: process.version, cpu: cpus()[0]?.model, platform: platform(), arch: arch() },
    protocol: {
      primary: "placed volume / supplied volume",
      primaryPolicy: "floor-dense",
      baselineFamily: BENCHMARK_ALGORITHMS.filter((a) => a !== "floor-dense"),
      familySize: CONDITIONS.length * (BENCHMARK_ALGORITHMS.length - 1),
      practicalThreshold: 0.02,
      ranking: "No winner is fitted or tuned on evaluation. Report paired effects per condition and Pareto tradeoffs; describe as best among tested conditions only.",
      failures: "Retain status=error, deadline misses and rejected cargo. Cancelled/incomplete attempts are preserved separately and may be resumed; no success-only primary filtering.",
      time: "Canonical worker-thread supervisor per Node process; identical 9000ms search window and 10000ms full cycle. Native candidate/iteration caps differ and are disclosed.",
      timing: concurrency > 1 ? "Parallel shared-machine throughput and observed wall-deadline behavior under contention. Not isolated latency. Compare latency with separately saved serial pilot." : "Sequential shared-machine serial reference. Pooled raw decision times; first startup decision included, worker loading excluded by canonical supervisor.",
      scheduling: "Condition by seed-index batch. Algorithms interleaved and rotated within each seed; no adaptive allocation from observed quality. Concurrency and batch size frozen.",
      sampling: "Fixed synthetic inventory; unique arrival seeds AND unique SKU sequences within condition. Differences concern arrival orders, not 1000 different geometries.",
      conditions: "Two fixed 30-box SKU mixes (6 and 8 SKU), both at 1200mm. SKU mix changes supplied volume; compare supply acceptance within condition.",
      statistics: `Paired seed differences, ordinary 95% t intervals plus Bonferroni simultaneous intervals for the ${CONDITIONS.length * (BENCHMARK_ALGORITHMS.length - 1)} primary comparisons; no universal optimum claim.`
    }
  });
}
for (const f of source) {
  const saved = join(out, "source-snapshot", f.path);
  if (!existsSync(saved) || sha(readFileSync(saved)) !== f.sha256) throw Error(`Frozen source missing or altered: ${f.path}`);
}
if (args.includes("--prepare")) {
  process.stdout.write(JSON.stringify({ prepared: true, signature, n, total: manifests.length * n * BENCHMARK_ALGORITHMS.length, out, execution }) + "\n");
  process.exit(0);
}
mkdirSync(join(shardOut, "trials"), { recursive: true });
function factory() {
  const w = new Worker(new URL("./benchmark-worker.mjs", import.meta.url));
  const p = { onmessage: null, onerror: null, postMessage: (m) => w.postMessage(m), terminate: () => {
    void w.terminate();
  } };
  w.on("message", (data) => p.onmessage?.({ data }));
  w.on("error", (e) => p.onerror?.({ message: e.message }));
  return p;
}
var supervisor = createPlannerSupervisor(factory);
var rows = [];
var started = Date.now();
var interrupted = false;
var cancelledAttempts = existsSync(join(shardOut, "attempts")) ? readdirSync(join(shardOut, "attempts")).filter((p) => p.endsWith(".json.gz")).length : 0;
var controller = new AbortController();
process.on("SIGTERM", () => {
  interrupted = true;
  controller.abort();
});
process.on("SIGINT", () => {
  interrupted = true;
  controller.abort();
});
var selected = manifests.map((m, ci) => ({ m, ci })).filter(({ m }) => ciArg === "all" || m.condition.id === ciArg);
var total = selected.length * (end - start) * BENCHMARK_ALGORITHMS.length;
function persist(complete = false, error) {
  atomic(join(shardOut, "progress.json"), { signature, complete, pilot, n, shard, start, end, condition: ciArg, total, completed: rows.length, cancelledAttempts, startedAt: new Date(started).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString(), sessionSeconds: (Date.now() - started) / 1e3, interrupted, error, rows });
}
async function main() {
  const pending = selected.some(({ m }) => m.orders.slice(start, end).some((order3) => BENCHMARK_ALGORITHMS.some((a) => !existsSync(join(shardOut, "trials", `${m.condition.id}-${order3.seed}-${a}.json.gz`)))));
  if (pending) for (const algorithm of BENCHMARK_ALGORITHMS) {
    if (interrupted) break;
    const warm = await runTrial({ ...config, quantityPerSku: 1 }, algorithm, 99e7, { planDecision: supervisor.planDecision, signal: controller.signal });
    if (interrupted) break;
    if (warm.status !== "finished" || warm.violations.length) {
      atomic(join(shardOut, `warmup-${algorithm}-error.json`), { signature, trial: warm });
      throw Error(`Warmup failed: ${algorithm}`);
    }
  }
  outer: for (let i = start; i < end; i++) for (const { m, ci } of selected) {
    const order3 = m.orders[i], offset = (i + ci) % BENCHMARK_ALGORITHMS.length;
    const algorithms = [...BENCHMARK_ALGORITHMS.slice(offset), ...BENCHMARK_ALGORITHMS.slice(0, offset)];
    let fingerprint2;
    for (const algorithm of algorithms) {
      if (interrupted) break outer;
      const name = `${m.condition.id}-${order3.seed}-${algorithm}.json.gz`, path = join(shardOut, "trials", name);
      let trial, wallMs;
      if (existsSync(path)) {
        const saved = JSON.parse(gunzipSync(readFileSync(path)).toString());
        if (saved.signature !== signature || saved.condition !== m.condition.id) throw Error("Trace signature/condition mismatch");
        trial = saved.trial;
        wallMs = saved.wallMs;
        if (trial.status === "cancelled") throw Error("Cancelled trial cannot be a completed trace");
      } else {
        const t = performance.now();
        trial = await runTrial(config, algorithm, order3.seed, { scenario: m.scenario, planDecision: supervisor.planDecision, signal: controller.signal });
        wallMs = performance.now() - t;
        const bytes = gzipSync(JSON.stringify({ signature, condition: m.condition.id, wallMs, trial }));
        if (trial.status === "cancelled") {
          binaryAtomic(join(shardOut, "attempts", `${name}.${Date.now()}.json.gz`), bytes);
          cancelledAttempts++;
          break outer;
        }
        binaryAtomic(path, bytes);
      }
      if (fingerprint2 && fingerprint2 !== trial.inputFingerprint) throw Error("Paired input fingerprint mismatch");
      fingerprint2 = trial.inputFingerprint;
      if (JSON.stringify(trial.arrivals.map((o) => o.typeId)) !== JSON.stringify(order3.sequence)) throw Error("Frozen arrival sequence mismatch");
      if (trial.algorithm !== algorithm || trial.seed !== order3.seed) throw Error("Trace identity mismatch");
      const supplied = trial.arrivals.reduce((v, b) => v + volume(b.size), 0), e = evaluateTrial(trial);
      rows.push({
        ...e,
        condition: m.condition.id,
        status: trial.status,
        violations: trial.violations.length,
        unprocessed: trial.unprocessed.length,
        supplyAcceptance: supplied ? trial.metrics.volumeMm3 / supplied : 0,
        supplyBound: Math.min(1, supplied / (m.scenario.pallet.width * m.scenario.pallet.depth * config.maxHeightMm)),
        suppliedVolumeMm3: supplied,
        placedVolumeMm3: trial.metrics.volumeMm3,
        inputFingerprint: trial.inputFingerprint,
        computeMs: trial.metrics.computeMs,
        fallbackCount: trial.metrics.fallbackCount,
        wallMs,
        trace: relative(out, path),
        traceSha256: sha(readFileSync(path))
      });
      persist();
      if (rows.length % 8 === 0) process.stdout.write(JSON.stringify({ shard, completed: rows.length, total, condition: m.condition.id, elapsedSeconds: Math.round((Date.now() - started) / 1e3) }) + "\n");
    }
  }
  for (const f of source) if (sha(readFileSync(join(root, f.path))) !== f.sha256) throw Error(`Source changed while running: ${f.path}`);
  persist(rows.length === total && !interrupted);
  process.stdout.write(JSON.stringify({ pilot, shard, completed: rows.length, total, sessionSeconds: (Date.now() - started) / 1e3, interrupted }) + "\n");
}
main().catch((e) => {
  persist(false, String(e.stack ?? e));
  process.stderr.write(String(e.stack ?? e) + "\n");
  process.exitCode = 1;
}).finally(() => supervisor.dispose());
