import { intersects } from '../geometry';
import { slotKey } from '../candidates';
import { Feasibility,criticalBoxes,assessCritical,approachVolume,futureLoss } from './feasibility';
import { accessibleSpace } from './freeSpace';
import { currentScore } from './currentScore';
import { sampleSequences,simulateFuture } from './lookaheadSimulation';
import type { Candidate,PlanningInput } from '../types';
import type { StrategyConfig,StrategyId,StrategyDebug,ReservedSlot,PackingStrategy } from './PackingStrategy';

export function makeEvaluator(input:PlanningInput,config:StrategyConfig,mode:StrategyId,scorer:PackingStrategy['score']){
  const probe=new Feasibility(input,config),needsFuture=!['strategy-greedy','macs'].includes(mode);
  const all=needsFuture?criticalBoxes(input,config,probe):[],critical=all.slice(0,mode==='tetris-reserved'?1:config.criticalK);
  const sequences=mode==='lookahead'?sampleSequences(input,config,new Map(all.map(c=>[c.typeId,c.criticality]))):[];
  const previous=input.strategyState?.algorithm===mode?input.strategyState.slots:[];
  let fixed:ReservedSlot|undefined;
  if(mode==='tetris-reserved'){
    fixed=previous.find(s=>{
      const type=input.types.find(t=>t.id===s.typeId);
      return type&&((input.remaining[s.typeId]||0)>0||input.current.typeId===s.typeId)&&probe.check(type,s.placement,input.placements);
    });
    if(!fixed){const c=critical.find(c=>c.slots.length);const slot=c?.slots.slice().sort((a,b)=>a.position.z-b.position.z||a.position.y-b.position.y||a.position.x-b.position.x)[0];if(c&&slot)fixed={typeId:c.typeId,placement:slot};}
  }
  let nodes=0,calls=0;const memo=new Map<string,StrategyDebug>();
  const evaluate=(candidate:Candidate):StrategyDebug=>{
    const cached=memo.get(candidate.id);if(cached)return cached;
    const base=currentScore(candidate,input,config),stack=[...input.placements,candidate.placement];
    let fpl=0,deadEnds=0,lowerLoss=0,reservationPenalty=0;let reservedSlots:ReservedSlot[]=[];
    const components:Record<string,number>={...base.components,current:base.score};
    const selectedCritical=[...critical];
    if(fixed&&!selectedCritical.some(c=>c.typeId===fixed!.typeId)){const c=all.find(c=>c.typeId===fixed!.typeId);if(c)selectedCritical.push(c);}
    const criticalResults=needsFuture?selectedCritical.map(c=>assessCritical(c,stack,probe,config)):[];
    if(mode==='dynamic-reservation'||mode==='future-hybrid'){
      for(const {info,slots} of criticalResults){
        fpl+=info.criticality*info.lost;
        if(info.deadEnd)deadEnds++;
        if(info.weightCritical)lowerLoss+=info.criticality*futureLoss(info.lowerBefore,info.lowerAfter,config.lossMode);
        reservedSlots.push(...slots.map(placement=>({typeId:info.typeId,placement})));
      }

    }
    if(mode==='tetris-reserved'&&fixed){
      const targetArrived=input.current.typeId===fixed.typeId;
      // A target box may consume its own reservation. Other boxes protect the entire volume,
      // including optional approach corridor; the penalty can be traded off if no safe alternative exists.
      const invades=intersects(candidate.placement,fixed.placement)||(config.approach&&intersects(candidate.placement,approachVolume(fixed.placement,config)));
      reservationPenalty=targetArrived?(slotKey(candidate.placement)===slotKey(fixed.placement)?-1:0):Number(invades);

      const type=input.types.find(t=>t.id===fixed!.typeId)!;
      if(!targetArrived&&probe.check(type,fixed.placement,stack))reservedSlots=[fixed];
      else if((input.remaining[fixed.typeId]||0)>0){const replacement=probe.sites(type,stack)[0];if(replacement)reservedSlots=[{typeId:fixed.typeId,placement:replacement}];}
    }
    if(mode==='macs'||mode==='future-hybrid'||mode==='dynamic-reservation'){
      const free=accessibleSpace(stack,input.pallet);components.macs=free.score;components.fragmentation=free.fragmentation;

    }
    if(mode==='lookahead'){
      const future=simulateFuture(input,candidate,sequences,config);nodes+=future.nodes;calls+=future.calls;candidate.future=future.future;components.lookahead=future.score;
    }
    // Keep diagnostics for every future-aware method, including the baseline reserved-slot method.
    if(mode==='tetris-reserved'||mode==='lookahead')for(const {info} of criticalResults){fpl+=info.criticality*info.lost;deadEnds+=Number(info.deadEnd);}
    Object.assign(components,{futurePlacementLoss:fpl,deadEnds,lowerSpaceLoss:lowerLoss,reservationPenalty});
    const key=(s:ReservedSlot)=>s.typeId+':'+slotKey(s.placement),oldKeys=new Set(previous.map(key)),newKeys=new Set(reservedSlots.map(key));
    const reservationChanges=[...oldKeys].filter(k=>!newKeys.has(k)).length+[...newKeys].filter(k=>!oldKeys.has(k)).length;
    const score=scorer(components,config.weights);
    const debug:StrategyDebug={algorithm:mode,selectedScore:score,scoreComponents:components,criticalBoxes:criticalResults.map(r=>r.info),futurePlacementLoss:fpl,deadEnds,reservedSlots,reservationChanges,sampled:true,candidateBudget:config.futureCandidates,sequences};
    candidate.score=score;candidate.fastScore=base.score;candidate.strategyDebug=debug;memo.set(candidate.id,debug);return debug;
  };
  return {evaluate,sequences,fixed,counts:()=>({nodes:nodes+probe.nodes,calls})};
}
