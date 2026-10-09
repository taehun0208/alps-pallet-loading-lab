import { describe, expect, it } from 'vitest';
import { footprintMetrics, footprintUnionArea } from '../src/metrics/footprint';

const rectangle = (x: number, y: number, z = 0, w = 100, d = 100) => ({
  position: { x, y, z }, size: { w, d, h: 100 },
});

describe('exact pallet floor and projected footprint density', () => {
  it('counts vertically stacked footprints once rather than summing layer areas', () => {
    const m = footprintMetrics([rectangle(0, 0), rectangle(0, 0, 100)], { width: 200, depth: 100 });
    expect(m).toEqual({ floorContactAreaMm2: 10000, floorContactCoverage: .5,
      projectedFootprintAreaMm2: 10000, projectedCoverage: .5 });
  });

  it('separates direct floor contact from the projection of an upper layer', () => {
    // Geometric fixture only: this upper box's physical support is outside the helper's scope.
    const m = footprintMetrics([rectangle(0, 0), rectangle(50, 0, 100)], { width: 200, depth: 100 });
    expect(m.floorContactAreaMm2).toBe(10000); expect(m.floorContactCoverage).toBe(.5);
    expect(m.projectedFootprintAreaMm2).toBe(15000); expect(m.projectedCoverage).toBe(.75);
  });

  it('does not fill the gap between separated rectangles using their bounding box', () => {
    const boxes = [rectangle(0, 0), rectangle(200, 0)];
    expect(footprintUnionArea(boxes)).toBe(20000);
    const m = footprintMetrics(boxes, { width: 300, depth: 100 });
    expect(m.floorContactCoverage).toBeCloseTo(2 / 3, 12);
    expect(footprintUnionArea([rectangle(0, 0), rectangle(100, 0)])).toBe(20000);
  });

  it('matches inclusion-exclusion for offset rectangles with unequal dimensions', () => {
    const boxes = [rectangle(0, 0, 0, 200, 100), rectangle(50, 50, 100, 100, 200)];
    const before = structuredClone(boxes);
    expect(footprintUnionArea(boxes)).toBe(20000 + 20000 - 5000);
    expect(footprintUnionArea([...boxes].reverse())).toBe(35000);
    expect(boxes).toEqual(before);
  });

  it('returns zero occupied area for an empty pallet and rejects a zero denominator', () => {
    expect(footprintUnionArea([])).toBe(0);
    expect(footprintMetrics([], { width: 200, depth: 100 })).toEqual({
      floorContactAreaMm2: 0, floorContactCoverage: 0, projectedFootprintAreaMm2: 0, projectedCoverage: 0,
    });
    expect(() => footprintMetrics([], { width: 0, depth: 100 })).toThrow('Invalid');
  });
});
