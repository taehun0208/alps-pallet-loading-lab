import { describe, expect, it } from 'vitest';
import { availablePlanningMs, DEFAULT_CONFIG, validateConfig } from '../src/engine/config';

describe('planning window derived from the actual operating assumptions', () => {
  it('deducts recognition and command reserve from either supported robot cycle', () => {
    expect(availablePlanningMs(DEFAULT_CONFIG)).toBe(9000);
    expect(availablePlanningMs({ ...DEFAULT_CONFIG, cycleSeconds: 12 })).toBe(11000);
    expect(availablePlanningMs({ ...DEFAULT_CONFIG, recognitionDelaySeconds: 2, reserveSeconds: 1 })).toBe(7000);
  });

  it('rejects impossible windows and budgets beyond the remaining window', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, recognitionDelaySeconds: 9 })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, searchBudgetMs: 10000 })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, reserveSeconds: NaN })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, searchBudgetMs: 9000 })).not.toThrow();
  });

  it('permits an explicit 100ms ablation without treating it as the operating deadline', () => {
    const c = { ...DEFAULT_CONFIG, searchBudgetMs: 100 };
    expect(() => validateConfig(c)).not.toThrow();
    expect(c.searchBudgetMs).toBe(100); expect(availablePlanningMs(c)).toBe(9000);
  });
});
