import { inspectConstraints } from './vendor/pallet/constraints';
import { oriented } from './vendor/pallet/geometry';
import type { Candidate, PlanningInput } from './types';
/** Validate identity and immutable cargo data before the shared geometric/robot checks. */
export function validateCandidate(input: PlanningInput, candidate: Candidate) {
  const p = candidate.placement, o = input.current, reasons: string[] = [];
  if (!candidate.valid) reasons.push('Candidate marked invalid');
  if (p.id !== o.id || p.typeId !== o.typeId) reasons.push('Current observation identity mismatch');
  if (!o.orientationAllowed.includes(p.orientation)) reasons.push('Disallowed orientation');
  const expected = oriented(o.size, p.orientation);
  if (['w', 'd', 'h'].some(k => Math.abs(p.size[k as keyof typeof p.size] - expected[k as keyof typeof expected]) > 1e-7)) reasons.push('Cargo dimensions changed');
  if (p.weight !== o.weight || p.maxLoadKg !== o.maxLoadKg || p.material !== o.material || p.handling !== o.handling) reasons.push('Cargo properties changed');
  if (![...Object.values(p.position), ...Object.values(p.size), p.weight].every(Number.isFinite)) reasons.push('Non-finite geometry');
  if (reasons.length) return { reasons, stack: input.placements, placement: p, path: candidate.path };
  return inspectConstraints(p, o, input.placements, input.pallet, input.constraints);
}
