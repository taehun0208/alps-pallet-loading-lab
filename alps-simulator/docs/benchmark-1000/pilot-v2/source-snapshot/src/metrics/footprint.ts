import type { QualityPlacement } from './quality';

/** Exact rectangle union; overlap of upper-layer projections is counted once. */
export function footprintUnionArea(boxes: readonly Pick<QualityPlacement, 'position' | 'size'>[]): number {
  const xs = [...new Set(boxes.flatMap(p => [p.position.x, p.position.x + p.size.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = (xs[i - 1] + xs[i]) / 2;
    const intervals = boxes.filter(p => p.position.x <= x && x < p.position.x + p.size.w)
      .map(p => [p.position.y, p.position.y + p.size.d] as const).sort((a, b) => a[0] - b[0]);
    let bottom: number | null = null, top = 0, length = 0;
    for (const [lo, hi] of intervals) {
      if (bottom === null) { bottom = lo; top = hi; }
      else if (lo <= top) top = Math.max(top, hi);
      else { length += top - bottom; bottom = lo; top = hi; }
    }
    if (bottom !== null) length += top - bottom;
    area += (xs[i] - xs[i - 1]) * length;
  }
  return area;
}

export function footprintMetrics(boxes: readonly Pick<QualityPlacement, 'position' | 'size'>[], pallet: { width: number; depth: number }) {
  const base = pallet.width * pallet.depth;
  if (!(base > 0)) throw Error('Invalid pallet footprint');
  const floorContactAreaMm2 = footprintUnionArea(boxes.filter(p => Math.abs(p.position.z) <= 1e-7));
  const projectedFootprintAreaMm2 = footprintUnionArea(boxes);
  return { floorContactAreaMm2, floorContactCoverage: floorContactAreaMm2 / base,
    projectedFootprintAreaMm2, projectedCoverage: projectedFootprintAreaMm2 / base };
}
