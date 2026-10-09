import type { Algorithm,Candidate,GripPath,Observation,Placement,Vec3 } from '../types';
export type RelayKind='place'|'send'|'receive-place'|'receive-queue';
export interface RelayBox { observation:Observation;owner:number;visited:number[];forwardedAt:number[];status:'queued'|'staged'|'placed'|'pending'|'belt'|'reserved'|'rejecting'|'quarantined'|'outfeed';execution?:import('./practical').PlacementResolution;deformation?:import('./intake').Dent;scan?:import('./intake').ScanResult;flow?:{enteredAt:number;measuredAt:number;passes:number;transport?:{kind:'main'|'branch';arc:number;limit:number;at:number;robot?:number;bypass?:boolean;waitingSince?:number;attempts:number};reject?:{startedAt:number;from:Vec3};roller?:{arc:number;limit:number;at:number;waitingSince?:number;attempts:number};lastReason:string;checks:Record<number,{version:number;at:number;reason:string;blocked:number;tested:number}>} }
export interface RelayCell { queue:string[];placements:Placement[];version:number }
export interface RelayRecord { pallet?:number;step:number;kind:RelayKind;robot:number;boxId:string;from:number;to?:number;reason:string;position?:Vec3;started:number;finished:number }
export interface RelayPad { boxId:string|null;version:number;departedAt:number;readyAt:number;arrived:boolean }
export interface RelayWorld { secondaryCells?:RelayCell[];runId:string;revision:number;cursor:number;boxes:RelayBox[];cells:RelayCell[];pads:RelayPad[];records:RelayRecord[];time:number;stream?:FlowState }
export interface FlowCellState {phase:'loading'|'checking'|'outbound'|'returning';since:number;cycle:number;lastPlaced:number;rejected:string[]}
export interface FlowState {secondaryCells?:FlowCellState[]; speed:number;nextInfeed:number;entered:number;measured:number;passes:number;complete:boolean;inputClosed:boolean;cells:FlowCellState[];dispatched:{pallet?:number;robot:number;cycle:number;placements:Placement[];at:number}[] }
export interface RelaySegment { robot:number;from:Vec3;to:Vec3;seconds:number;carrying:boolean;yawFrom:number;yawTo:number;label:string }
export interface RelayAction { pallet?:number;runId:string;revision:number;cellVersion:number;padVersion?:number;pad?:number;robot:number;kind:RelayKind;boxId:string;from:number;to?:number;reason:string;candidate?:Candidate;path?:GripPath;pickup?:Vec3;segments?:RelaySegment[];seconds:number;initialCenter:Vec3;tracking?:{enteredAt:number;graspAt:number;releaseAt:number} }
export interface RelayMotion { action:RelayAction;started:number;elapsed:number;progress:number }
export interface RelayDecision { actions:RelayAction[];reasons:string[];milliseconds:number;compute?:{calls:number;generated:number;checked:number;cacheHits:number} }

export type RelayAlgorithm=Algorithm|'height-fill';
