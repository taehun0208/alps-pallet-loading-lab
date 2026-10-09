import { describe, it, expect } from 'vitest';
import { withFleet } from '../src/pallet/relay/fleet';
import { streamInventory } from '../src/pallet/relay/streamInventory';
import { createStream, advanceStream, applyDecision, assertStreamInventory } from '../src/pallet/relay/streamEngine';
import { observedProblem, planStream } from '../src/pallet/relay/streamPlanner';
import { streamPosition, movingPickup } from '../src/pallet/relay/streamGeometry';
import { BRANCH, mainY, forkArc, pusherBoxPosition, branchReady } from '../src/pallet/relay/branchedConveyor';
import { beltBounds } from '../src/pallet/relay/conveyor';
import { scanBox, SCANNER_OFFSET } from '../src/pallet/relay/intake';
import { toWorld } from '../src/pallet/relay/layout';
import { intersects } from '../src/pallet/geometry';
import type { RelayMotion } from '../src/pallet/relay/types';

function fixture(damageRate = 0) {
  const s = withFleet(streamInventory(42, 8), { count: 4, architecture: 'floor', floorCount: 4 });
  s.pallet.conveyorMode = 'branched'; s.intake = { damageRate, thresholdMm: 8 };
  s.types.forEach(t => { t.size = { w: 320, d: 270, h: 180 }; t.weight = 4; t.maxLoadKg = 100; t.handling = undefined; t.orientations = [0, 90]; });
  return s;
}
describe('one main / robot sub-conveyors', () => {
  it('keeps the scanner then pusher upstream of every fork', () => {
    const s = fixture();
    expect(SCANNER_OFFSET).toBeLessThan(BRANCH.pusherOffset);
    for (let i = 0; i < 4; i++) expect(forkArc(i, s.pallet)).toBeGreaterThan(BRANCH.pusherOffset + 800);
    expect(beltBounds(s.pallet).right).toBeGreaterThan(beltBounds(s.pallet).left);
  });
  it('scans physical arrivals and side-pushes every defect without entering any sub-line', () => {
    const s = fixture(1); let w = createStream(s), rejected = 0;
    for (let time = .25; time <= 300; time += .25) {
      w = advanceStream(s, w, [], time).world;
      for (const b of w.boxes) {
        expect(b.flow?.transport?.kind).not.toBe('branch');
        if (b.status === 'rejecting') { rejected++; expect(b.scan?.verdict).toBe('damaged'); expect(b.flow!.reject!.from.x).toBeCloseTo(beltBounds(s.pallet).left + BRANCH.pusherOffset); }
      }
      if (w.stream!.complete) break;
    }
    expect(rejected).toBeGreaterThan(0); expect(w.boxes.every(b => b.status === 'quarantined')).toBe(true);
    const from = { x: 0, y: mainY, z: 600 }, target = { x: 20, y: -4500, z: -200 };
    expect(pusherBoxPosition(from, target, 1).z).toBe(from.z);
    expect(pusherBoxPosition(from, target, 1).y).toBeLessThan(from.y);
    expect(pusherBoxPosition(from, target, BRANCH.rejectSeconds)).toEqual(target);
    assertStreamInventory(w, []);
  });
  it('launches four arrived sub-line heads concurrently without duplicate assignments', () => {
    const s = fixture(), w = createStream(s); w.time = 100; w.stream!.inputClosed = true;
    w.boxes.forEach((b, i) => {
      if (i >= 4) { b.status = 'outfeed'; return; }
      b.status = 'belt'; b.flow = { enteredAt: 0, measuredAt: 90, passes: 0, lastReason: '', checks: {}, transport: { kind: 'branch', robot: i, arc: BRANCH.length, limit: BRANCH.length, at: 100, attempts: 0 } };
      b.scan = scanBox(b, 90, s);
    });
    const observed = observedProblem(s, w), d = planStream(observed.scenario, observed.world), result = applyDecision(s, w, [], d);
    expect(result.motions).toHaveLength(4);
    expect(new Set(result.motions.map(m => m.action.boxId)).size).toBe(4);
    assertStreamInventory(result.world, result.motions);
  });
  it('centrally routes normal cartons, uses stopped sub-line heads and never overlaps stock', () => {
    const s = fixture(); let w = createStream(s), motions: RelayMotion[] = [], peak = 0, routed = false, picked = 0;
    for (let time = .25; time < 550; time += .5) {
      ({ world: w, motions } = advanceStream(s, w, motions, time));
      const observed = observedProblem(s, w), d = planStream(observed.scenario, observed.world, motions.map(m => m.action.robot));
      const before = new Set(motions.map(m => m.action.boxId));
      ({ world: w, motions } = applyDecision(s, w, motions, d));
      for (const m of motions.filter(m => !before.has(m.action.boxId))) {
        picked++; const b = w.boxes.find(b => b.observation.id === m.action.boxId)!;
        expect(branchReady(b, m.action.robot)).toBe(true);
        const pt = movingPickup(b, m.action.tracking!.graspAt, w.stream!.speed, s.pallet, m.action.robot);
        const actual = streamPosition(b, m.action.tracking!.graspAt, w.stream!.speed, s.pallet);
        expect(toWorld({ x: pt.x + b.observation.size.w / 2, y: pt.y + b.observation.size.d / 2, z: pt.z }, m.action.robot, s.pallet)).toEqual(actual);
      }
      const boxes = w.boxes.filter(b => b.status === 'belt');
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = streamPosition(boxes[i], time, w.stream!.speed, s.pallet), b = streamPosition(boxes[j], time, w.stream!.speed, s.pallet);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(Math.hypot(320, 270));
      }
      routed ||= w.boxes.some(b => b.flow?.transport?.kind === 'branch'); peak = Math.max(peak, motions.length);
      assertStreamInventory(w, motions); if (w.stream!.complete) break;
    }
    expect(routed).toBe(true); expect(picked).toBeGreaterThanOrEqual(6); expect(peak).toBeGreaterThanOrEqual(1);
    expect(w.boxes.filter(b => b.status === 'placed')).toHaveLength(8);
    for (const cell of [...w.cells, ...w.stream!.dispatched]) for (const p of cell.placements) expect(cell.placements.some(q => q.id !== p.id && intersects(p, q))).toBe(false);
  }, 120000);
  it('handles irregular mixed cartons and seeded defects without queue overlap or inventory loss', () => {
    const s = withFleet(streamInventory(82, 24), { count: 4, architecture: 'floor', floorCount: 4 });
    s.pallet.conveyorMode = 'branched'; s.intake = { damageRate: .35, thresholdMm: 8 };
    let w = createStream(s), motions: RelayMotion[] = [];
    for (let time = .25; time < 1200; time += .5) {
      ({ world: w, motions } = advanceStream(s, w, motions, time));
      const observed = observedProblem(s, w);
      ({ world: w, motions } = applyDecision(s, w, motions, planStream(observed.scenario, observed.world, motions.map(m => m.action.robot))));
      const belt = w.boxes.filter(b => b.status === 'belt');
      for (let i = 0; i < belt.length; i++) for (let j = i + 1; j < belt.length; j++) {
        const a = streamPosition(belt[i], time, w.stream!.speed, s.pallet), b = streamPosition(belt[j], time, w.stream!.speed, s.pallet);
        const gap = (Math.hypot(belt[i].observation.size.w, belt[i].observation.size.d) + Math.hypot(belt[j].observation.size.w, belt[j].observation.size.d)) / 2;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(gap - 1e-6);
      }
      for (const b of w.boxes.filter(b => b.flow?.transport?.kind === 'branch')) expect(b.scan?.verdict).toBe('normal');
      assertStreamInventory(w, motions); if (w.stream!.complete) break;
    }
    expect(w.stream!.complete).toBe(true);
    expect(w.boxes.some(b => b.status === 'placed')).toBe(true);
    expect(w.boxes.some(b => b.status === 'quarantined')).toBe(true);
  }, 120000);
});
