/** Sequential, rule-based handling model for the actual final pallet coordinates.
 * It is not a store walking model or a robot reach/collision certification.
 * Every algorithm uses the same zone order, top-access rule and movement duration.
 */
export type RedistributionZone = 0 | 1 | 2;
export interface HandlingPoint { x: number; y: number; z: number }
export interface RedistributionBox {
  id: string; typeId: string; position: HandlingPoint;
  size: { w: number; d: number; h: number }; weight: number; color?: string;
}
export type RedistributionStage = 'pallet-to-buffer' | 'pallet-to-destination' | 'buffer-to-destination';
export interface RedistributionStep {
  index: number; boxId: string; box: RedistributionBox; zone: RedistributionZone;
  stage: RedistributionStage; from: HandlingPoint; to: HandlingPoint;
  fromSlot: number | null; toSlot: number | null;
  start: number; end: number; seconds: number;
}
export interface RedistributionOptions {
  cycleSeconds: 10 | 12;
  palletWidthMm?: number; palletDepthMm?: number; unplacedCount?: number;
  zoneOrder?: readonly RedistributionZone[];
}
export interface RedistributionPlan {
  schema: 'alps-redistribution/1'; initialBoxes: RedistributionBox[];
  zoneOrder: RedistributionZone[]; cycleSeconds: 10 | 12;
  steps: RedistributionStep[];
  bufferSlots: { slot: number; position: HandlingPoint }[];
  destinations: { boxId: string; zone: RedistributionZone; slot: number; position: HandlingPoint }[];
  finalBoxes: RedistributionBox[];
  metrics: {
    targetBoxes: number; excludedUnplaced: number; extraHandles: number;
    totalMoves: number; totalSeconds: number; secondsPer100Boxes: number | null;
    bufferPeak: number; deliveredBoxes: number; conserved: boolean;
  };
  assumptions: string[];
}

const ZONES: Record<string, RedistributionZone> = { S1: 0, S2: 0, S3: 1, S4: 1, S5: 2, S6: 2 };
const EPS = 1e-6;
const top = (b: RedistributionBox) => b.position.z + b.size.h;
const overlapXY = (a: RedistributionBox, b: RedistributionBox) =>
  a.position.x < b.position.x + b.size.w - EPS && b.position.x < a.position.x + a.size.w - EPS
  && a.position.y < b.position.y + b.size.d - EPS && b.position.y < a.position.y + a.size.d - EPS;
const intersect = (a: RedistributionBox, b: RedistributionBox) => overlapXY(a, b)
  && a.position.z < top(b) - EPS && b.position.z < top(a) - EPS;
const byTop = (a: RedistributionBox, b: RedistributionBox) => top(b) - top(a) || a.id.localeCompare(b.id);
export function redistributionZone(typeId: string): RedistributionZone {
  const zone = ZONES[typeId];
  if (zone === undefined) throw Error(`No redistribution zone for SKU: ${typeId}`);
  return zone;
}
/** All vertically higher boxes sharing the footprint obstruct a vertical extraction. */
export function redistributionBlockers(box: RedistributionBox, boxes: readonly RedistributionBox[]): RedistributionBox[] {
  return boxes.filter(other => other.id !== box.id && other.position.z >= top(box) - EPS && overlapXY(box, other)).sort(byTop);
}

