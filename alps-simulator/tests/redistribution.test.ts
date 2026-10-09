import { describe, expect, it } from 'vitest';
import { planRedistribution, redistributionBlockers, redistributionFrame, type RedistributionBox, type RedistributionPlan } from '../src/redistribution';

const box = (id: string, typeId: string, x = 0, y = 0, z = 0): RedistributionBox => ({
  id, typeId, position: { x, y, z }, size: { w: 100, d: 100, h: 100 }, weight: 1,
});
function audit(plan: RedistributionPlan) {
  const pallet = new Map(plan.initialBoxes.map(b => [b.id, b]));
  const slots = new Map<number, string>(), delivered = new Set<string>();
  for (const step of plan.steps) {
    expect(step.end - step.start).toBe(plan.cycleSeconds);
    expect(step.start).toBe(step.index * plan.cycleSeconds);
    expect(step.from).not.toEqual(step.to);
    if (step.stage === 'buffer-to-destination') {
      expect(slots.get(step.fromSlot!)).toBe(step.boxId); slots.delete(step.fromSlot!);
    } else {
      const source = pallet.get(step.boxId)!; expect(source).toBeDefined();
      expect(redistributionBlockers(source, [...pallet.values()])).toEqual([]);
      expect(step.from).toEqual(source.position); pallet.delete(step.boxId);
    }
    if (step.stage === 'pallet-to-buffer') {
      expect(slots.has(step.toSlot!)).toBe(false); slots.set(step.toSlot!, step.boxId);
    } else { expect(delivered.has(step.boxId)).toBe(false); delivered.add(step.boxId); }
    for (const time of [step.start, step.start + step.seconds / 2, step.end]) {
      const frame = redistributionFrame(plan, time);
      const all = [...frame.pallet, ...frame.buffer, ...frame.destination, ...(frame.moving ? [frame.moving.box] : [])];
      expect(all).toHaveLength(plan.metrics.targetBoxes);
      expect(new Set(all.map(b => b.id)).size).toBe(plan.metrics.targetBoxes);
    }
  }
  expect(pallet.size).toBe(0); expect(slots.size).toBe(0); expect(delivered.size).toBe(plan.initialBoxes.length);
  const zoneRanks = plan.steps.filter(s => s.stage !== 'pallet-to-buffer').map(s => plan.zoneOrder.indexOf(s.zone));
  expect(zoneRanks).toEqual([...zoneRanks].sort((a, b) => a - b));
}

