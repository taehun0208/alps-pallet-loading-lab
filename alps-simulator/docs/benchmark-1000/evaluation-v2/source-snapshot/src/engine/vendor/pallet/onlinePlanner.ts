import { orientationRank } from './orientations';
import { candidateSet,virtualSequences } from './planner';
import { remainingSites,lostRemaining,virtualObservation } from './remainingSites';
import { top,volume } from './geometry';
import { equilibrium } from './equilibrium';
import type { Analysis,Candidate,PlanningInput,RemainingSites,Pallet } from './types';
const bottom=(a:Candidate,b:Candidate)=>top(a.placement)-top(b.placement)||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x||orientationRank(a.placement.orientation)-orientationRank(b.placement.orientation);
const quality=(a:Candidate,b:Candidate)=>b.score-a.score||bottom(a,b);
const preserve=(a:Candidate,b:Candidate)=>(a.reservation?.lostFraction??0)-(b.reservation?.lostFraction??0)||quality(a,b);

function shortlist(valid:Candidate[],limit:number,pallet:Pallet){
 const ranked=[...valid].sort(quality),chosen=ranked.slice(0,Math.min(2,limit)),groups=new Map<string,Candidate[]>();
 const baseline=[...valid].sort(bottom)[0];if(baseline&&!chosen.includes(baseline)&&chosen.length<limit)chosen.push(baseline);
 for(const c of ranked){const p=c.placement,q=Number(p.position.x+p.size.w/2>=pallet.width/2)+2*Number(p.position.y+p.size.d/2>=pallet.depth/2),key=`${p.position.z}:${p.orientation}:${p.supports.map(s=>s.id).sort().join(',')}:${q}`;groups.set(key,[...(groups.get(key)||[]),c]);}
 for(let i=0;chosen.length<limit;i++){let found=false;for(const list of groups.values())if(list[i]&&!chosen.includes(list[i])&&chosen.length<limit){chosen.push(list[i]);found=true;}if(!found&&i>=ranked.length)break;}return chosen;
}
function reserve(input:PlanningInput,c:Candidate,before:RemainingSites){
 const after=remainingSites(input,[...input.placements,c.placement]),lostFraction=lostRemaining(input,before,after),term=input.settings.weights.inventory*(after.opportunity-before.opportunity-2*lostFraction);
 c.remainingCheck='checked';c.reservation={before,after,lostFraction};c.features.inventory={...c.features.inventory,opportunity:after.opportunity,fitFraction:after.fitFraction,types:after.types.map(({id,quantity,fitSites,sampleSites})=>({id,quantity,fitSites,sampleSites}))};
 c.terms.reservation=term;c.fastScore+=term;c.score=c.fastScore;return after.tested;
}

