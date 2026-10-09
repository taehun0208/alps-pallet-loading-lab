import type { Analysis,Constraints,Observation,Pallet,Placement,PlanningInput,Scenario,SearchSettings,GripPath } from '../types';
export const AREAS=['efficiency','stability','time','robustness','robot','exception'] as const;
export type Area=typeof AREAS[number];
export const AREA_NAMES:Record<Area,string>={efficiency:'적재 효율',stability:'정적 안정성',time:'작업·계산 효율',robustness:'불확정 순서 대응',robot:'로봇 기하 실행',exception:'예외 대응'};
export const DEFAULT_WEIGHTS:Record<Area,number>={efficiency:25,stability:25,time:15,robustness:20,robot:10,exception:5};
export const CASES={identical:'동일 크기',mixed:'다양한 크기',smallFirst:'작은 박스 우선',largeFirst:'큰 박스 우선',heavyLate:'무거운 박스 후입고',lightFirst:'가벼운 박스 우선 (동일 질량 정렬)',random:'완전 무작위 순서',missing:'박스 누락',resize:'규격 오인식·재관측',damaged:'파손 박스 격리',palletChange:'팔레트 규격 변경'} as const;
export type CaseId=keyof typeof CASES;
export type Outcome='complete'|'partial'|'no-placement'|'constraint-rejected'|'timeout'|'error'|'environment-blocked';
export type Violation='bounds'|'collision'|'height'|'orientation'|'load'|'support'|'payload'|'robot-path'|'protocol';
export interface BenchmarkConfig {scenario:Scenario;settings:SearchSettings;algorithms:string[];cases:CaseId[];repeats:number;seed:number;decisionMs:number;trialMs:number;probeLimit:number;includeOffline:boolean;warmupRuns?:number;robotAccelerationMmS2?:number|null}
export interface TrialSpec {algorithm:string;caseId:CaseId;seed:number;episode:number}
export interface AlgorithmEntry {version?:string;id:string;name:string;scope:'online'|'offline';family:string;description:string;plan:(input:PlanningInput)=>Analysis}
export interface TraceStep {step:number;box:Observation;placement?:Placement;path?:GripPath;decisionMs:number;disposition:string;reason:string;center:{x:number;y:number;z:number};minSupport:number|null;minMargin:number|null;pallet:Pallet}
export interface TrialRow {algorithmVersion?:string;evaluatorVersion?:string;warmup?:WarmupRecord;hardConstraints?:HardResults;proposalReasons?:string[];finalReasons?:string[];id:string;algorithm:string;scope:'online'|'offline';caseId:CaseId;seed:number;episode:number;fingerprint:string;arrivalIds:string[];outcome:Outcome;reason:string;values:Record<string,number|null>;proposalViolations:Partial<Record<Violation,number>>;candidateRejections:Record<string,number>;exceptions:{kind:string;encountered:boolean;passed:boolean;ms:number|null}[];strength:'explicit'|'assumed'|'missing';robot:'proxy'|'unverified';trace?:TraceStep[];pallet:Pallet;constraints:Constraints;timedOutStep?:number}
export interface Hooks {now?:()=>number;beforeDecision?:(step:number)=>Promise<void>|void;afterDecision?:(step:number)=>void;progress?:(row:TrialRow)=>void;aborted?:()=>boolean}
export interface Distribution {n:number;mean:number|null;median:number|null;std:number|null;min:number|null;max:number|null;p05:number|null;p95:number|null;ci95:[number,number]|null}
export interface Thresholds {utilizationTarget:number;latencyGoodMs:number;latencyBadMs:number;secondsGood:number;secondsBad:number;tippingTargetG:number}
export const DEFAULT_THRESHOLDS:Thresholds={utilizationTarget:.8,latencyGoodMs:10,latencyBadMs:1000,secondsGood:5,secondsBad:40,tippingTargetG:.3};
export interface Aggregate {algorithm:string;scope:'online'|'offline';rows:TrialRow[];metrics:Record<string,Distribution>;scores:Record<Area,number|null>;score:number|null;coverage:number;coverageKey:string;missing:Area[];safe:boolean;eligible:boolean;complete:number;failed:number;timeouts:number;rank:number|null;rankGroup:'verified'|'provisional'|'reference'|'excluded';hardConstraints:HardResults;unknown:string[]}

export const HARD_KEYS=['collision','bounds','height','orientation','load','support','payload','robotCollision','approach','sequence'] as const;
export type HardKey=typeof HARD_KEYS[number];
export type HardStatus='PASS'|'FAIL'|'NOT VERIFIED';
export interface HardResult {status:HardStatus;violations:number;checkedPlacements:number;scope:string;reason:string}
export type HardResults=Record<HardKey,HardResult>;
export interface WarmupRecord {requested:number;completed:number;outcomes:Outcome[];sameWorker:boolean}
