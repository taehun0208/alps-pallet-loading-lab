import { candidateSet } from './candidates';
import { inspectConstraints } from './constraints';
import { top } from './geometry';
import { rng,shuffled } from './scenarios';
import type { Analysis,Candidate,PlanningInput } from './types';

/** Random control: uniform valid position within the SAME bounded boundary candidate generator.
 * Not uniform over continuous XYZ; all physical constraints still apply. No score or future
 * rollout participates in selection. Feature scores are retained only for existing diagnostics.
 * Stock mode randomly orders available individual boxes, then takes the first feasible box.
 */
export function planRandom(input:PlanningInput):Analysis {
 const start=performance.now(),draw=rng(input.settings.plannerSeed^Math.imul(input.stepId+1,2654435761));
 const boxes=input.available?shuffled(input.available,draw):[input.current];
 const candidates:Candidate[]=[],rejections:Record<string,number>={},deferred:{id:string;reason:string}[]=[];
 let generated=0,capped=false,selected:Candidate|undefined;
 const checkedTypes=new Set<string>();
 for(const box of boxes){
  checkedTypes.add(box.typeId);
  const remaining={...input.remaining};if(input.available)remaining[box.typeId]=Math.max(0,(remaining[box.typeId]||0)-1);
  const scoped={...input,current:box,available:undefined,remaining,settings:{...input.settings,inventoryMode:'none' as const}};
  const root=candidateSet(scoped);generated+=root.generated;capped||=root.capped;
  for(const c of root.candidates){
   c.id=`${box.id}:${c.id}`;
   // Preserve an already held box's promised return site when switching planners mid-run.
   if(c.valid&&(input.buffer?.length??0)>0){
    const after=inspectConstraints(c.placement,box,input.placements,input.pallet,input.constraints).stack;
    const protectedBoxes=input.buffer!.filter(h=>h.observation.id!==box.id);
    if(protectedBoxes.some(h=>h.reservedTop.position.z<Math.max(0,...after.map(top))||
     inspectConstraints(h.reservedTop,{...h.observation,pickupPosition:h.source},after,input.pallet,input.constraints).reasons.length)){
     c.valid=false;c.reasons.push('임시 대기 박스의 상단 복귀 위치 보존 불가');
    }
   }
   for(const reason of c.reasons)rejections[reason]=(rejections[reason]||0)+1;
  }
  candidates.push(...root.candidates);
  const valid=root.candidates.filter(c=>c.valid);
  if(valid.length){selected=valid[Math.floor(draw()*valid.length)];break;}
  deferred.push({id:box.id,reason:[...new Set(root.candidates.flatMap(c=>c.reasons))].join(' / ')||'유효 후보 없음'});
 }
 return {runId:input.runId,stepId:input.stepId,selectedId:selected?.id??null,
  ...(input.available?{selectedBoxId:selected?.placement.id,stockSelection:{available:boxes.length,checkedTypes:checkedTypes.size,deferred,foundation:0}}:{}),
  ...(input.buffer?.length?{bufferPlan:{held:input.buffer.filter(h=>h.observation.id!==selected?.placement.id),addedIds:[],releasedId:input.buffer.some(h=>h.observation.id===selected?.placement.id)?selected?.placement.id:undefined,checkedPairs:0}}:{}),
  candidates,generated,checkedCandidates:candidates.length,valid:candidates.filter(c=>c.valid).length,
  rejections,nodes:candidates.length,rolloutCalls:0,milliseconds:performance.now()-start,capped,virtualSequences:[],
  explanation:[selected?'필수 제약을 통과한 후보에서 점수 순위 없이 균등 무작위로 위치·자세를 선택했습니다.':'검토한 후보 중 제약을 만족하는 위치가 없어 배치할 수 없습니다.',
   input.available?'현재 선택 가능한 재고를 무작위 순서로 검사하여 배치 가능한 첫 박스를 선택합니다.':'현재 도착한 박스만 선택하며, 아직 도착하지 않은 박스를 가져오지 않습니다.',
   `배치 난수 시드 ${input.settings.plannerSeed} · 단계 ${input.stepId+1}. 같은 입력·시드는 같은 배치를 재현합니다.`,
   '경계 기반 후보와 후보 수 제한은 기존 방식과 같습니다. 전체 연속 공간에서 무작위 좌표를 뽑는 방식은 아닙니다. 표시 점수는 진단용이며 선택·미래 예측에 사용하지 않습니다.']};
}
