import {mainPoint,tailGeometry} from './conveyorTail';
import { beltBounds, CONVEYOR } from './conveyor';
import { cellPose } from './layout';
import { SCANNER_OFFSET } from './intake';
import { footprint } from './rollerQueue';
import type { Pallet, Vec3 } from '../types';
import type { RelayBox, RelayMotion, RelayWorld } from './types';

export const BRANCH = { length: 2000, gap: 100, capacity: 2, pusherOffset: 1500, rejectSeconds: 9, pushSeconds: 2.5, waitSeconds: 30 } as const;
export const usesBranches = (p: Pallet) => p.conveyorMode === 'branched';
export const mainY = CONVEYOR.back;
// The final robot has no direct side fork: its only inlet is the rounded main tail.
export const forkArc = (robot: number, p: Pallet) => robot === tailGeometry(p).robot
  ? tailGeometry(p).right - beltBounds(p).left + tailGeometry(p).length
  : cellPose(robot, p).x - beltBounds(p).left;
export const branchReady = (b: RelayBox, robot: number) => b.flow?.transport?.kind === 'branch' && b.flow.transport.robot === robot && b.flow.transport.arc >= BRANCH.length - .01;
export function branchAvailable(w: RelayWorld, robot: number, box: RelayBox) {
  const queued = w.boxes.filter(b => b !== box && (b.status === 'belt' || b.status === 'reserved') && b.flow?.transport?.robot === robot);
  return box.observation.size.w <= CONVEYOR.width - 40 && box.observation.size.d <= CONVEYOR.width - 40 && queued.length < BRANCH.capacity && queued.reduce((n, b) => n + footprint(b) + BRANCH.gap, footprint(box)) <= BRANCH.length;
}
export function branchPosition(b: RelayBox, time: number, speed: number, p: Pallet): Vec3 {
  const t = b.flow!.transport!, arc = Math.min(t.limit, t.arc + Math.max(0, time - t.at) * speed);
  return t.kind === 'main' ? mainPoint(p, arc) : { x: cellPose(t.robot!, p).x, y: mainY + arc, z: CONVEYOR.deck };
}
export function pusherBoxPosition(from: Vec3, target: Vec3, elapsed: number): Vec3 {
  // Kinematic side stroke then gravity reject rollers; not a contact-force model.
  const t = Math.max(0, Math.min(BRANCH.rejectSeconds, elapsed));
  if (t <= BRANCH.pushSeconds) return { ...from, y: from.y - 1050 * t / BRANCH.pushSeconds };
  const u = (t - BRANCH.pushSeconds) / (BRANCH.rejectSeconds - BRANCH.pushSeconds);
  return { x: from.x + (target.x - from.x) * u, y: from.y - 1050 + (target.y - from.y + 1050) * u, z: from.z + (target.z - from.z) * u };
}
const occupied = (b: RelayBox, motions: RelayMotion[], time: number, liftSpeed: number) => b.status === 'belt' || b.status === 'reserved' && motions.some(m => m.action.boxId === b.observation.id && time < m.action.tracking!.graspAt + (b.observation.size.h + 100) / liftSpeed);

