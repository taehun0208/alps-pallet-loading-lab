import { describe, expect, it } from 'vitest';
import { inspectConstraints } from '../src/engine/vendor/pallet/constraints';
import { retailScenario } from '../src/engine/vendor/pallet/capacity/experiment';
import type { Observation, Placement } from '../src/engine/types';

const pallet = { width: 400, depth: 400, maxHeight: 400 };
function fixture(id = 'box', weight = 1, position = { x: 0, y: 0, z: 0 }) {
  const observation: Observation = { id, typeId: id, size: { w: 100, d: 100, h: 100 }, weight,
    status: 'normal', orientationAllowed: [0], maxLoadKg: 100, maxLoadSource: 'synthetic',
    material: 'paper', friction: .45, handling: 'upright' };
  const placement: Placement = { ...observation, position, orientation: 0, supports: [], supportRatio: 1, loadAbove: 0 };
  return { observation, placement };
}

describe('shared constraint gates used for every algorithm', () => {
  it('honors the agreed strength-based policy instead of adding a weight-order ban', () => {
    const constraints = retailScenario(1).constraints;
    expect(constraints.heavyRule).toBe('off');
    const lower = fixture('lower', 1), upper = fixture('upper', 6, { x: 0, y: 0, z: 100 });
    const result = inspectConstraints(upper.placement, upper.observation, [lower.placement], pallet, constraints);
    expect(result.reasons).toEqual([]);
    expect(result.placement.supportRatio).toBe(1);
  });

  it('still rejects a strong-looking geometric placement when the supporting box capacity is exceeded', () => {
    const lower = fixture('lower', 1), upper = fixture('upper', 6, { x: 0, y: 0, z: 100 });
    lower.placement.maxLoadKg = 2;
    const result = inspectConstraints(upper.placement, upper.observation, [lower.placement], pallet, retailScenario(1).constraints);
    expect(result.reasons.join(' ')).toContain('허용 지지하중 초과');
  });

  it.each([
    ['overhang', { x: 350, y: 0, z: 0 }, '경계 밖'],
    ['height', { x: 0, y: 0, z: 350 }, '최대 적재 높이'],
    ['overlap', { x: 0, y: 0, z: 50 }, '겹침'],
    ['unsupported', { x: 70, y: 0, z: 100 }, '지지 조건'],
  ] as const)('rejects %s independently of an algorithm score', (_name, position, reason) => {
    const lower = fixture('lower'), upper = fixture('upper', 1, { ...position });
    const result = inspectConstraints(upper.placement, upper.observation, [lower.placement], pallet, retailScenario(1).constraints);
    expect(result.reasons.join(' ')).toContain(reason);
  });

  it('accounts for end-effector mass in the payload limit', () => {
    const c = retailScenario(1).constraints, item = fixture();
    c.gripper.payload = c.gripper.mass;
    expect(inspectConstraints(item.placement, item.observation, [], pallet, c).reasons.join(' ')).toContain('가반하중');
  });

  it('rejects a box pose with a clear footprint but an obstructed gripper approach', () => {
    const item = fixture(), obstacle = fixture('obstacle', 1, { x: 100, y: 0, z: 0 });
    obstacle.placement.size.h = 300;
    const result = inspectConstraints(item.placement, item.observation, [obstacle.placement], pallet, retailScenario(1).constraints);
    expect(result.reasons.join(' ')).toContain('접근 경로 간섭');
    expect(result.reasons.join(' ')).not.toContain('와 겹침');
  });

  it('keeps observed orientation and reach restrictions active', () => {
    const c = retailScenario(1).constraints, item = fixture();
    item.placement.orientation = 90;
    expect(inspectConstraints(item.placement, item.observation, [], pallet, c).reasons).toContain('허용되지 않은 회전');
    item.placement.orientation = 0; c.reach!.maxRadius = 50;
    expect(inspectConstraints(item.placement, item.observation, [], pallet, c).reasons.join(' ')).toContain('도달 반경');
  });
});
