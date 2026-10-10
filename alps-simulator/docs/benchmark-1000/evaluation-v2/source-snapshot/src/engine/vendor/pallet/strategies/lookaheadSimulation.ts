import { candidateSet } from '../candidates';
import { equilibrium } from '../equilibrium';
import { rng,shuffled } from '../scenarios';
import { virtualObservation } from '../remainingSites';
import { top,volume } from '../geometry';
import { causalInput,approachClear } from './feasibility';
import { currentScore } from './currentScore';
import type { Candidate,PlanningInput } from '../types';
import type { StrategyConfig } from './PackingStrategy';

export function sampleSequences(input:PlanningInput,config:StrategyConfig,difficulty:Map<string,number>){
  const pool=input.types.flatMap(t=>Array.from({length:Math.max(0,input.remaining[t.id]||0)},()=>t.id));
  if(!pool.length)return [];
  if(config.lookaheadMode==='worst'){
    const hard=[...pool].sort((a,b)=>(difficulty.get(b)||0)-(difficulty.get(a)||0)||a.localeCompare(b));
    // Stress cases within the bounded horizon: hard-first, hard-last. Never read arrival RNG.
    const prefix=hard.slice(0,config.lookaheadDepth),late=[...hard.slice(1).reverse().slice(0,Math.max(0,config.lookaheadDepth-1)),hard[0]];
    return [prefix,late];
  }
  const random=rng((input.settings.plannerSeed^Math.imul(input.stepId+1,2654435761))>>>0);
  return Array.from({length:config.lookaheadSamples},()=>shuffled(pool,random).slice(0,config.lookaheadDepth));
}
export function simulateFuture(input:PlanningInput,candidate:Candidate,sequences:string[][],config:StrategyConfig){
  let nodes=0,calls=0,added=0,amount=0,height=0,blocked=0;const rewards:number[]=[];
  for(const sequence of sequences){
    let stack=equilibrium([...input.placements,candidate.placement]).placements,count=0,v=0;
    for(const [step,id] of sequence.entries()){
      const current=virtualObservation(input.types.find(t=>t.id===id)!,`virtual-${step}-${id}`),i={...causalInput(input),current,placements:stack,settings:{...causalInput(input).settings,maxCandidates:config.futureCandidates}};
      const options=candidateSet(i,true);nodes+=options.candidates.length;calls++;
      const ranked=options.candidates.filter(c=>c.valid&&approachClear(c.placement,stack,config)).map(c=>({c,score:currentScore(c,i,config).score})).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id));
      const choice=ranked[0]?.c;if(!choice)break;
      stack=equilibrium([...stack,choice.placement]).placements;count++;v+=volume(current.size);
    }
    const h=Math.max(0,...stack.map(top));added+=count;amount+=v;height+=h;blocked+=Number(count<sequence.length);
    // One fixed causal continuation policy, common random numbers for every root candidate.
    rewards.push(count/Math.max(1,sequence.length)-Number(count<sequence.length)+.1*(1-h/input.pallet.maxHeight));
  }
  const n=Math.max(1,sequences.length),score=!rewards.length?0:config.lookaheadMode==='worst'?Math.min(...rewards):rewards.reduce((a,b)=>a+b,0)/n;
  return {score,nodes,calls,future:{added:added/n,volume:amount/n,finalHeight:height/n,blocked:blocked/n,sequences,policies:['Greedy · 현재 가상 도착만']}};
}
