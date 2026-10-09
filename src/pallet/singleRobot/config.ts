// Single source of truth for single-robot experiment settings. Runners record the values they used.
import { bedOrderIds } from '../relay/streamInventory';
import { COMPACT_SEARCH,DEFAULT_SEARCH,ONLINE_SEARCH } from '../types';
import { DEFAULT_STRATEGY,type StrategyId } from '../strategies/PackingStrategy';
import type { SearchSettings,Algorithm } from '../types';

export const HARNESS_VERSION='single-robot-harness/2';
/** dev: weight selection. explore: inputs already looked at (never final). eval: final, unseen evaluation. */
export type Phase='dev'|'explore'|'eval';
export interface CaseSeeds { dataset:number;arrival:number;event:number;planner:number }

/**
 * Dataset seeds per phase. Arrival/event seeds are derived but independent streams.
 * 11-15 were looked at with the pre-fix harness and by the separate buffer experiment, so they
 * are kept as an exploration set; the final evaluation uses fresh seeds 21-24.
 */
export const PHASE_SEEDS:Record<Phase,number[]>={dev:[1,2],explore:[11,12,13,14,15],eval:[21,22,23,24]};

/**
 * Main evaluation conditions, fixed before the CoG weight is selected on development data.
 * Boundary/sensitivity variants (standing-height rule on, buffer 0/4, support 80%, adverse
 * orders) and fault events are separate suites and never pooled with the main evaluation.
 */
export const MAIN_CONDITIONS={
 standingHeightRule:false,   // project-specific neighbour rule; not a mission requirement (BED profile already disables it)
 bufferSize:2,bufferMode:'overflow',   // store only a box with no valid placement; retry after every placement
 supportRatio:.92,heavyRule:'each' as const,
 transportHardConstraint:false,   // transport margins are reported, not enforced
 futureInformation:'order-free catalogue and remaining type counts split into not-yet-arrived and observed-waiting; no preview of upcoming arrivals',
} as const;
export const caseSeeds=(dataset:number):CaseSeeds=>({dataset,arrival:1000+dataset,event:2000+dataset,planner:2026});

/**
 * BED-BPP split by original order ID, not by seed: sorted IDs, index % 3 === 0 -> development.
 * A mechanical rule fixed before any post-fix result was seen.
 */
const sortedOrders=bedOrderIds().sort(),evaluationPool=sortedOrders.filter((_,i)=>i%3!==0);
/** Evaluation-pool orders already used by the separate buffer experiment (datasets 11-14). */
const EXPLORED_ORDERS=['00100012','00100022','00100025','00100029'];
export const BED_SPLIT:Record<Phase,string[]>={dev:sortedOrders.filter((_,i)=>i%3===0),explore:evaluationPool.filter(id=>EXPLORED_ORDERS.includes(id)),eval:evaluationPool.filter(id=>!EXPLORED_ORDERS.includes(id))};
export function assertDisjointSplit(){
 const phases=Object.keys(PHASE_SEEDS) as Phase[];
 for(const a of phases)for(const b of phases){if(a>=b)continue;
  const orders=BED_SPLIT[a].filter(id=>BED_SPLIT[b].includes(id));if(orders.length)throw Error(`${a}·${b} 주문 중복: ${orders.join(', ')}`);
  const seeds=PHASE_SEEDS[a].filter(d=>PHASE_SEEDS[b].includes(d));if(seeds.length)throw Error(`${a}·${b} 데이터 시드 중복: ${seeds.join(', ')}`);}
 if(BED_SPLIT.eval.length<PHASE_SEEDS.eval.length)throw Error('평가 시드보다 미사용 BED 주문이 적습니다.');
}
/** Datasets requested for a phase must belong to that phase. */
export function assertPhaseDatasets(phase:Phase,datasets:number[]){const bad=datasets.filter(d=>!PHASE_SEEDS[phase].includes(d));if(bad.length)throw Error(`${phase} 단계에 속하지 않은 데이터 시드: ${bad.join(', ')}`);}

