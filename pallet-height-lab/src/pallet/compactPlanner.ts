import { chooseWithBuffer } from './temporaryBuffer';
import { candidateSet } from './planner';
import { compactScore } from './compactPacking';
import { top,volume } from './geometry';
import { remainingSites,lostRemaining } from './remainingSites';
import { equilibrium } from './equilibrium';
import { DEFAULT_STANDING_HEIGHT,standingHeight } from './standingHeight';
import type { Analysis,Candidate,Observation,PlanningInput } from './types';

const counts=(stock:Observation[])=>{const r:Record<string,number>={};for(const b of stock)r[b.typeId]=(r[b.typeId]||0)+1;return r;};
const low=(a:Candidate,b:Candidate)=>a.placement.position.z-b.placement.position.z;
const quality=(a:Candidate,b:Candidate)=>low(a,b)||b.score-a.score||top(a.placement)-top(b.placement)||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x||a.placement.id.localeCompare(b.placement.id);
function forBox(input:PlanningInput,box:Observation,budget:number):PlanningInput{return {...input,available:undefined,current:box,remaining:counts(input.available!.filter(b=>b.id!==box.id)),settings:{...input.settings,policy:'legacy',candidateMode:'frontier',inventoryMode:'none',maxCandidates:budget}};}

export function planCompactStock(input:PlanningInput,precise=true):Analysis{
 const start=performance.now(),stock=input.available!,active=stock.filter(b=>!input.buffer?.some(h=>h.observation.id===b.id)),unique=active.filter((b,i)=>active.findIndex(a=>a.typeId===b.typeId)===i),deferred:{id:string;reason:string}[]=[],rejections:Record<string,number>={};
 let generated=0,nodes=0,capped=false,rolloutCalls=0;
 const inspect=(box:Observation,budget:number)=>{const ctx=forBox(input,box,budget),root=candidateSet(ctx,true);generated+=root.generated;nodes+=root.candidates.length;capped||=root.capped;
  for(const c of root.candidates){c.id=`${box.id}:${budget}:${c.id}`;if(c.valid){compactScore(c,ctx);c.remainingCheck='pending';}else for(const reason of c.reasons){const key=reason.split(' · ')[0].replace(/\([^)]*\)/g,'').trim();rejections[key]=(rejections[key]||0)+1;}}
  return root.candidates;
 };
 const groups=unique.map(box=>({box,candidates:inspect(box,Math.min(input.settings.maxCandidates,32))}));
 // A coarse miss is not a reason to stop: broaden every remaining type once before blocking.
 if(precise&&!groups.some(g=>g.candidates.some(c=>c.valid)))for(const g of groups)g.candidates=inspect(g.box,input.settings.maxCandidates);
 for(const group of groups)if(!group.candidates.some(c=>c.valid))deferred.push({id:group.box.typeId,reason:[...new Set(group.candidates.flatMap(c=>c.reasons))].join(' / ')||'후보 상한 내 유효 배치 없음'});
 let candidates=groups.flatMap(g=>g.candidates);
 if(precise){const promising=groups.map(g=>({...g,best:g.candidates.filter(c=>c.valid).sort(quality)[0]})).filter(g=>g.best).sort((a,b)=>quality(a.best,b.best)).slice(0,4);
  // Replace each coarse set with its expanded set; retain other types and all diagnostics.
  for(const g of promising){candidates=candidates.filter(c=>c.placement.typeId!==g.box.typeId);candidates.push(...inspect(g.box,input.settings.maxCandidates));}
 }
 const valid=candidates.filter(c=>c.valid).sort(quality),choices:Candidate[]=[];
 // Preserve multiple box identities as well as distinct positions, within the lowest feasible plane.
 const lowPlane=valid.filter(c=>!valid.length||c.placement.position.z===valid[0].placement.position.z);
 for(const c of lowPlane)if(!choices.some(a=>a.placement.typeId===c.placement.typeId)&&choices.length<Math.min(3,input.settings.topK))choices.push(c);
 for(const c of lowPlane)if(!choices.includes(c)&&choices.length<input.settings.topK)choices.push(c);
 if(input.algorithm==='bl'&&valid.length){choices.length=0;choices.push([...valid].sort((a,b)=>low(a,b)||top(a.placement)-top(b.placement)||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x)[0]);}
 if(precise)for(const c of choices){const box=stock.find(b=>b.id===c.placement.id)!,ctx=forBox(input,box,input.settings.maxCandidates),before=remainingSites(ctx,input.placements),after=remainingSites(ctx,[...input.placements,c.placement]),lostFraction=lostRemaining(ctx,before,after);
  nodes+=before.tested+after.tested;c.reservation={before,after,lostFraction};c.remainingCheck='checked';
  c.features.inventory={...c.features.inventory,fitFraction:after.fitFraction,opportunity:after.opportunity,types:after.types.map(({id,quantity,fitSites,sampleSites})=>({id,quantity,fitSites,sampleSites}))};
  c.terms.reservation=input.settings.weights.inventory*(after.opportunity-before.opportunity-2*lostFraction);c.fastScore+=c.terms.reservation;c.score=c.fastScore;
  if(input.algorithm==='rollout'){let available=stock.filter(b=>b.id!==box.id),placed=equilibrium([...input.placements,c.placement]).placements,added=0,amount=0;const sequence:string[]=[];
   for(let i=0;i<Math.min(2,input.settings.depth)&&available.length;i++){const result=planCompactStock({...input,placements:placed,current:available[0],available,remaining:counts(available),algorithm:'greedy'},false);nodes+=result.nodes;rolloutCalls++;const next=result.candidates.find(v=>v.id===result.selectedId);if(!next)break;
    available=available.filter(b=>b.id!==next.placement.id);placed=equilibrium([...placed,next.placement]).placements;added++;amount+=volume(next.placement.size);sequence.push(next.placement.typeId);
   }
   c.future={added,volume:amount,finalHeight:Math.max(0,...placed.map(top)),blocked:added<Math.min(2,input.settings.depth,stock.length-1)?1:0,sequences:[sequence],policies:['낮은 빈자리 우선']};
   c.score+=input.settings.weights.future*(added/Math.max(1,Math.min(2,input.settings.depth))+.5*amount/(input.pallet.width*input.pallet.depth*input.pallet.maxHeight));
  }
 }
 const ranked=(precise?choices:valid).sort(input.algorithm==='bl'?(a,b)=>low(a,b)||top(a.placement)-top(b.placement)||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x:quality);
 let selected:Candidate|undefined=ranked[0],bufferPlan:Analysis['bufferPlan'];
 if(precise&&input.settings.temporaryBuffer){const decision=chooseWithBuffer(input,selected,valid,choices);selected=decision.selected;bufferPlan=decision.plan;nodes+=decision.nodes;generated+=decision.generated;capped||=decision.capped;candidates.push(...decision.extra);}

 // Keep the computed decision unchanged, but bound the frame/export payload. Preserve
 // the selected/compared alternatives and one representative per type before filling it.
 const displayed:Candidate[]=[];const keep=(c:Candidate|undefined)=>{if(c&&!displayed.includes(c)&&displayed.length<96)displayed.push(c);};
 keep(selected);choices.forEach(keep);
 for(const box of unique){keep(valid.find(c=>c.placement.typeId===box.typeId));keep(candidates.filter(c=>!c.valid&&c.placement.typeId===box.typeId).sort((a,b)=>b.placement.supportRatio-a.placement.supportRatio)[0]);}
 [...valid,...candidates.filter(c=>!c.valid)].forEach(keep);
 return {bufferPlan,runId:input.runId,stepId:input.stepId,selectedId:selected?.id||null,selectedBoxId:selected?.placement.id,stockSelection:{available:stock.length,checkedTypes:new Set([...unique.map(b=>b.typeId),...(selected?[selected.placement.typeId]:[])]).size,deferred,foundation:0,sizePriority:'low-space-fit',footprintMm2:selected?selected.placement.size.w*selected.placement.size.d:undefined,volumeMm3:selected?volume(selected.placement.size):undefined},candidates:displayed,checkedCandidates:candidates.length,generated,valid:candidates.filter(c=>c.valid).length,rejections,nodes,rolloutCalls,milliseconds:performance.now()-start,capped,virtualSequences:selected?.future?.sequences||[],explanation:selected?[
  `선택 가능한 재고 ${stock.length}개 / ${new Set(stock.map(b=>b.typeId)).size}종의 박스별 허용 자세(최대 6자세)와 위치를 함께 검사했습니다. 실제 미래 입고에서 박스를 꺼내지 않습니다.`,
  ...(bufferPlan?.addedIds.length?[bufferPlan.held[0].reason]:[]),
  ...(bufferPlan?.held.length?[`임시 대기 ${bufferPlan.held[0].observation.id}: 이번 배치 뒤에도 상단 복귀 위치 z=${bufferPlan.held[0].reservedTop.position.z} mm가 유효합니다. 다음 단계에 다시 검사합니다.`]:[]),
  ...(bufferPlan?.releasedId?[`임시 대기 ${bufferPlan.releasedId}를 외부 대기대에서 회수하여 현재 최상단에 적재합니다.`]:[]),
  `안전 검사를 통과한 배치 위치 z=${selected.placement.position.z} mm를 채웁니다. 같은 높이에서는 면적·부피·주변 박스 접촉·높이대별 내부 빈 공간·잔량의 후속 배치를 비교합니다.`,
  ...((input.constraints.standingHeight??DEFAULT_STANDING_HEIGHT).enabled?[standingHeight(selected.placement,input.placements,input.constraints).tall?`세로 박스 상단을 인접한 눕힌 적재 높이에 맞췄습니다. 돌출 ${standingHeight(selected.placement,input.placements,input.constraints).riseMm!.toFixed(0)} mm / 허용 ${standingHeight(selected.placement,input.placements,input.constraints).limitMm.toFixed(0)} mm.`:'눕힌 박스로 낮은 공간과 주변 층을 채웁니다. 높이가 맞지 않는 세로 박스는 재고에 보류하고 다음 단계에 다시 검사합니다.']:[]),
  `한 받침 중앙 정렬이나 큰 박스 순서를 강제하지 않습니다. 낮은 틈에 맞는 작은 박스가 높은 곳의 큰 박스보다 먼저 선택될 수 있습니다.`,
  `지지 ${(selected.placement.supportRatio*100).toFixed(1)}% / 받침 ${selected.placement.supports.length}개. 다중 받침도 같은 반력·무게중심·누적 하중·접근 검사를 통과해야 합니다. 서로 다른 높이를 평탄하게 보정하지 않습니다.`,
  `종류별 최대 32곳 사전 검사 → 상위 4종 최대 ${input.settings.maxCandidates}곳 → 최대 ${input.settings.topK}개 선택 후보의 잔량 공간 검사. 표본 탐색이며 최대 적재의 보장은 아닙니다.`,
  `이번 단계의 최종 후보군 ${candidates.length}곳 중 선택·비교·종류별 대표 후보 ${displayed.length}곳을 프레임에 저장했습니다. 탈락 사유 집계는 전체 검사 기준입니다.`,
 ]:[`남은 재고 ${stock.length}개 / ${unique.length}종의 검토 후보에서 유효 배치를 찾지 못했습니다. 제약을 낮추거나 남은 박스를 삭제하지 않습니다.`]};
}