export function planRedistribution(input: readonly RedistributionBox[], options: RedistributionOptions): RedistributionPlan {
  const cycle = options.cycleSeconds, width = options.palletWidthMm ?? 1200, depth = options.palletDepthMm ?? 1000;
  const excluded = options.unplacedCount ?? 0, order: RedistributionZone[] = [...(options.zoneOrder ?? [0, 1, 2])];
  if (![10, 12].includes(cycle)) throw Error('Redistribution cycle must be 10 or 12 seconds');
  if (![width, depth].every(n => Number.isFinite(n) && n > 0)) throw Error('Invalid pallet dimensions');
  if (!Number.isInteger(excluded) || excluded < 0) throw Error('Invalid unplaced count');
  if (order.length !== 3 || new Set(order).size !== 3 || order.some(z => ![0, 1, 2].includes(z))) throw Error('Zone order must contain zones 0, 1 and 2 exactly once');
  if (new Set(input.map(b => b.id)).size !== input.length) throw Error('Duplicate box identity');
  for (const b of input) {
    redistributionZone(b.typeId);
    if (!b.id || ![...Object.values(b.position), ...Object.values(b.size), b.weight].every(Number.isFinite)
      || Object.values(b.size).some(n => n <= 0) || Object.values(b.position).some(n => n < 0) || b.weight < 0) throw Error(`Invalid box geometry: ${b.id}`);
    if (b.position.x + b.size.w > width + EPS || b.position.y + b.size.d > depth + EPS) throw Error(`Box outside pallet: ${b.id}`);
  }
  for (let i = 0; i < input.length; i++) if (input.slice(i + 1).some(b => intersect(input[i], b))) throw Error(`Overlapping input boxes: ${input[i].id}`);
  const initialBoxes = structuredClone([...input]), pallet = new Map(initialBoxes.map(b => [b.id, b]));
  const buffer = new Map<string, { box: RedistributionBox; slot: number; position: HandlingPoint }>();
  const delivered = new Map<string, RedistributionBox>(), occupiedSlots = new Set<number>();
  const bufferSlots = new Map<number, HandlingPoint>(), destinationCounts = [0, 0, 0];
  const steps: RedistributionStep[] = [], destinations: RedistributionPlan['destinations'] = [];
  const pitchX = Math.max(100, ...initialBoxes.map(b => b.size.w)) + 100;
  const pitchY = Math.max(100, ...initialBoxes.map(b => b.size.d)) + 100;
  let bufferPeak = 0;
  const destinationFor = (zone: RedistributionZone) => {
    const slot = destinationCounts[zone]++;
    // Nonoverlapping staging cells are explanatory geometry, not a robot workspace claim.
    return { slot, position: { x: width + 400 + zone * 3 * pitchX + (slot % 3) * pitchX,
      y: Math.floor(slot / 3) * pitchY, z: 0 } };
  };
  const add = (box: RedistributionBox, stage: RedistributionStage, from: HandlingPoint, to: HandlingPoint,
    fromSlot: number | null, toSlot: number | null) => {
    const start = steps.length * cycle;
    steps.push({ index: steps.length, boxId: box.id, box: structuredClone(box), zone: redistributionZone(box.typeId),
      stage, from: { ...from }, to: { ...to }, fromSlot, toSlot, start, end: start + cycle, seconds: cycle });
  };
  const deliver = (box: RedistributionBox, from: HandlingPoint, fromSlot: number | null) => {
    if (delivered.has(box.id)) throw Error(`Box delivered twice: ${box.id}`);
    const zone = redistributionZone(box.typeId), target = destinationFor(zone);
    add(box, fromSlot === null ? 'pallet-to-destination' : 'buffer-to-destination', from, target.position, fromSlot, target.slot);
    if (fromSlot === null) pallet.delete(box.id);
    else { buffer.delete(box.id); occupiedSlots.delete(fromSlot); }
    destinations.push({ boxId: box.id, zone, ...target });
    delivered.set(box.id, { ...structuredClone(box), position: { ...target.position } });
  };
  const hold = (box: RedistributionBox) => {
    let slot = 0; while (occupiedSlots.has(slot)) slot++;
    const position = { x: -400 - (slot % 3 + 1) * pitchX, y: Math.floor(slot / 3) * pitchY, z: 0 };
    add(box, 'pallet-to-buffer', box.position, position, null, slot);
    pallet.delete(box.id); occupiedSlots.add(slot); bufferSlots.set(slot, position);
    buffer.set(box.id, { box, slot, position }); bufferPeak = Math.max(bufferPeak, buffer.size);
  };
  const extract = (box: RedistributionBox, currentZone: RedistributionZone) => {
    if (!pallet.has(box.id)) return;
    for (const blocker of redistributionBlockers(box, [...pallet.values()])) extract(blocker, currentZone);
    if (redistributionBlockers(box, [...pallet.values()]).length) throw Error(`Blocked vertical extraction: ${box.id}`);
    // A target-zone blocker can go directly to its destination; no artificial baseline penalty.
    if (redistributionZone(box.typeId) === currentZone) deliver(box, box.position, null); else hold(box);
  };
  for (const zone of order) {
    const wanted = initialBoxes.filter(b => redistributionZone(b.typeId) === zone).sort(byTop);
    for (const box of wanted) {
      if (delivered.has(box.id)) continue;
      const held = buffer.get(box.id);
      if (held) deliver(held.box, held.position, held.slot); else extract(box, zone);
    }
  }
  const extraHandles = steps.filter(s => s.stage === 'pallet-to-buffer').length;
  const conserved = delivered.size === initialBoxes.length && !pallet.size && !buffer.size && !occupiedSlots.size
    && destinations.length === initialBoxes.length && steps.length === initialBoxes.length + extraHandles;
  if (!conserved) throw Error('Redistribution cargo conservation failed');
  return { schema: 'alps-redistribution/1', initialBoxes, zoneOrder: order, cycleSeconds: cycle, steps,
    bufferSlots: [...bufferSlots].map(([slot, position]) => ({ slot, position })), destinations,
    finalBoxes: [...delivered.values()],
    metrics: { targetBoxes: initialBoxes.length, excludedUnplaced: excluded, extraHandles,
      totalMoves: steps.length, totalSeconds: steps.length * cycle,
      secondsPer100Boxes: initialBoxes.length ? steps.length * cycle / initialBoxes.length * 100 : null,
      bufferPeak, deliveredBoxes: delivered.size, conserved },
    assumptions: [
      'Only boxes actually placed on the source pallet are redistributed; unplaced cargo is excluded and counted separately.',
      'All policies use the same zone order and top-access handling rule. A target-zone blocker is delivered directly; other-zone blockers use a temporary slot.',
      'Every pallet-to-zone, pallet-to-buffer and buffer-to-zone movement uses the same assumed 10/12 second cycle.',
      'Buffer slots and destination cells are nonoverlapping explanatory staging locations. Space, grasp, reach, full-link collision and transport stability at these locations are not validated.',
      'This is sequential handling model time, not measured human work, store walking, shelf stocking or real robot cycle time.',
      'Compare equal target cargo where possible; seconds per 100 boxes is a normalization, not a correction for different SKU mixes or causal proof.',
    ] };
}

