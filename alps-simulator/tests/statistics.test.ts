import { describe, expect, it } from 'vitest';
import { estimate, pairedEstimate, paretoIds, percentile, tCritical95 } from '../src/metrics/statistics';

describe('seed-level uncertainty and fair paired comparisons', () => {
  it('matches the analytical mean, sample variance and Student t interval for five observations', () => {
    const m = estimate([1, 2, 3, 4, 5]);
    expect(m.n).toBe(5); expect(m.mean).toBe(3); expect(m.sd).toBeCloseTo(Math.sqrt(2.5), 12);
    expect(m.ci95![0]).toBeCloseTo(1.0367568385, 9);
    expect(m.ci95![1]).toBeCloseTo(4.9632431615, 9);
    expect(m.min).toBe(1); expect(m.max).toBe(5);
  });

  it('does not fabricate uncertainty when there are fewer than two independent observations', () => {
    expect(estimate([])).toMatchObject({ n: 0, mean: null, sd: null, ci95: null });
    expect(estimate([42])).toMatchObject({ n: 1, mean: 42, sd: null, ci95: null });
    expect(estimate([7, 7, 7]).ci95).toEqual([7, 7]);
    expect(() => estimate([1, Infinity])).toThrow('Nonfinite');
    expect(() => tCritical95(0)).toThrow();
  });

  it('computes nearest-rank P95 from raw decisions without mutating the input', () => {
    const times = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(percentile(times, .95)).toBe(19); expect(percentile(times, 1)).toBe(20);
    expect(percentile(times, 0)).toBe(1); expect(percentile([], .95)).toBeNull();
    expect(times[0]).toBe(20); expect(() => percentile(times, 1.1)).toThrow();
  });

  it('pairs by seed, not array position, and discloses only the matched sample size', () => {
    const a = [{ seed: 3, value: 100 }, { seed: 2, value: 7 }, { seed: 1, value: 10 }];
    const b = [{ seed: 1, value: 8 }, { seed: 2, value: 3 }, { seed: 4, value: 999 }];
    const m = pairedEstimate(a, b, row => row.value);
    expect(m.seeds).toEqual([1, 2]); expect(m.observations).toEqual([2, 4]);
    expect(m.n).toBe(2); expect(m.mean).toBe(3);
    expect(() => pairedEstimate([a[0], a[0]], b, row => row.value)).toThrow('Duplicate');
  });

  it('retains real tradeoffs and ties while removing strictly dominated candidates', () => {
    const rows = [
      { id: 'dense', fill: .8, offset: 20 }, { id: 'balanced', fill: .7, offset: 10 },
      { id: 'dominated', fill: .6, offset: 30 }, { id: 'tie', fill: .8, offset: 20 },
    ];
    expect(paretoIds(rows, [
      { value: r => r.fill, direction: 'max' }, { value: r => r.offset, direction: 'min' },
    ])).toEqual(['dense', 'balanced', 'tie']);
  });
});
