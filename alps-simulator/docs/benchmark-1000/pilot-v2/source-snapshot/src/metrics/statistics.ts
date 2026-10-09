/** Descriptive statistics use independent arrival seeds as the sampling unit. */
export interface Estimate {
  n: number;
  mean: number | null;
  sd: number | null;
  ci95: [number, number] | null;
  min: number | null;
  max: number | null;
  observations: number[];
}

const T975 = [0, 12.7062047364, 4.3026527297, 3.1824463053, 2.7764451052,
  2.5705818356, 2.4469118511, 2.3646242510, 2.3060041352, 2.2621571629,
  2.2281388520, 2.2009851601, 2.1788128297, 2.1603686565, 2.1447866879,
  2.1314495456, 2.1199052992, 2.1098155778, 2.1009220402, 2.0930240544,
  2.0859634473, 2.0796138447, 2.0738730679, 2.0686576104, 2.0638985616,
  2.0595385528, 2.0555294386, 2.0518305165, 2.0484071418, 2.0452296421,
  2.0422724563];

export function tCritical95(df: number): number {
  if (df < 1 || !Number.isInteger(df)) throw new Error('Positive integer degrees of freedom required');
  if (df < T975.length) return T975[df];
  // Cornish-Fisher expansion; exact lookup covers this experiment's n=5.
  const z = 1.959963984540054;
  return z + (z ** 3 + z) / (4 * df)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
    + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

export function estimate(input: readonly number[]): Estimate {
  if (input.some(value => !Number.isFinite(value))) throw new Error('Nonfinite observation');
  const observations = [...input];
  const n = observations.length;
  if (!n) return { n, mean: null, sd: null, ci95: null, min: null, max: null, observations };
  const mean = observations.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(observations.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : null;
  const half = sd === null ? null : tCritical95(n - 1) * sd / Math.sqrt(n);
  return { n, mean, sd, ci95: half === null ? null : [mean - half, mean + half],
    min: Math.min(...observations), max: Math.max(...observations), observations };
}

/** UI-friendly alias; same seed-level Student-t estimate, not a different score. */
export const distribution = estimate;

/** Nearest-rank quantile, used on raw individual decisions (not averaged trial P95). */
export function percentile(input: readonly number[], q: number): number | null {
  if (q < 0 || q > 1 || !Number.isFinite(q)) throw new Error('Quantile must be in [0,1]');
  if (!input.length) return null;
  if (input.some(value => !Number.isFinite(value))) throw new Error('Nonfinite timing');
  const sorted = [...input].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

export function pairedEstimate<T extends { seed: number }>(left: readonly T[], right: readonly T[], metric: (row: T) => number): Estimate & { seeds: number[] } {
  const rightBySeed = new Map(right.map(row => [row.seed, row]));
  if (rightBySeed.size !== right.length || new Set(left.map(row => row.seed)).size !== left.length)
    throw new Error('Duplicate paired seeds');
  const pairs = left.filter(row => rightBySeed.has(row.seed)).sort((a, b) => a.seed - b.seed);
  return { ...estimate(pairs.map(row => metric(row) - metric(rightBySeed.get(row.seed)!))), seeds: pairs.map(row => row.seed) };
}

export function paretoIds<T extends { id: string }>(rows: readonly T[], objectives: readonly { value: (row: T) => number; direction: 'max' | 'min' }[]): string[] {
  if (!objectives.length) throw new Error('Pareto objectives required');
  return rows.filter(row => !rows.some(other => other !== row && objectives.every(o => {
    const a = o.value(other), b = o.value(row);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Nonfinite Pareto objective');
    return o.direction === 'max' ? a >= b : a <= b;
  }) && objectives.some(o => o.direction === 'max' ? o.value(other) > o.value(row) : o.value(other) < o.value(row)))).map(row => row.id);
}
