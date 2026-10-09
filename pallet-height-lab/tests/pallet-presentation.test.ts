import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { planningSchedule, choosePolicies, defaultPresentationConfig, eligible, pairedReport, planStore, policy, runOrder, topBlockers, validatePresentationConfig } from '../src/pallet/presentation/model';
import type { OrderRun } from '../src/pallet/presentation/model';
import type { Placement } from '../src/pallet/types';

function small() { const c = defaultPresentationConfig(); c.packing.scenario.types.forEach(t => t.quantity = 1); c.packing.algorithms = ['blb']; c.packing.decisionMs = 1000; return c; }
describe('complete-order presentation experiment', () => {
  it('exposes only startup and overruns, and permits replanning during an exchange window', () => {
    expect(planningSchedule(.1, 0, true)).toEqual({ wait: .1, hidden: 0 });
    expect(planningSchedule(.05, 8, true)).toEqual({ wait: 0, hidden: .05 });
    expect(planningSchedule(10, 8, true)).toEqual({ wait: 2, hidden: 8 });
    expect(planningSchedule(12, 20, true)).toEqual({ wait: 0, hidden: 12 });
    expect(planningSchedule(10, 8, false)).toEqual({ wait: 10, hidden: 0 });
    expect(.1 + 3 * 8 + planningSchedule(10,8,true).wait).toBe(26.1);
  });
  it('preserves the entire order through robot packing and exactly one shelf operation per box', () => {
    const c = small(), r = runOrder(c, policy('blb', false), 1210, 'holdout');
    expect(eligible(r)).toBe(true); expect(r.violations).toEqual([]);
    expect(new Set(r.batches.flatMap(b => b.boxes.map(b => b.id)))).toEqual(new Set(r.arrivals));
    const stocked = r.store.events.filter(e => e.kind === 'stock').map(e => e.box);
    expect(new Set(stocked).size).toBe(6); expect(stocked).toHaveLength(6); expect(r.store.shelfSeconds).toBe(150);
    expect(r.robotSeconds).toBe(6 * 8); expect(r.computeSeconds).toBeCloseTo(r.planningWaitSeconds + r.overlappedComputeSeconds);
    expect(r.totalSeconds).toBeCloseTo(r.robotSeconds + r.planningWaitSeconds + r.exchangeSeconds + r.store.redistributionSeconds + r.store.shelfSeconds);
    let end = 0; for (const e of r.store.events) { expect(e.start).toBeCloseTo(end); expect(e.end - e.start).toBeCloseTo(e.seconds); end = e.end; }
    expect(end).toBeCloseTo(r.store.seconds); expect(r.store.events.at(-1)?.delivered).toHaveLength(6);
  });
  it('closes and replaces pallets without dropping the box that triggered the change', () => {
    const c = small(); c.packing.scenario.pallet = { width: 400, depth: 300, maxHeight: 280 }; c.packing.scenario.types = [c.packing.scenario.types[0]]; c.packing.scenario.types[0].quantity = 3;
    const r = runOrder(c, policy('blb', false), 1210, 'holdout');
    expect(eligible(r)).toBe(true); expect(r.batches).toHaveLength(3); expect(r.exchangeSeconds).toBe(40); expect(r.utilization).toBeCloseTo(1); expect(r.unplaced).toEqual([]);
  });
  it('excludes a fast-looking partial prefix when the planner exceeds its decision allowance', () => {
    const c = small(); c.packing.decisionMs = .000001;
    const r = runOrder(c, policy('blb', true), 210, 'discovery');
    expect(r.status).toBe('timeout'); expect(r.batches).toHaveLength(0); expect(r.unplaced).toHaveLength(6); expect(eligible(r)).toBe(false); expect(choosePolicies([r], c).alps).toBeNull();
  });
  it('retains impossible payloads as unplaced rather than claiming full throughput', () => {
    const c = small(); c.packing.scenario.constraints.gripper.payload = 8;
    const r = runOrder(c, policy('blb', false), 1210, 'holdout');
    expect(r.status).toBe('partial'); expect(r.unplaced).toHaveLength(6); expect(r.store.completed).toBe(0); expect(eligible(r)).toBe(false);
  });
  it('rejects duplicate or leaked evaluation seeds and invalid department mappings', () => {
    const c = small(); c.holdoutSeeds = [c.discoverySeeds[0]]; expect(() => validatePresentationConfig(c)).toThrow();
    c.holdoutSeeds = [1210,1210]; expect(() => validatePresentationConfig(c)).toThrow();
    c.holdoutSeeds = [1210]; c.packing.groups.S1 = -1; expect(() => validatePresentationConfig(c)).toThrow();
  });
  it('removes overlapping upper cartons first and respects both cart limits', () => {
    const c = small(), r = runOrder(c, policy('blb', false), 1210, 'holdout'), template = r.batches[0].boxes[0];
    const bottom: Placement = { ...template, id: 'S1-01', typeId: 'S1', position: { x: 0, y: 0, z: 0 }, size: { w: 200, d: 200, h: 200 }, weight: 12 };
    const above: Placement = { ...bottom, id: 'S3-01', typeId: 'S3', position: { x: 0, y: 0, z: 200 }, weight: 8 };
    expect(topBlockers(bottom, [bottom, above]).map(b => b.id)).toEqual([above.id]);
    const plan = planStore([{ index: 0, boxes: [bottom, above] }], c.packing.groups, { ...c.store, cartBoxes: 1, cartKg: 12 });
    expect(plan.feasible).toBe(true); const take = plan.events.filter(e => e.kind === 'take').map(e => e.box); expect(take).toEqual([above.id, bottom.id]);
    for (const e of plan.events) { expect(e.cart.length).toBeLessThanOrEqual(1); expect(e.cart.reduce((n,id) => n + [bottom, above].find(b => b.id === id)!.weight,0)).toBeLessThanOrEqual(12); }
    expect(plan.seconds).toBe(Math.min(...Object.values(plan.alternatives!).filter((v): v is number => v !== null)));
  });
  it('requires identical experiment conditions and complete paired arrivals', () => {
    const c = small(), a = runOrder(c, policy('blb', false), 1210, 'holdout'), b = runOrder(c, policy('blb', true), 1210, 'holdout');
    expect(a.arrivals).toEqual(b.arrivals); expect(a.fingerprint).toBe(b.fingerprint); expect(pairedReport([a,b], a.policy,b.policy,[1210]).n).toBe(1);
    b.fingerprint = 'different'; expect(pairedReport([a,b],a.policy,b.policy,[1210]).n).toBe(0);
  });
  it('does not change discovery selection when holdout outcomes are supplied', () => {
    const c = small(); c.discoverySeeds = [210]; const a = runOrder(c,policy('blb',true),210,'discovery');
    const holdout = { ...a, split: 'holdout' as const, policy: policy('strategy-greedy',true), totalSeconds: 0 };
    expect(choosePolicies([a,holdout],c).alps?.id).toBe(a.policy.id);
  });
  it('audits every saved replay against its timeline, final inventory, and spatial removal prerequisites', () => {
    const d = JSON.parse(readFileSync('public/presentation-example.json','utf8'));
    for (const r of d.replays as OrderRun[]) {
      expect(eligible(r)).toBe(true); const pending = new Map(r.batches.flatMap(b => b.boxes).map(b => [b.id,b]));
      for (const e of r.store.events) {
        if (e.kind === 'take') { const p = pending.get(e.box!)!; expect(p).toBeDefined(); const batch = r.batches.find(b => b.boxes.some(b => b.id === p.id))!; expect(topBlockers(p, batch.boxes.filter(b => pending.has(b.id)))).toEqual([]); pending.delete(p.id); }
        expect(e.cart.length).toBeLessThanOrEqual(d.config.store.cartBoxes);
      }
      expect(pending.size).toBe(0); expect(r.store.events.filter(e=>e.kind==='stock')).toHaveLength(24); expect(r.store.shelfSeconds).toBe(600);
    }
    expect(d.schema).toBe('alps-complete-order/2'); expect(d.report.n).toBe(20); expect(d.report.wins+d.report.losses+d.report.ties).toBe(20);
  });
});
