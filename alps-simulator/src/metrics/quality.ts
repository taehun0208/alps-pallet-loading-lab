/** Structural input deliberately independent of an algorithm implementation. */
export interface QualityPlacement {
  id: string;
  position: { x: number; y: number; z: number };
  size: { w: number; d: number; h: number };
  weight: number;
  supportRatio: number;
  loadAbove: number;
  /** Explicit effective allowed load from the shared physical model, if known. */
  effectiveMaxLoadKg?: number | null;
}

export interface QualityMetrics {
  count: number;
  volumeLiters: number;
  fill: number;
  massKg: number;
  cogXMm: number | null;
  cogYMm: number | null;
  cogOffsetMm: number | null;
  cogHeightMm: number | null;
  usedHeightMm: number;
  envelopeLiters: number;
  voidLiters: number;
  columnVoidLiters: number;
  occupiedEnvelopeFraction: number | null;
  minSupport: number | null;
  maxLoadRatio: number | null;
  loadCapacityKnownCount: number;
  trappedVoidLiters: null;
  dynamicVibrationResistance: null;
}

export function qualityMetrics(placements: readonly QualityPlacement[], pallet: { width: number; depth: number; maxHeight: number }): QualityMetrics {
  if ([pallet.width, pallet.depth, pallet.maxHeight].some(x => !Number.isFinite(x) || x <= 0)) throw new Error('Invalid pallet dimensions');
  if (new Set(placements.map(p => p.id)).size !== placements.length) throw new Error('Duplicate placement identity');
  for (const p of placements) {
    if ([...Object.values(p.position), ...Object.values(p.size), p.weight, p.supportRatio, p.loadAbove].some(x => !Number.isFinite(x))) throw new Error(`Nonfinite placement: ${p.id}`);
    if (Object.values(p.size).some(x => x <= 0) || p.weight < 0) throw new Error(`Invalid placement geometry/mass: ${p.id}`);
  }
  const volume = placements.reduce((v, p) => v + p.size.w * p.size.d * p.size.h, 0);
  const massKg = placements.reduce((m, p) => m + p.weight, 0);
  const usedHeightMm = Math.max(0, ...placements.map(p => p.position.z + p.size.h));
  const center = (axis: 'x' | 'y' | 'z', dimension: 'w' | 'd' | 'h') => massKg > 0
    ? placements.reduce((s, p) => s + p.weight * (p.position[axis] + p.size[dimension] / 2), 0) / massKg : null;
  const cogXMm = center('x', 'w'), cogYMm = center('y', 'd'), cogHeightMm = center('z', 'h');
  const knownLoads = placements.filter(p => p.effectiveMaxLoadKg != null && Number.isFinite(p.effectiveMaxLoadKg) && p.effectiveMaxLoadKg >= 0);
  const ratios = knownLoads.map(p => p.effectiveMaxLoadKg === 0 ? (p.loadAbove > 0 ? Infinity : 0) : p.loadAbove / p.effectiveMaxLoadKg!);
  const envelopeLiters = pallet.width * pallet.depth * usedHeightMm / 1e6;
  // Exact axis-aligned footprint partition; excludes air above each local column.
  const xs = [...new Set([0, pallet.width, ...placements.flatMap(p => [p.position.x, p.position.x + p.size.w])])].sort((a, b) => a - b);
  const ys = [...new Set([0, pallet.depth, ...placements.flatMap(p => [p.position.y, p.position.y + p.size.d])])].sort((a, b) => a - b);
  let beneathLocalTopMm3 = 0;
  for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++) {
    const x = (xs[i - 1] + xs[i]) / 2, y = (ys[j - 1] + ys[j]) / 2;
    const height = Math.max(0, ...placements.filter(p => x >= p.position.x && x < p.position.x + p.size.w && y >= p.position.y && y < p.position.y + p.size.d).map(p => p.position.z + p.size.h));
    beneathLocalTopMm3 += (xs[i] - xs[i - 1]) * (ys[j] - ys[j - 1]) * height;
  }
  return { count: placements.length, volumeLiters: volume / 1e6, fill: volume / (pallet.width * pallet.depth * pallet.maxHeight), massKg,
    cogXMm, cogYMm, cogHeightMm, cogOffsetMm: cogXMm === null || cogYMm === null ? null : Math.hypot(cogXMm - pallet.width / 2, cogYMm - pallet.depth / 2),
    usedHeightMm, envelopeLiters, voidLiters: envelopeLiters - volume / 1e6,
    columnVoidLiters: Math.max(0, beneathLocalTopMm3 - volume) / 1e6,
    occupiedEnvelopeFraction: envelopeLiters > 0 ? volume / 1e6 / envelopeLiters : null,
    minSupport: placements.length ? Math.min(...placements.map(p => p.supportRatio)) : null,
    maxLoadRatio: knownLoads.length === placements.length && placements.length && ratios.every(Number.isFinite) ? Math.max(...ratios) : null,
    loadCapacityKnownCount: knownLoads.length, trappedVoidLiters: null, dynamicVibrationResistance: null };
}

export const QUALITY_DEFINITIONS = {
  fill: 'Total placed box volume / (pallet width × depth × allowed maximum height).',
  cog: 'Cargo mass-weighted geometric box centers; uniform mass within each box, product mass may differ; pallet mass excluded.',
  cogOffsetMm: 'Horizontal distance of cargo center of mass from pallet center; static balance proxy, not transport safety.',
  voidLiters: 'Pallet footprint × used height minus placed box volume; all unoccupied envelope space, NOT trapped/inaccessible void.',
  columnVoidLiters: 'Exact axis-aligned volume below the highest box top in each horizontal footprint column minus box volume; excludes air above local tops. Not a connectivity/robot-access/trapped-void proof.',
  minSupport: 'Minimum recorded supported-area ratio over placed boxes.',
  maxLoadRatio: 'Maximum loadAbove/effectiveMaxLoadKg from shared physical model; null if capacity is unknown.',
  uncertainty: 'Student t 95% CI over independent arrival seeds; unadjusted exploratory intervals, not universal algorithm ranking.',
  pareto: 'Descriptive nondomination of eligible held-out means: maximize fill, minimize horizontal CoG offset and CoG height. Uncertainty is shown separately; no arbitrary aggregate score.',
  voidCaution: 'A shallow, sparsely loaded pallet can have less envelope void simply because its used height is lower; compare together with fill/count. A low void value alone is not better packing.',
};
