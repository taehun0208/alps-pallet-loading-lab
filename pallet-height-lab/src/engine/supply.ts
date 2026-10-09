import { PIECES, type Piece } from './types';
export function supply(seed: number, count = 230): Piece[] {
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const result: Piece[] = [];
  while (result.length < count) {
    const bag = [...PIECES];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    result.push(...bag);
  }
  return result.slice(0, count);
}