export function planOnline(input:PlanningInput):Analysis {
 if(input.available)throw Error('온라인 계획기에는 현재 도착 박스와 미입고 수량만 전달합니다.');
 const start=performance.now(),fastInput={...input,settings:{...input.settings,inventoryMode:'none' as const}},root=candidateSet(fastInput,true),valid=root.candidates.filter(c=>c.valid),rejections:Record<string,number>={};
 for(const c of root.candidates)for(const reason of c.reasons){const key=reason.split(' · ')[0].replace(/\([^)]*\)/g,'').trim();rejections[key]=(rejections[key]||0)+1;}
 let nodes=root.candidates.length,rolloutCalls=0,reserveChecks=0,selected:Candidate|undefined,sequences:string[][]=[];
 if(valid.length){const before=remainingSites(input,input.placements);reserveChecks+=before.tested;
  const choices=input.algorithm==='bl'?[[...valid].sort(bottom)[0]]:shortlist(valid,input.settings.topK,input.pallet);
  for(const c of choices)reserveChecks+=reserve(input,c,before);
  if(input.algorithm==='rollout'){
   sequences=virtualSequences(input);const targetDepth=Math.max(1,sequences[0]?.length||0),maxVolume=Math.max(1,...sequences.map(s=>s.reduce((n,id)=>n+volume(input.types.find(t=>t.id===id)!.size),0)));
   for(const c of choices){let added=0,v=0,height=0,blocked=0;
    for(const sequence of sequences){let placed=[...input.placements,c.placement],count=0,amount=0;const remaining={...input.remaining};
     // One fixed causal policy. No best-after-seeing-the-whole-sequence portfolio selection.
     for(const id of sequence){remaining[id]--;const type=input.types.find(t=>t.id===id)!,current=virtualObservation(type,`virtual-${count}-${id}`),future=candidateSet({...fastInput,current,remaining,placements:placed,algorithm:'greedy',settings:{...fastInput.settings,maxCandidates:input.settings.virtualCandidates??16}},true);nodes+=future.candidates.length;rolloutCalls++;
      const choice=future.candidates.filter(c=>c.valid).sort(quality)[0];if(!choice)break;placed=equilibrium([...placed,choice.placement]).placements;count++;amount+=volume(current.size);
     }
     added+=count;v+=amount;height+=Math.max(0,...placed.map(top));if(count<sequence.length)blocked++;
    }
    const samples=Math.max(1,sequences.length);c.future={added:added/samples,volume:v/samples,finalHeight:height/samples,blocked:blocked/samples,sequences,policies:['현재 관측만 쓰는 고정 Greedy']};
    const f=c.future;c.score=c.fastScore+input.settings.weights.future*(.55*f.added/targetDepth+.2*f.volume/maxVolume+.15*(1-f.finalHeight/input.pallet.maxHeight)-.35*f.blocked);
   }
   selected=choices.sort((a,b)=>a.reservation!.lostFraction-b.reservation!.lostFraction||a.future!.blocked-b.future!.blocked||b.future!.added-a.future!.added||quality(a,b))[0];
  }else selected=input.algorithm==='bl'?choices[0]:choices.sort(preserve)[0];
 }
 nodes+=reserveChecks;
 const explanation=[
  `온라인 순차 투입: 현재 관측 ${input.current.id}만 배치합니다. 미입고 ${Object.values(input.remaining).reduce((a,b)=>a+b,0)}개는 종류별 수량만 공개하며 실제 미래 순서는 읽지 않습니다.`,
  `모든 후보에서 관통·돌출·높이·방향·지지·아랫단 반력·강도와 ${input.constraints.heavyRule==='each'?'모든 직계 받침보다 무겁지 않은 조건':input.constraints.heavyRule==='share'?'받침별 분담 무게 조건':'사용자가 끈 무게 순서 규칙'}을 검사합니다. ${input.constraints.robotMode==='ideal'?'현재는 이상적 연구 모드로 그리퍼 검사를 제외했습니다.':'가반하중·작업공간·위쪽 접근·이탈 스윕을 검사합니다. 로봇 관절·IK는 미검증입니다.'}`,
  ...(selected?[
   `${valid.length}개 유효 후보 중 ${input.algorithm==='bl'?'최저 높이 → y → x':input.algorithm==='greedy'?'기존 후속 공간 손실 최소 → 품질 점수': '후속 공간 손실 최소 → 가상 막힘 최소 → 가상 추가 적재 → 점수'}로 선택했습니다.`,
   `잔량 위치 표본 ${reserveChecks}개에 실제 배치와 같은 하드 검사를 적용했습니다. 선택 후 표본이 있는 물량 ${(selected.reservation!.after.fitFraction*100).toFixed(1)}%, 이번 배치로 표본을 잃는 물량 ${(selected.reservation!.lostFraction*100).toFixed(1)}%입니다. 전체 물량을 동시에 놓을 수 있다는 보장은 아닙니다.`,
   `아랫단 중심 치우침 지수 ${((selected.features.lowerBalance??0)*100).toFixed(1)}% · 상부 하중 최대 사용 ${(selected.features.loadUtilization*100).toFixed(1)}% · ${selected.path.model==='ideal'?'로봇 시간 미평가':`작업 예상 ${selected.path.seconds.toFixed(2)}초`}.`,
   ...(selected.future?[`남은 수량에서 만든 가상 순서 ${sequences.length}개를 후보마다 똑같이 사용했습니다. 고정된 인과적 후속 정책의 평균 추가 ${selected.future.added.toFixed(2)}개, 막힘 ${(selected.future.blocked*100).toFixed(1)}%. 실제 다음 입고의 예측값이 아닙니다.`]:[])
  ]:[`현재 정상 박스의 검토 위치에 유효 배치가 없습니다. 다음 박스를 먼저 꺼내거나 정상 박스를 삭제하지 않고 이 단계에서 멈춥니다.`]),
  ...(input.current.status==='resized'?[`규격 수정 관측 ${input.current.size.w}×${input.current.size.d}×${input.current.size.h}mm로 현재 후보와 미확정 후속 패턴을 다시 계산했습니다. 확정 배치는 이동하지 않습니다.`]:[])
 ];
 return {runId:input.runId,stepId:input.stepId,selectedId:selected?.id||null,selectedBoxId:selected?input.current.id:undefined,online:{currentOnly:true,futureSource:'remaining-counts',robot:input.constraints.robotMode==='ideal'?'ideal':'gripper-proxy',heavyRule:input.constraints.heavyRule,reserveChecks,policy:'causal-greedy'},candidates:root.candidates,generated:root.generated,valid:valid.length,rejections,nodes,rolloutCalls,milliseconds:performance.now()-start,capped:root.capped,explanation,virtualSequences:sequences};
}
