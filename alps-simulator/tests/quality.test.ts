import { describe, expect, it } from 'vitest';
import { qualityMetrics, type QualityPlacement } from '../src/metrics/quality';

const pallet = { width: 400, depth: 200, maxHeight: 400 };
const box = (id: string, x: number, weight: number): QualityPlacement => ({
  id, position: { x, y: 0, z: 0 }, size: { w: 200, d: 200, h: 200 }, weight,
  supportRatio: 1, loadAbove: 0, effectiveMaxLoadKg: 10,
});

describe('physical quantities on independently calculated fixtures', () => {
  it('uses maximum allowed height for fill and mass weights for the cargo center', () => {
    const input = [box('left', 0, 1), box('right', 200, 3)];
    const snapshot = structuredClone(input);
    const m = qualityMetrics(input, pallet);
    expect(m.count).toBe(2); expect(m.volumeLiters).toBe(16); expect(m.massKg).toBe(4);
    expect(m.fill).toBe(.5);
    expect(m.cogXMm).toBe(250); expect(m.cogYMm).toBe(100);
    expect(m.cogHeightMm).toBe(100); expect(m.cogOffsetMm).toBe(50);
    expect(m.usedHeightMm).toBe(200); expect(m.envelopeLiters).toBe(16);
    expect(m.voidLiters).toBe(0); expect(m.occupiedEnvelopeFraction).toBe(1);
    expect(qualityMetrics(input, { ...pallet, maxHeight: 200 }).fill).toBe(1);
    expect(input).toEqual(snapshot);
  });

  it('reports all envelope space as void without inventing trapped-space or vibration scores', () => {
    const m = qualityMetrics([box('left', 0, 1)], pallet);
    expect(m.fill).toBe(.25); expect(m.envelopeLiters).toBe(16);
    expect(m.voidLiters).toBe(8); expect(m.occupiedEnvelopeFraction).toBe(.5);
    expect(m.trappedVoidLiters).toBeNull(); expect(m.dynamicVibrationResistance).toBeNull();
  });

  it('retains unknown center and strength for an empty pallet', () => {
    const m = qualityMetrics([], pallet);
    expect(m.count).toBe(0); expect(m.fill).toBe(0); expect(m.voidLiters).toBe(0);
    expect(m.cogXMm).toBeNull(); expect(m.cogHeightMm).toBeNull();
    expect(m.cogOffsetMm).toBeNull(); expect(m.minSupport).toBeNull();
    expect(m.occupiedEnvelopeFraction).toBeNull(); expect(m.maxLoadRatio).toBeNull();
  });

  it('distinguishes space below a column top from open space elsewhere on the pallet', () => {
    // Deliberately unsupported geometry isolates the volume definition, not physical validity.
    const floating = { ...box('floating', 0, 1), position: { x: 0, y: 0, z: 100 },
      size: { w: 100, d: 100, h: 100 }, supportRatio: 0 };
    const m = qualityMetrics([floating], { width: 200, depth: 100, maxHeight: 400 });
    expect(m.volumeLiters).toBe(1); expect(m.envelopeLiters).toBe(4);
    expect(m.voidLiters).toBe(3); expect(m.columnVoidLiters).toBe(1);
    expect(m.trappedVoidLiters).toBeNull();
  });

  it('checks known effective load capacities without treating an unknown one as safe', () => {
    const low = { ...box('low', 0, 1), loadAbove: 6, effectiveMaxLoadKg: 12 };
    const high = { ...box('high', 0, 6), position: { x: 0, y: 0, z: 200 }, supportRatio: .85 };
    const m = qualityMetrics([low, high], pallet);
    expect(m.maxLoadRatio).toBe(.5); expect(m.minSupport).toBe(.85);
    expect(m.loadCapacityKnownCount).toBe(2);
    const unknown = qualityMetrics([low, { ...high, effectiveMaxLoadKg: undefined }], pallet);
    expect(unknown.maxLoadRatio).toBeNull(); expect(unknown.loadCapacityKnownCount).toBe(1);
  });

  it('is invariant to ordering and transforms the center with translated box positions', () => {
    const input = [box('left', 0, 1), box('right', 200, 3)];
    expect(qualityMetrics(input, pallet)).toEqual(qualityMetrics([...input].reverse(), pallet));
    const shifted = input.map(b => ({ ...b, position: { ...b.position, x: b.position.x + 20 } }));
    const m = qualityMetrics(shifted, { ...pallet, width: 440 });
    expect(m.cogXMm).toBe(270); expect(m.cogOffsetMm).toBe(50);
    expect(m.volumeLiters).toBe(16); expect(m.voidLiters).toBeCloseTo(1.6);
  });

  it('rejects duplicate IDs and nonfinite dimensions before producing presentation metrics', () => {
    expect(() => qualityMetrics([box('a', 0, 1), box('a', 200, 1)], pallet)).toThrow('Duplicate');
    expect(() => qualityMetrics([box('a', 0, NaN)], pallet)).toThrow('Nonfinite');
    expect(() => qualityMetrics([], { ...pallet, maxHeight: 0 })).toThrow('Invalid');
  });
});
