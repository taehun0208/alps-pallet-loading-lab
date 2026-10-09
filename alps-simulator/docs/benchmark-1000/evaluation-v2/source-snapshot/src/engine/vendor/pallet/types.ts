import type { BoxSpec } from './packaging/spec';
import type { ReachModel } from './packaging/robot';
import type { StrategyId,StrategyConfig,StrategyDebug,ReservationState } from './strategies/PackingStrategy';
// Engine coordinates: x/y on the floor, z upwards. Minimum-corner positions, mm/kg/s.
export interface Vec3 { x:number; y:number; z:number }
export interface Dimensions { w:number; d:number; h:number }
export type Orientation=0|90|'whd'|'hwd'|'hdw'|'dhw';
export type Handling='upright'|'no-top-load';
export type Material='paper'|'plastic'|'wood'|'unknown';
export interface MaterialData { packaging?:BoxSpec; material?:Material;strengthFactor?:number;friction?:number;maxLoadKg?:number;maxLoadSource?:'synthetic';maxLoadByAxis?:Partial<Record<'w'|'d'|'h',number>> }
export interface BoxType extends MaterialData { id:string; name:string; size:Dimensions; weight:number; quantity:number; orientations:Orientation[]; color:string; handling?:Handling }
export interface StabilitySettings { maxSlenderness:number;minMarginRatio:number;lateralAccelerationG:number;loadSafetyFactor:number;slendernessMode?:'hard'|'score' }
export const DEFAULT_STABILITY:StabilitySettings={maxSlenderness:2,minMarginRatio:.1,lateralAccelerationG:.15,loadSafetyFactor:1.25};
export interface RobotLayout { count:number; architecture:'floor'|'ceiling'|'mixed'; floorCount:number }
// Optional cell-layout metadata; it does not change the pallet physical boundary.
export interface Pallet { width:number; depth:number; maxHeight:number; conveyorMode?:'straight'|'loop'|'branched';palletsPerRobot?:1|2; conveyorExtensionMm?:number; robotLayout?:RobotLayout }
export interface Constraints {
  packagingRobot?:ReachModel;
  standingHeight?:{enabled:boolean;maxRiseMm:number};
  robotMode?:'ideal'|'gripper';
  supportRatio:number; contactTolerance:number; horizontalGap:number; heavyRule:'each'|'share'|'off';
  gripper:{width:number;depth:number;height:number;mass:number;payload:number;margin:number;lift:number;speed:number;pickSeconds:number;placeSeconds:number;rotationSpeed?:number};
  reach?:{baseX:number;baseY:number;minRadius:number;maxRadius:number};
  workspace:{xMin:number;xMax:number;yMin:number;yMax:number;zMax:number};
  stability?:StabilitySettings;
}
export interface ScenarioEvent { step:number; kind:'damaged'|'missing'|'resize'; size?:Dimensions }
export interface SizeRange { min:number;max:number }
export interface DimensionRanges { w:SizeRange;d:SizeRange;h:SizeRange }
export interface SetGeneration {seed:number;typeCount:number;totalCount:number;model?:'legacy-grid'|'heterogeneous';assortment?:'individual'|'repeated';dimensions?:DimensionRanges;gridMm?:number;densityKgM3?:number}
export type ArrivalPattern='shuffle'|'large-late'|'heavy-late'|'ordered'|'random-draw';
export interface Scenario { practical?:import('./relay/practical').PracticalConfig; intake?:{damageRate:number;thresholdMm:number}; supplyMode?:'arrival'|'stock-select';generation?:SetGeneration;version:1; units:{length:'mm';weight:'kg';time:'s'}; id:string; name:string; pallet:Pallet; types:BoxType[]; constraints:Constraints; arrival:{seed:number;pattern:ArrivalPattern}; events:ScenarioEvent[] }
export interface Observation extends MaterialData { pickupPosition?:Vec3; id:string;typeId:string;size:Dimensions;weight:number;status:'normal'|'damaged'|'missing'|'resized';orientationAllowed:Orientation[];handling?:Handling }
export interface Contact { id:string; area:number; share:number; rect:{x:number;y:number;w:number;d:number};forcePoint?:{x:number;y:number} }
export interface Placement extends MaterialData { id:string; typeId:string; size:Dimensions; weight:number; position:Vec3; orientation:Orientation; supports:Contact[];supportRatio:number;loadAbove:number;handling?:Handling }
// The horizontal centre is a transmitted load resultant, with shared loads counted by reaction.
export interface SupportBalance { id:string;isBase:boolean;planeZ:number;mass:number;loadAbove:number;center:Vec3;supportCenter:Vec3;offsetMm:number;offsetRatio:number;margin:number;required:number;reserve:number }
export interface PathPoint { label:string; tcp:Vec3; carrying:boolean;hold:number;yaw?:number;pose?:Orientation }
export interface GripPath { graspFace?:string; points:PathPoint[];lengthMm:number;seconds:number;segmentSeconds:number[];model?:'ideal'|'gripper';fixedGrasp?:boolean }
export type LegacyAlgorithm='bl'|'greedy'|'rollout';
export type Algorithm=LegacyAlgorithm|StrategyId|'random';
export const LEGACY_ALGORITHMS:LegacyAlgorithm[]=['bl','greedy','rollout'];
export const ALGORITHM_NAMES:Record<Algorithm,string>={random:'무작위 배치',bl:'기본 배치 · 잔량 검사',greedy:'제약 기반 평가 · Greedy',rollout:'남은 박스 고려 · Rollout','strategy-greedy':'Greedy · 현재 박스만',macs:'MACS','tetris-reserved':'Tetris Reserved Slot','dynamic-reservation':'Dynamic Reservation',lookahead:'Lookahead','future-hybrid':'Future-Aware Hybrid'};
export interface Weights { maximum:number;mean:number;roughness:number;void:number;flat:number;balance:number;time:number;future:number;stability:number;inventory:number;foundation:number;load:number;contact?:number;futureSurface?:number }
export interface SearchSettings { strategy?:StrategyConfig; temporaryBuffer?:boolean; plannerSeed:number;topK:number;samples:number;depth:number;maxCandidates:number;weights:Weights;candidateMode?:'legacy'|'frontier';inventoryMode?:'sample-grid'|'geometry'|'none';virtualCandidates?:number;portfolio?:boolean;policy?:'online'|'legacy';reserveProbes?:number;stockPolicy?:'compact'|'size-first';interiorPacking?:boolean }
export interface InventoryAssessment { opportunity:number;fitFraction:number;foundationPenalty:number;strongerRemaining:number;types:{id:string;quantity:number;fitSites:number;sampleSites:number}[] }
export interface Features { maxHeight:number;meanHeight:number;roughness:number;blockedVolume:number;flatRatio:number;imbalance:number;workSeconds:number;slenderness:number;loadUtilization:number;inventory:InventoryAssessment;contactRatio?:number;futureSurfacePenalty?:number;lowerBalance?:number;interiorVoid?:number;enclosedVoid?:number;packingEnvelope?:number }
export interface Terms { maximum:number;mean:number;roughness:number;void:number;flat:number;balance:number;time:number;stability:number;inventory:number;foundation:number;load:number;contact:number;futureSurface:number;lowerBalance?:number;reservation?:number;compact?:number }
export interface RemainingSites { fitFraction:number;opportunity:number;tested:number;types:{id:string;quantity:number;fitSites:number;sampleSites:number;reasons:string[]}[] }
export interface Candidate { strategyDebug?:StrategyDebug;
  id:string;placement:Placement;valid:boolean;reasons:string[];path:GripPath;features:Features;terms:Terms;fastScore:number;score:number;
  future:null|{added:number;volume:number;finalHeight:number;blocked:number;sequences:string[][];policies?:string[]};
  reservation?:{before:RemainingSites;after:RemainingSites;lostFraction:number};
  remainingCheck?:'pending'|'checked';
}
export interface PlanningInput { strategyState?:ReservationState;
  buffer?:DeferredBox[];
  runId:string;stepId:number;pallet:Pallet;types:BoxType[];constraints:Constraints;
  placements:Placement[];current:Observation;remaining:Record<string,number>;available?:Observation[];algorithm:Algorithm;settings:SearchSettings;
}
export interface DeferredBox { observation:Observation;sinceStep:number;reason:string;protects:string[];source:Vec3;reservedTop:Placement }
export interface BufferPlan { held:DeferredBox[];addedIds:string[];releasedId?:string;checkedPairs:number }
export interface Analysis { strategyDebug?:StrategyDebug; strategyState?:ReservationState; bufferPlan?:BufferPlan; runId:string;stepId:number;selectedId:string|null;selectedBoxId?:string;stockSelection?:{available:number;checkedTypes:number;deferred:{id:string;reason:string}[];foundation:number;sizePriority?:'footprint-volume'|'low-space-fit';footprintMm2?:number;volumeMm3?:number};online?:{currentOnly:true;futureSource:'remaining-counts';robot:'ideal'|'gripper-proxy';heavyRule:'each'|'share'|'off';reserveChecks:number;policy:'causal-greedy'};candidates:Candidate[];checkedCandidates?:number;generated:number;valid:number;rejections:Record<string,number>;nodes:number;rolloutCalls:number;milliseconds:number;capped:boolean;explanation:string[];virtualSequences:string[][] }
export interface StepRecord { replanCount?:number; bufferBefore?:DeferredBox[];bufferAfter?:DeferredBox[]; step:number;observation:Observation;disposition:'placed'|'excluded'|'missing'|'blocked';placement?:Placement;before:Placement[];after:Placement[];analysis:Analysis|null;remaining:Record<string,number>;algorithm:Algorithm;plannerSeed:number;reason:string;path?:GripPath;settings:SearchSettings;context?:{pallet:Pallet;constraints:Constraints} }
export interface Frame { replanCount?:number; buffer?:DeferredBox[]; processed:number;placements:Placement[];excluded:Observation[];missing:Observation[];blocked:boolean;reason:string;records:StepRecord[] }
export interface Metrics { strategyDetails?:ReturnType<typeof import('./strategies/metrics').strategyMetrics>; count:number;volume:number;weight:number;height:number;utilization:number;efficiency:number;center:Vec3;quadrants:number[];imbalance:number;distanceM:number;workSeconds:number;medianMs:number;p95Ms:number;totalMs:number;complete:boolean;failedStep:number|null;reason:string;excluded:number;missing:number;slenderness:number;loadUtilization:number;unknownCapacity:number;supportBalances?:SupportBalance[] }
export interface RunResult { runId:string;algorithm:Algorithm;seed:number;settings:SearchSettings;frame:Frame;metrics:Metrics }
export interface PhysicsSettings { seconds:number;dt:number;friction:number;moveToleranceMm:number;angleToleranceDeg:number;materialFriction?:boolean;solverIterations?:number;contactNaturalFrequencyHz?:number }
export interface PhysicsPose { id:string;planned:Vec3;actual:Vec3;rotation:[number,number,number,number];displacementMm:number;angleDeg:number;fell:boolean;friction:number }
export interface PhysicsResult { runId:string;status:'stable'|'moved'|'rotated'|'fallen';poses:PhysicsPose[];settings:PhysicsSettings;steps:number;milliseconds:number }
export const PHYSICS_LABELS={stable:'설정한 조건에서 안정',moved:'위치 변화 발생',rotated:'회전 발생',fallen:'낙하 또는 붕괴 발생'};
export const DEFAULT_SEARCH:SearchSettings={plannerSeed:2026,topK:6,samples:4,depth:3,maxCandidates:128,virtualCandidates:24,candidateMode:'frontier',inventoryMode:'geometry',portfolio:true,weights:{maximum:30,mean:16,roughness:20,void:25,flat:8,balance:12,time:4,future:45,stability:24,inventory:32,foundation:24,load:12,contact:12,futureSurface:24}};
export const ONLINE_SEARCH:SearchSettings={...DEFAULT_SEARCH,policy:'online',portfolio:false,topK:6,samples:4,depth:3,maxCandidates:96,virtualCandidates:16,reserveProbes:8};
export const COMPACT_SEARCH:SearchSettings={...ONLINE_SEARCH,stockPolicy:'compact',maxCandidates:128,interiorPacking:true,temporaryBuffer:true};
export const DEFAULT_PHYSICS:PhysicsSettings={seconds:3,dt:1/120,friction:.6,moveToleranceMm:5,angleToleranceDeg:3,materialFriction:true,solverIterations:12,contactNaturalFrequencyHz:120};
export const emptyFrame=():Frame=>({processed:0,placements:[],excluded:[],missing:[],blocked:false,reason:'',records:[]});
