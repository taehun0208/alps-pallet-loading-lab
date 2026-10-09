import type { Pallet, Vec3, Placement } from '../types';
import type { RelayWorld } from './types';
import { toLocal, toWorld } from './layout';

/** Pallet coordinates remain independent. The robot frame never moves with a pallet. */
export const palletOffset = (p: Pallet, slot = 0) => slot ? -(p.width + 300) : 0;
export const palletSlots = (w: RelayWorld) => w.secondaryCells ? [0, 1] : [0];
export const palletCell = (w: RelayWorld, robot: number, slot = 0) => slot ? w.secondaryCells![robot] : w.cells[robot];
export const palletState = (w: RelayWorld, robot: number, slot = 0) => slot ? w.stream!.secondaryCells![robot] : w.stream!.cells[robot];
export const allPallets = (w: RelayWorld) => w.cells.flatMap((_, robot) => palletSlots(w).map(pallet => ({ robot, pallet, cell: palletCell(w, robot, pallet), state: w.stream ? palletState(w, robot, pallet) : undefined })));
export const checkKey = (w: RelayWorld, robot: number, slot = 0) => w.secondaryCells ? robot * 2 + slot : robot;
export const palletToWorld = (v: Vec3, robot: number, p: Pallet, slot = 0) => toWorld({ ...v, x: v.x + palletOffset(p, slot) }, robot, p);
export const worldToPallet = (v: Vec3, robot: number, p: Pallet, slot = 0) => { const local = toLocal(v, robot, p); return { ...local, x: local.x - palletOffset(p, slot) }; };
export const robotToPallet = (v: Vec3, p: Pallet, slot = 0) => ({ ...v, x: v.x - palletOffset(p, slot) });
export const palletToRobot = (v: Vec3, p: Pallet, slot = 0) => ({ ...v, x: v.x + palletOffset(p, slot) });
export const robotStack = (w: RelayWorld, robot: number, p: Pallet): Placement[] => palletSlots(w).flatMap(slot => palletCell(w, robot, slot).placements.map(b => ({ ...b, position: palletToRobot(b.position, p, slot) })));
export const palletLabel = (robot: number, slot = 0) => `R${robot + 1} · P${slot + 1}`;
