import type { Candidate, Placement, PlanningInput } from '../types';

export const STRATEGY_IDS = ['strategy-greedy','macs','tetris-reserved','dynamic-reservation','lookahead','future-hybrid'] as const;
export type StrategyId = typeof STRATEGY_IDS[number];
export const isStrategy = (id:string):id is StrategyId => (STRATEGY_IDS as readonly string[]).includes(id);
export interface StrategyWeights {
  compactness:number; support:number; stability:number; centerOfMass:number; flatness:number;
  height:number; fragmentation:number; macs:number; fpl:number; deadEnd:number;
  reservation:number; lowerSpace:number; lookahead:number;
}
export interface StrategyConfig {
  criticalK:number; futureCandidates:number; lossMode:'absolute'|'normalized';
  lookaheadDepth:number; lookaheadSamples:number; lookaheadCandidates:number; lookaheadMode:'expected'|'worst';
  approach:boolean; approachHeight:number; approachMargin:number;
  weights:StrategyWeights;
  criticalWeights:{volume:number;aspect:number;weight:number;orientation:number;scarcity:number};
}
export const DEFAULT_STRATEGY:StrategyConfig = {
  criticalK:3, futureCandidates:12, lossMode:'normalized', lookaheadDepth:3, lookaheadSamples:4,
  lookaheadCandidates:6, lookaheadMode:'expected', approach:false, approachHeight:250, approachMargin:20,
  weights:{compactness:.2,support:.15,stability:.15,centerOfMass:.1,flatness:.1,height:.15,
    fragmentation:.15,macs:1,fpl:1.5,deadEnd:25,reservation:20,lowerSpace:2,lookahead:1},
  criticalWeights:{volume:1,aspect:1,weight:1,orientation:1,scarcity:3},
};
export interface ReservedSlot { typeId:string; placement:Placement }
export interface ReservationState { algorithm:StrategyId; slots:ReservedSlot[] }
export interface CriticalInfo {
  typeId:string; quantity:number; criticality:number; shapeCritical:boolean; weightCritical:boolean;
  factors:StrategyConfig['criticalWeights']; feasibleBefore:number; feasibleAfter:number;
  lowerBefore:number; lowerAfter:number; lost:number; deadEnd:boolean;
}
export interface StrategyDebug {
  algorithm:StrategyId; selectedScore:number; scoreComponents:Record<string,number>;
  criticalBoxes:CriticalInfo[]; futurePlacementLoss:number; deadEnds:number;
  reservedSlots:ReservedSlot[]; reservationChanges:number;
  sampled:true; candidateBudget:number; sequences:string[][];
}
export interface PlacementDecision { candidateId:string|null; placement:Placement|null; score:number|null; debugInfo:StrategyDebug|null }
export interface StrategyContext {
  input:PlanningInput; config:StrategyConfig; candidates:Candidate[];
  // Memoized, data-only evaluator. No renderer, hidden queue or environment reference.
  evaluate:(candidate:Candidate,mode:StrategyId)=>StrategyDebug;
}
export interface PackingStrategy { id:StrategyId; name:string; score(components:Record<string,number>,weights:StrategyWeights):number; choosePlacement(context:StrategyContext):PlacementDecision }

// Validate at the public entry point as well as in the UI: imported configs cannot bypass budgets.
export function strategyConfig(value?:Partial<StrategyConfig>):StrategyConfig {
  const c={...DEFAULT_STRATEGY,...value,weights:{...DEFAULT_STRATEGY.weights,...value?.weights},criticalWeights:{...DEFAULT_STRATEGY.criticalWeights,...value?.criticalWeights}};
  const integer=(key:keyof StrategyConfig,min:number,max:number)=>{const n=c[key];if(typeof n!=='number'||!Number.isInteger(n)||n<min||n>max)throw Error(`전략 설정 ${key}: ${min}~${max} 정수`);};
  integer('criticalK',1,8);integer('futureCandidates',4,64);integer('lookaheadDepth',1,6);integer('lookaheadSamples',1,20);integer('lookaheadCandidates',1,16);
  for(const n of [c.approachHeight,c.approachMargin,...Object.values(c.weights),...Object.values(c.criticalWeights)])if(!Number.isFinite(n)||n<0||n>10000)throw Error('전략 가중치·접근 여유는 0~10000 유한수여야 합니다.');
  if(!['absolute','normalized'].includes(c.lossMode)||!['expected','worst'].includes(c.lookaheadMode)||typeof c.approach!=='boolean')throw Error('전략 모드 설정 오류');
  return c;
}
export function select(context:StrategyContext,mode:StrategyId):PlacementDecision {
  const evaluated=context.candidates.filter(c=>c.valid).map(candidate=>({candidate,debug:context.evaluate(candidate,mode)}));
  evaluated.sort((a,b)=>b.debug.selectedScore-a.debug.selectedScore||a.candidate.placement.position.z-b.candidate.placement.position.z||a.candidate.id.localeCompare(b.candidate.id,undefined,{numeric:true}));
  const best=evaluated[0];return best?{candidateId:best.candidate.id,placement:best.candidate.placement,score:best.debug.selectedScore,debugInfo:best.debug}:{candidateId:null,placement:null,score:null,debugInfo:null};
}
