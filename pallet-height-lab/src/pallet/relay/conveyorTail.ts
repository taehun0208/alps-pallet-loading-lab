import type { Pallet, Vec3 } from '../types';
import { beltBounds, CONVEYOR } from './conveyor';
import { cellPose } from './layout';
import { robotCount } from './fleet';

/** One quarter turn directly into the final pickup line, without a return loop. mm. */
export function tailGeometry(p: Pallet) {
  const robot = robotCount(p) - 1, x = cellPose(robot, p).x;
  const radius = 700, right = x - radius, straight = CONVEYOR.front - CONVEYOR.back - radius;
  return { right, x, robot, radius, straight, length: Math.PI * radius / 2 + straight };
}
export function tailPoint(p: Pallet, distance: number): Vec3 {
  const g = tailGeometry(p), z = CONVEYOR.deck, y = CONVEYOR.back;
  let arc = Math.max(0, Math.min(g.length, distance));
  if (arc <= Math.PI * g.radius / 2) { const a = -Math.PI / 2 + arc / g.radius; return { x: g.right + Math.cos(a) * g.radius, y: y + g.radius + Math.sin(a) * g.radius, z }; }
  arc -= Math.PI * g.radius / 2;
  return { x: g.x, y: y + g.radius + arc, z };
}
export function mainPoint(p: Pallet, arc: number): Vec3 {
  const b = beltBounds(p), length = tailGeometry(p).right - b.left;
  return arc <= length ? { x: b.left + arc, y: CONVEYOR.back, z: CONVEYOR.deck } : tailPoint(p, arc - length);
}