describe('fair redistribution of final pallet coordinates', () => {
  it('takes each accessible box directly to its zone without extra moves', () => {
    const boxes = [box('food', 'S1'), box('home', 'S3', 100), box('beauty', 'S5', 200)];
    const snapshot = structuredClone(boxes), p = planRedistribution(boxes, { cycleSeconds: 10, unplacedCount: 7 });
    expect(p.steps.map(s => s.zone)).toEqual([0, 1, 2]);
    expect(p.metrics).toMatchObject({ targetBoxes: 3, excludedUnplaced: 7, extraHandles: 0,
      totalMoves: 3, totalSeconds: 30, secondsPer100Boxes: 1000, bufferPeak: 0, conserved: true });
    expect(boxes).toEqual(snapshot); audit(p);
  });

  it('moves a later-zone blocker to a buffer and delivers it exactly once later', () => {
    const p = planRedistribution([box('food', 'S1'), box('beauty', 'S5', 0, 0, 100)], { cycleSeconds: 12 });
    expect(p.steps.map(s => [s.boxId, s.stage])).toEqual([
      ['beauty', 'pallet-to-buffer'], ['food', 'pallet-to-destination'], ['beauty', 'buffer-to-destination'],
    ]);
    expect(p.metrics).toMatchObject({ targetBoxes: 2, extraHandles: 1, totalMoves: 3, totalSeconds: 36, secondsPer100Boxes: 1800 });
    audit(p);
  });

  it('never buffers an accessible target-zone blocker merely to make a baseline slower', () => {
    const p = planRedistribution([box('lower', 'S1'), box('upper', 'S2', 0, 0, 100)], { cycleSeconds: 10 });
    expect(p.steps.map(s => s.boxId)).toEqual(['upper', 'lower']);
    expect(p.metrics.extraHandles).toBe(0); expect(p.metrics.totalSeconds).toBe(20); audit(p);
  });

  it('recursively clears taller overlapping obstacles and never duplicates occupied buffer slots', () => {
    const p = planRedistribution([box('food', 'S1'), box('home', 'S3', 0, 0, 100), box('beauty', 'S5', 0, 0, 200)], { cycleSeconds: 10 });
    expect(p.steps.slice(0, 3).map(s => s.boxId)).toEqual(['beauty', 'home', 'food']);
    expect(p.metrics).toMatchObject({ extraHandles: 2, bufferPeak: 2, totalMoves: 5, totalSeconds: 50 });
    expect(p.steps.slice(0, 2).map(s => s.toSlot)).toEqual([0, 1]); audit(p);
  });

  it('reuses only a released buffer slot when a later zone needs another obstacle removed', () => {
    const p = planRedistribution([
      box('food', 'S1'), box('a-home', 'S3', 0, 0, 100),
      box('z-home', 'S4', 200), box('beauty', 'S5', 200, 0, 100),
    ], { cycleSeconds: 10 });
    expect(p.metrics.extraHandles).toBe(2); expect(p.metrics.bufferPeak).toBe(1);
    expect(p.steps.filter(s => s.stage === 'pallet-to-buffer').map(s => s.toSlot)).toEqual([0, 0]); audit(p);
  });

  it('uses identical rules independent of input-array order and only scales time with cycle', () => {
    const boxes = [box('food', 'S1'), box('beauty', 'S5', 0, 0, 100), box('home', 'S3', 200)];
    const a = planRedistribution(boxes, { cycleSeconds: 10 });
    const b = planRedistribution([...boxes].reverse(), { cycleSeconds: 12 });
    expect(a.steps.map(s => [s.boxId, s.stage, s.from, s.to])).toEqual(b.steps.map(s => [s.boxId, s.stage, s.from, s.to]));
    expect(b.metrics.totalSeconds).toBe(a.metrics.totalSeconds * 1.2); audit(a); audit(b);
  });

  it('keeps completed replay boxes in unique destinations and no box remains in buffer', () => {
    const p = planRedistribution([box('food', 'S1'), box('beauty', 'S5', 0, 0, 100)], { cycleSeconds: 10 });
    const f = redistributionFrame(p, p.metrics.totalSeconds + 100);
    expect(f.done).toBe(true); expect(f.pallet).toEqual([]); expect(f.buffer).toEqual([]); expect(f.moving).toBeNull();
    expect(f.destination.map(b => b.id).sort()).toEqual(['beauty', 'food']);
    expect(new Set(p.destinations.map(d => JSON.stringify(d.position))).size).toBe(2);
  });

  it('does not invent per-box efficiency for an empty source pallet', () => {
    const p = planRedistribution([], { cycleSeconds: 10, unplacedCount: 72 });
    expect(p.metrics).toMatchObject({ targetBoxes: 0, totalMoves: 0, totalSeconds: 0, secondsPer100Boxes: null,
      deliveredBoxes: 0, conserved: true, excludedUnplaced: 72 });
    expect(redistributionFrame(p, 0)).toMatchObject({ done: true, moving: null });
  });

  it('rejects invalid sources and duplicate identities instead of silently losing boxes', () => {
    expect(() => planRedistribution([box('a', 'S1'), box('a', 'S3', 100)], { cycleSeconds: 10 })).toThrow('Duplicate');
    expect(() => planRedistribution([box('a', 'S1'), box('b', 'S3', 50)], { cycleSeconds: 10 })).toThrow('Overlapping');
    expect(() => planRedistribution([box('a', 'unknown')], { cycleSeconds: 10 })).toThrow('zone');
    expect(() => planRedistribution([box('a', 'S1', 1200)], { cycleSeconds: 10 })).toThrow('outside');
  });
});
