import { planRandom } from './randomPlanner';
import { isStrategy } from './strategies/PackingStrategy';
import { planStrategy } from './strategies';
import { candidateSet } from './candidates';
export { candidateSet } from './candidates';
import { orientationRank,allowedOrientations } from './orientations';
import { planStock } from './stockPlanner';
import { planOnline } from './onlinePlanner';
import { oriented,sparseOrigins,top,volume,landingHeight } from './geometry';
import { frontierOrigins,diverseBudget,balancedOrigins } from './frontier';
import { surface } from './surface';
import { inspectConstraints } from './constraints';
import { features,terms } from './features';
import { rng,shuffled } from './scenarios';
import { emptyInventory } from './inventory';
import type { Analysis,Candidate,PlanningInput,Observation } from './types';
const bottomLeft=(a:Candidate,b:Candidate)=>top(a.placement)-top(b.placement)||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x||orientationRank(a.placement.orientation)-orientationRank(b.placement.orientation);
const fastOrder=(a:Candidate,b:Candidate)=>b.fastScore-a.fastScore||bottomLeft(a,b);
export function virtualSequences(input:PlanningInput){const pool=input.types.flatMap(t=>Array.from({length:input.remaining[t.id]||0},()=>t.id));const random=rng((input.settings.plannerSeed^Math.imul(input.stepId+1,2654435761))>>>0);return Array.from({length:input.settings.samples},()=>shuffled(pool,random).slice(0,input.settings.depth));}
function chooseBaseline(valid:Candidate[]){
 const bestFit=Math.max(0,...valid.map(c=>c.features.inventory.fitFraction));
 const viable=valid.filter(c=>c.features.inventory.fitFraction>=bestFit-1e-6),opportunity=Math.max(0,...viable.map(c=>c.features.inventory.opportunity));
 return viable.filter(c=>c.features.inventory.opportunity>=opportunity-.02).sort(bottomLeft)[0];
}
function diverseShortlist(valid:Candidate[],limit:number){
 const ranked=[...valid].sort(fastOrder),chosen=ranked.slice(0,Math.min(2,limit)),baseline=chooseBaseline(valid);
 if(baseline&&!chosen.includes(baseline)&&chosen.length<limit)chosen.push(baseline);
 const groups=new Map<string,Candidate[]>();for(const c of ranked){const key=`${c.placement.position.z}:${c.placement.orientation}:${c.placement.supports.map(s=>s.id).sort().join(',')}`;groups.set(key,[...(groups.get(key)||[]),c]);}
 for(let i=0;chosen.length<limit;i++){let any=false;for(const list of groups.values()){const c=list[i];if(c&&!chosen.includes(c)&&chosen.length<limit){chosen.push(c);any=true;}}if(!any&&i>=ranked.length)break;}
 return chosen;
}
export function plan(input:PlanningInput):Analysis{return input.algorithm==='random'?planRandom(input):isStrategy(input.algorithm)?planStrategy(input):input.available?planStock(input):input.settings.policy==='online'?planOnline(input):planArrival(input);}
export function planArrival(input:PlanningInput):Analysis{
 const start=performance.now(),root=candidateSet(input),valid=root.candidates.filter(c=>c.valid);let nodes=root.candidates.length,rolloutCalls=0;const sequences=input.algorithm==='rollout'?virtualSequences(input):[];
 let selected:Candidate|undefined;
 if(input.algorithm==='bl')selected=chooseBaseline(valid);
 else if(input.algorithm==='greedy')selected=[...valid].sort(fastOrder)[0];
 else {
  const portfolio=input.settings.portfolio??false,policies=portfolio?['greedy','bl'] as const:['greedy'] as const;
  const shortlist=portfolio?diverseShortlist(valid,input.settings.topK):[...valid].sort(fastOrder).slice(0,input.settings.topK);
  for(const candidate of shortlist){let added=0,totalVolume=0,finalHeight=0,blocked=0;
   for(const sequence of sequences){const outcomes=[];
    for(const policy of policies){let placed=[...input.placements,candidate.placement],n=0,v=0;const remaining={...input.remaining};
     for(const typeId of sequence){remaining[typeId]--;const type=input.types.find(t=>t.id===typeId)!;const current:Observation={id:`virtual-${n}-${typeId}`,typeId,size:type.size,weight:type.weight,status:'normal',orientationAllowed:type.orientations,packaging:type.packaging,maxLoadKg:type.maxLoadKg,maxLoadSource:type.maxLoadSource,maxLoadByAxis:type.maxLoadByAxis,handling:type.handling,material:type.material,strengthFactor:type.strengthFactor,friction:type.friction};
      const future=candidateSet({...input,current,remaining,placements:placed,algorithm:policy,settings:{...input.settings,maxCandidates:Math.min(input.settings.maxCandidates,input.settings.virtualCandidates??input.settings.maxCandidates)}});nodes+=future.candidates.length;rolloutCalls++;const available=future.candidates.filter(c=>c.valid),chosen=policy==='bl'?chooseBaseline(available):available.sort(fastOrder)[0];if(!chosen)break;placed=[...placed,chosen.placement];n++;v+=volume(current.size);
     }
     outcomes.push({n,v,height:Math.max(0,...placed.map(top))});
    }
    const best=outcomes.sort((a,b)=>b.n-a.n||b.v-a.v||a.height-b.height)[0];added+=best.n;totalVolume+=best.v;finalHeight+=best.height;if(best.n<sequence.length)blocked++;
   }
   const count=Math.max(1,sequences.length),depth=Math.max(1,sequences[0]?.length||0),maxVolume=Math.max(1,...sequences.map(seq=>seq.reduce((s,id)=>s+volume(input.types.find(t=>t.id===id)!.size),0)));
   candidate.future={added:added/count,volume:totalVolume/count,finalHeight:finalHeight/count,blocked:blocked/count,sequences,policies:[...policies]};
   const f=candidate.future;candidate.score=candidate.fastScore+input.settings.weights.future*(.55*f.added/depth+.2*f.volume/maxVolume+.15*(1-f.finalHeight/input.pallet.maxHeight)-.35*f.blocked);
  }
  selected=shortlist.sort((a,b)=>portfolio?a.future!.blocked-b.future!.blocked||b.future!.added-a.future!.added||b.score-a.score||bottomLeft(a,b):b.score-a.score||bottomLeft(a,b))[0];
 }
 const rejections:Record<string,number>={};for(const c of root.candidates)for(const reason of c.reasons){const key=reason.split(' · ')[0].replace(/\([^)]*\)/g,'').trim();rejections[key]=(rejections[key]||0)+1;}
 const explanation=selected?[`유효 후보 ${valid.length}개 중 ${input.algorithm==='bl'?'잔량 공간 보존 후 최저 높이 → y → x':input.algorithm==='greedy'?'잔량·재질·안정성을 포함한 평가 점수 최대':input.settings.portfolio?'가상 막힘 최소 → 평균 추가 적재 최대 → 합산 점수':'가상 순서 평균 점수'}로 선택했습니다.`,`최대 높이 ${selected.features.maxHeight} mm · 지지 ${(selected.placement.supportRatio*100).toFixed(1)}% · 기둥 높이/받침 ${selected.features.slenderness.toFixed(2)}`,`남은 ${Object.values(input.remaining).reduce((a,b)=>a+b,0)}개를 항상 평가 · 배치 공간 표본이 있는 물량 ${(selected.features.inventory.fitFraction*100).toFixed(1)}% · 상부 하중 최대 사용 ${(selected.features.loadUtilization*100).toFixed(1)}%`,...(selected.features.futureSurfacePenalty?[`남은 큰 박스용 받침 손실 비용 ${(selected.features.futureSurfacePenalty*100).toFixed(1)}% · 측면 접촉 면적 ${(100*(selected.features.contactRatio||0)).toFixed(1)}%`]:[]),...(selected.features.inventory.foundationPenalty>0?[`강한 받침 ${selected.features.inventory.strongerRemaining}개 잔량과 기존 받침의 여유 면적을 고려한 바닥 배치 비용 ${selected.features.inventory.foundationPenalty.toFixed(2)}를 반영했습니다.`]:[]),...(selected.future?[`실제 미래 입고와 독립인 ${sequences.length}개 가상 순서 · 후속 정책 ${selected.future.policies?.join(' / ')} · 평균 ${selected.future.added.toFixed(2)}개 추가 적재 · 가상 중단 ${(selected.future.blocked*100).toFixed(0)}%`]:[])]:['모든 검토 후보가 제약을 위반했습니다. 현재 박스를 건너뛰지 않고 이 실행을 중단합니다.'];
 return {...root,runId:input.runId,stepId:input.stepId,selectedId:selected?.id||null,valid:valid.length,rejections,nodes,rolloutCalls,milliseconds:performance.now()-start,explanation,virtualSequences:sequences};
}
