import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Radar } from '../src/pallet/benchmark/Radar';
import type { Aggregate } from '../src/pallet/benchmark/model';

const row = (scores: Aggregate['scores']) => ({ algorithm: 'greedy', scores } as Aggregate);
const complete = { efficiency: 80, stability: 90, time: 75, robustness: 65, robot: 85, exception: 70 };

describe('benchmark radar rendering', () => {
  it('keeps four six-vertex hexagonal guides before any measurement', () => {
    const html = renderToStaticMarkup(createElement(Radar, { data: [] }));
    const polygons = [...html.matchAll(/<polygon[^>]+points="([^"]+)"/g)];
    expect(polygons).toHaveLength(4);
    expect(polygons.every(p => p[1].split(' ').length === 6)).toBe(true);
    expect(html).toContain('실험 결과 없음');
  });
  it('closes the six measured scores without dashed gaps', () => {
    const html = renderToStaticMarkup(createElement(Radar, { data: [row(complete)] }));
    expect(html).toContain('6/6개 영역 측정');
    expect(html).not.toContain('class="bench-gap"');
    expect(html.match(/<circle/g)).toHaveLength(6);
  });
  it('closes measured points and marks missing axes without inventing scores', () => {
    const scores = { ...complete, robot: null, exception: null };
    const html = renderToStaticMarkup(createElement(Radar, { data: [row(scores)] }));
    expect(html).toContain('bench-fill bench-partial');
    expect(html).toContain('4/6개 영역 측정');
    expect(html).toContain('class="bench-gap"');
    expect(html.match(/class="bench-unmeasured"/g)).toHaveLength(2);
    expect(scores.robot).toBeNull();
    expect(scores.exception).toBeNull();
  });
  it('retains measured zero and treats nonfinite values as unavailable', () => {
    const html = renderToStaticMarkup(createElement(Radar, { data: [row({ ...complete, time: 0, robot: NaN, exception: null })] }));
    expect(html).toContain('작업·계산 효율 0.0');
    expect(html).toContain('4/6개 영역 측정');
    expect(html).not.toMatch(/(?:points|cx|cy)="[^"]*NaN/);
  });
});
