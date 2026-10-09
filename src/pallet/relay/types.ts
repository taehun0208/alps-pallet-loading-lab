import type {OrchestrationMode,OrchestrationObjective,OrchestrationSnapshot} from './orchestrator';
import type { Algorithm,Candidate,GripPath,Observation,Placement,Vec3 } from '../types';
export type RelayKind='place'|'send'|'receive-place'|'receive-queue';
export type PalletDispatchReason='order-complete'|'height-limit'|'candidate-exhaustion';
export const PALLET_DISPATCH_LABELS:Record<PalletDispatchReason,string>={
 'order-complete':'주문 완료 · 잔량 출고',
 'height-limit':'높이 임계 도달 · 설정 상한 96%',
 'candidate-exhaustion':'제한 후보에서 추가 배치 미발견',
};
export interface RelayBox { observation:Observation;owner:number;visited:number[];forwardedAt:number[];status:'queued'|'staged'|'placed'|'pending'|'belt'|'reserved';flow?:{enteredAt:number;measuredAt:number;passes:number;lastReason:string;checks:Record<number,{version:number;at:number;retryAfter?:number;reason:string;blocked:number;tested:number}>} }
export interface RelayCell { queue:string[];placements:Placement[];version:number }
export interface RelayRecord { step:number;kind:RelayKind;robot:number;boxId:string;from:number;to?:number;reason:string;position?:Vec3;started:number;finished:number }
export interface RelayPad { boxId:string|null;version:number;departedAt:number;readyAt:number;arrived:boolean }
export interface RelayWorld { runId:string;revision:number;cursor:number;boxes:RelayBox[];cells:RelayCell[];pads:RelayPad[];records:RelayRecord[];time:number;stream?:FlowState }
export interface FlowState { orchestrationMode?:OrchestrationMode;orchestrationObjective?:OrchestrationObjective;orchestration?:OrchestrationSnapshot;speed:number;nextInfeed:number;entered:number;measured:number;passes:number;complete:boolean;inputClosed:boolean;cells:{phase:'loading'|'checking'|'outbound'|'returning';since:number;cycle:number;lastPlaced:number;rejected:string[];dispatchReason?:PalletDispatchReason}[];dispatched:{robot:number;cycle:number;placements:Placement[];at:number;dispatchReason?:PalletDispatchReason}[] }
export interface RelaySegment { robot:number;from:Vec3;to:Vec3;seconds:number;carrying:boolean;yawFrom:number;yawTo:number;label:string }
export interface RelayAction { runId:string;revision:number;cellVersion:number;padVersion?:number;pad?:number;robot:number;kind:RelayKind;boxId:string;from:number;to?:number;reason:string;candidate?:Candidate;path?:GripPath;pickup?:Vec3;segments?:RelaySegment[];seconds:number;initialCenter:Vec3;tracking?:{enteredAt:number;graspAt:number;releaseAt:number} }
export interface RelayMotion { action:RelayAction;started:number;elapsed:number;progress:number }
export interface RelayDecision { actions:RelayAction[];reasons:string[];milliseconds:number;compute?:{calls:number;generated:number;checked:number;cacheHits:number} }

export type RelayAlgorithm=Algorithm|'height-fill';
