import { volume } from '../geometry';
import type { Candidate,PlanningInput } from '../types';
import type { StrategyConfig } from './PackingStrategy';
const unit=(n:number)=>Math.max(0,Math.min(1,n));
export function currentScore(candidate:Candidate,input:PlanningInput,config:StrategyConfig){
  const f=candidate.features,p=input.pallet,w=config.weights;
  const components={compactness:(input.placements.reduce((s,b)=>s+volume(b.size),0)+volume(candidate.placement.size))/(p.width*p.depth*Math.max(1,f.maxHeight)),support:candidate.placement.supportRatio,
    stability:1-unit(Math.max(f.loadUtilization,(f.lowerBalance??0))),centerOfMass:1-unit(f.imbalance),flatness:f.flatRatio,heightPenalty:f.maxHeight/p.maxHeight};
  const score=w.compactness*components.compactness+w.support*components.support+w.stability*components.stability+w.centerOfMass*components.centerOfMass+w.flatness*components.flatness-w.height*components.heightPenalty;
  return {score,components};
}