export interface RedistributionFrame {
  pallet: RedistributionBox[]; buffer: RedistributionBox[]; destination: RedistributionBox[];
  moving: { step: RedistributionStep; box: RedistributionBox; progress: number } | null;
  completedMoves: number; deliveredBoxes: number; done: boolean;
}
/** State projection used by replay. A carried box belongs to exactly one moving state. */
export function redistributionFrame(plan: RedistributionPlan, seconds: number): RedistributionFrame {
  if (!Number.isFinite(seconds)) throw Error('Replay time must be finite');
  const time = Math.max(0, Math.min(seconds, plan.metrics.totalSeconds));
  const pallet = new Map(plan.initialBoxes.map(b => [b.id, structuredClone(b)]));
  const buffer = new Map<string, RedistributionBox>(), destination = new Map<string, RedistributionBox>();
  let moving: RedistributionFrame['moving'] = null, completedMoves = 0;
  for (const step of plan.steps) {
    if (time < step.start) break;
    const source = step.stage === 'buffer-to-destination' ? buffer : pallet;
    const box = source.get(step.boxId);
    if (!box) throw Error(`Replay source box missing: ${step.boxId}`);
    source.delete(step.boxId);
    if (time < step.end) {
      moving = { step, box: { ...box, position: { ...step.from } }, progress: (time - step.start) / step.seconds };
      break;
    }
    const target = step.stage === 'pallet-to-buffer' ? buffer : destination;
    target.set(step.boxId, { ...box, position: { ...step.to } }); completedMoves++;
  }
  return { pallet: [...pallet.values()], buffer: [...buffer.values()], destination: [...destination.values()],
    moving, completedMoves, deliveredBoxes: destination.size, done: completedMoves === plan.steps.length };
}