/** Physical queues run independently of the central feasibility worker. No future inventory. */
export function advanceBranches(w: RelayWorld, motions: RelayMotion[], p: Pallet, previousTime: number, liftSpeed: number) {
  const time = w.time, travel = (time - previousTime) * w.stream!.speed;
  const active = w.boxes.filter(b => b.flow?.transport && occupied(b, motions, time, liftSpeed));
  for (let robot = 0; robot < w.cells.length; robot++) {
    let ahead: RelayBox | undefined;
    for (const b of active.filter(b => b.flow!.transport!.kind === 'branch' && b.flow!.transport!.robot === robot).sort((a, b) => b.flow!.transport!.arc - a.flow!.transport!.arc)) {
      const t = b.flow!.transport!, limit = Math.min(BRANCH.length, ahead ? ahead.flow!.transport!.arc - (footprint(ahead) + footprint(b)) / 2 - BRANCH.gap : Infinity);
      if (limit < t.arc - 1e-6) throw Error('서브 벨트 대기열 간격 위반');
      t.arc = b.status === 'reserved' ? t.arc : Math.min(limit, t.arc + travel); t.limit = b.status === 'reserved' ? t.arc : limit; t.at = time;
      if (branchReady(b, robot) && t.waitingSince === undefined) t.waitingSince = time;
      ahead = b;
    }
  }
  let ahead: RelayBox | undefined;
  const pushing = w.boxes.filter(b => b.status === 'rejecting' && b.flow?.reject && time - b.flow.reject.startedAt < BRANCH.pushSeconds);
  const main = [...active.filter(b => b.flow!.transport!.kind === 'main'), ...pushing].sort((a, b) => b.flow!.transport!.arc - a.flow!.transport!.arc);
  for (const b of main) {
    const t = b.flow!.transport!, end = tailGeometry(p).right - beltBounds(p).left + tailGeometry(p).length;
    let limit = Math.min(end, ahead ? ahead.flow!.transport!.arc - (footprint(ahead) + footprint(b)) / 2 - BRANCH.gap : Infinity);
    if (b.status === 'rejecting') { t.limit = t.arc; t.at = time; ahead = b; continue; }
    if (!b.scan) limit = Math.min(limit, SCANNER_OFFSET + b.observation.size.w / 2);
    else if (b.scan.verdict === 'damaged') limit = Math.min(limit, BRANCH.pusherOffset);
    else if (t.robot !== undefined) limit = Math.min(limit, forkArc(t.robot, p));
    else if (!t.bypass) limit = Math.min(limit, BRANCH.pusherOffset + 500);
    // A turning carton occupies the fork until its whole footprint clears the main lane.
    for (const other of active.filter(q => q.flow!.transport!.kind === 'branch')) {
      const q = other.flow!.transport!, clearance = (footprint(other) + footprint(b)) / 2 + BRANCH.gap, fork = forkArc(q.robot!, p);
      if (q.arc < clearance && t.arc < fork) limit = Math.min(limit, fork - clearance);
    }
    if (limit < t.arc - 1e-6) throw Error('메인 벨트 대기열 간격 위반');
    let proposed = Math.min(limit, t.arc + travel);
    // Chord distances, rather than arc spacing alone, protect the rounded merge.
    if (proposed > tailGeometry(p).right - beltBounds(p).left - 1500) {
      const obstacles = active.filter(q => q !== b && (q.flow!.transport!.kind === 'branch' || q.flow!.transport!.arc > t.arc));
      const clear = (arc: number) => { const pt = mainPoint(p, arc); return obstacles.every(q => { const other = branchPosition(q, time, w.stream!.speed, p); return Math.hypot(pt.x - other.x, pt.y - other.y) >= (footprint(q) + footprint(b)) / 2 + BRANCH.gap - 1e-6; }); };
      if (!clear(proposed)) { let low = t.arc, high = proposed; for (let n = 0; n < 16; n++) { const mid = (low + high) / 2; if (clear(mid)) low = mid; else high = mid; } proposed = low; limit = Math.min(limit, proposed); }
    }
    t.arc = proposed; t.limit = limit; t.at = time;
    if (b.scan?.verdict === 'damaged' && t.arc >= BRANCH.pusherOffset - .01 && !w.boxes.some(q => q.status === 'rejecting')) {
      b.status = 'rejecting'; b.flow!.reject = { startedAt: time, from: branchPosition(b, time, w.stream!.speed, p) };
      b.flow!.lastReason = '입구 스캔 불량 · 분기 전 측면 푸셔 배출'; w.revision++;
    } else if (t.robot !== undefined && t.robot !== tailGeometry(p).robot && t.arc >= forkArc(t.robot, p) - .01) {
      const robot = t.robot;
      if (!active.some(q => q !== b && q.flow!.transport!.kind === 'branch' && q.flow!.transport!.robot === robot && q.flow!.transport!.arc < (footprint(q) + footprint(b)) / 2 + BRANCH.gap)) {
        t.kind = 'branch'; t.arc = 0; t.limit = 0; t.at = time; t.waitingSince = undefined;
        b.flow!.lastReason = `중앙 배차 R${robot + 1} · 서브 벨트 이송`; w.revision++;
        // Retain its old fork occupancy for this tick through an independent barrier.
        ahead = { ...b, flow: { ...b.flow!, transport: { ...t, kind: 'main', arc: forkArc(robot, p) } } }; continue;
      }
    } else if (t.robot === undefined && b.scan?.verdict === 'normal' && !t.bypass && t.arc >= BRANCH.pusherOffset + 500 - .01) {
      t.waitingSince ??= time;
      if (time - t.waitingSince >= BRANCH.waitSeconds) { t.bypass = true; b.flow!.lastReason = '중앙 배차 대기 상한 · 곡선 끝단을 따라 마지막 서브로 재검토'; w.revision++; }
    }
    if (b.status === 'belt' && t.kind === 'main' && t.arc >= end - .01) { t.kind = 'branch'; t.robot = tailGeometry(p).robot; t.arc = BRANCH.length; t.limit = BRANCH.length; t.at = time; t.waitingSince = time; t.attempts = 0; b.owner = t.robot; b.flow!.lastReason = '곡선 끝단 합류 · 마지막 로봇의 두 팔레트 재검토'; w.revision++; ahead = { ...b, flow: { ...b.flow!, transport: { ...t, kind: 'main', arc: end } } }; continue; }
    ahead = b;
  }
}