/** Common root candidate budget. Other search effort differs by policy and is recorded per run. */
export const CANDIDATES=64;
/**
 * CoG weight per base policy, selected on development data (seeds 1-2, core suite) under the fixed
 * MAIN_CONDITIONS with docs/benchmarks/single-robot/select_cog_weights.py (record: cog-weight-selection.json).
 * 0 = no CoG term (no weight met the rule). Changing a value requires a new run ID.
 */
export const COG_WEIGHTS:Record<string,number>={compact:0,'compact-floor':20,'greedy-inventory':0,'strategy-greedy':.2,macs:.2,'tetris-reserved':.2,'dynamic-reservation':0,lookahead:1.5,'future-hybrid':0};
/** Transport accelerations reported (assumptions, not measured vehicle values). */
export const TRANSPORT_G=[.1,.2,.3];
/** Post-hoc deadline used only to report the share of decisions under it (not enforced). */
export const REPORT_DEADLINE_MS=250;

export interface SingleRobotPolicy { id:string;label:string;algorithm:Algorithm|'compact';settings:SearchSettings;smallFloorPenalty?:boolean }
export const STRATEGIES:StrategyId[]=['strategy-greedy','macs','tetris-reserved','dynamic-reservation','lookahead','future-hybrid'];
export function strategyPolicy(id:StrategyId,com=0):SingleRobotPolicy{
 return {id:com?`${id}+cog`:id,label:id,algorithm:id,settings:{...ONLINE_SEARCH,maxCandidates:CANDIDATES,
  strategy:{...DEFAULT_STRATEGY,futureCandidates:8,lookaheadDepth:2,lookaheadSamples:3,lookaheadCandidates:4,weights:{...DEFAULT_STRATEGY.weights,com}}}};
}
export function legacyGreedyPolicy(com=0):SingleRobotPolicy{
 return {id:com?'greedy-inventory+cog':'greedy-inventory',label:'greedy-inventory',algorithm:'greedy',settings:{...DEFAULT_SEARCH,maxCandidates:CANDIDATES,weights:{...DEFAULT_SEARCH.weights,com}}};
}
export function compactPolicy(com=0,smallFloorPenalty=true):SingleRobotPolicy{
 const settings:SearchSettings={...COMPACT_SEARCH,policy:'legacy',inventoryMode:'none',temporaryBuffer:false,maxCandidates:CANDIDATES,portfolio:false,weights:{...COMPACT_SEARCH.weights,com}};
 return {id:`compact${smallFloorPenalty?'':'-floor'}${com?'+cog':''}`,label:'compact',algorithm:'compact',settings,smallFloorPenalty};
}
/** Evaluation set: every base policy, plus its `+cog` variant where the selected weight is non-zero. */
export function policies(w:Record<string,number>=COG_WEIGHTS):SingleRobotPolicy[]{
 const pairs:[string,(com:number)=>SingleRobotPolicy][]=[['compact',com=>compactPolicy(com)],['compact-floor',com=>compactPolicy(com,false)],['greedy-inventory',com=>legacyGreedyPolicy(com)],
  ...STRATEGIES.map(id=>[id,(com:number)=>strategyPolicy(id,com)] as [string,(com:number)=>SingleRobotPolicy])];
 for(const [id] of pairs)if(!(id in w))throw Error(`무게중심 가중치 미정: ${id}`);
 return pairs.flatMap(([id,make])=>w[id]>0?[make(0),make(w[id])]:[make(0)]);
}
/** CoG weight grids per scoring family (legacy terms ~100-point scale, strategy terms ~1-point scale). */
export const COG_GRID={legacy:[0,20,60,150],strategy:[0,.2,.5,1.5]};
/** Development sweep: every base policy x its family grid, IDs `<policy>@<weight>`. */
export function devSweepPolicies():SingleRobotPolicy[]{
 return [...COG_GRID.legacy.flatMap(w=>[{...compactPolicy(w),id:`compact@${w}`},{...compactPolicy(w,false),id:`compact-floor@${w}`},{...legacyGreedyPolicy(w),id:`greedy-inventory@${w}`}]),
  ...COG_GRID.strategy.flatMap(w=>STRATEGIES.map(id=>({...strategyPolicy(id,w),id:`${id}@${w}`})))];
}
