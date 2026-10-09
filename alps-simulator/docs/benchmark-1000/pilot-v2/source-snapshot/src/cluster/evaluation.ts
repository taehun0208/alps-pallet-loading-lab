import {clusteringMetrics} from '../metrics/clustering';
import {footprintMetrics} from '../metrics/footprint';
import {qualityMetrics} from '../metrics/quality';
import type {TrialResult} from '../engine/types';

export const SELECTION_RULE={version:'cluster-selection/1',selectionSeeds:[21010,21011,21012,21013],evaluationSeeds:Array.from({length:12},(_,i)=>22010+i),
 weights:{fill:30,floor:25,sameSkuContact:30,voidEfficiency:10,balance:5},
 gate:'All selection runs finished, zero violations and deadline misses. ALPS selection mean fill must be within 5 percentage points of the best conventional selection mean fill.',
 rule:'Highest weighted mean on selection seeds only. Baseline = best conventional score. ALPS = best of floor-dense/cluster-floor/cluster-layer after fill gate. Lowest = lowest score among all eligible tested policies, including the deliberately dispersed control.',
 displaySeed:22010,
 caution:'User-priority decision score, not an industry standard or universal optimality certificate. Independent evaluation never changes selected IDs or display seed.'};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
export function evaluateTrial(row:TrialResult){
 const cluster=clusteringMetrics(row.placements),floor=footprintMetrics(row.placements,row.scenario.pallet),quality=qualityMetrics(row.placements,{...row.scenario.pallet,maxHeight:row.config.maxHeightMm});
 const voidEfficiency=quality.volumeLiters?1-quality.columnVoidLiters/quality.volumeLiters:0;
 const balance=1-row.metrics.cogHorizontalOffsetMm/(Math.hypot(row.scenario.pallet.width,row.scenario.pallet.depth)/2);
 const score=30*clamp(quality.fill)+25*clamp(floor.floorContactCoverage)+30*clamp(cluster.sameSkuContact??0)+10*clamp(voidEfficiency)+5*clamp(balance);
 return {algorithm:row.algorithm,seed:row.seed,id:row.id,eligible:row.status==='finished'&&!row.violations.length&&row.metrics.deadlineMisses===0,
  count:row.placements.length,total:row.arrivals.length,fill:quality.fill,floor:floor.floorContactCoverage,sameSkuContact:cluster.sameSkuContact??0,
  sameSkuVertical:cluster.sameSkuVertical,sameDepartmentContact:cluster.sameDepartmentContact,componentShare:cluster.largestComponentShare,
  columnVoidLiters:quality.columnVoidLiters,cogOffsetMm:row.metrics.cogHorizontalOffsetMm,cogHeightMm:row.metrics.cogHeightMm,
  minSupport:row.metrics.minSupportRatio,maxLoadRatio:row.metrics.maxLoadRatio,deadlineMisses:row.metrics.deadlineMisses,
  maxDecisionMs:row.metrics.maxDecisionMs,score};
}
export type Evaluated=ReturnType<typeof evaluateTrial>;
