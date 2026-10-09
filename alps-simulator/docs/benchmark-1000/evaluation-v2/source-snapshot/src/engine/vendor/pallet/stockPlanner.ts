import { planCompactStock } from './compactPlanner';
import { candidateSet } from './planner';
import { materialInfo } from './materials';
import { oriented,volume,top,EPS } from './geometry';
import { allowedOrientations } from './orientations';
import type { Analysis,Candidate,Observation,PlanningInput,Dimensions,Orientation } from './types';

// The whole supplied stock is physically selectable. This does not peek at a hidden arrival queue.
function remaining(stock:Observation[]){const counts:Record<string,number>={};for(const b of stock)counts[b.typeId]=(counts[b.typeId]||0)+1;return counts;}
function forBox(input:PlanningInput,box:Observation,maxCandidates:number,precise:boolean):PlanningInput {
 return {...input,available:undefined,current:box,remaining:remaining(input.available!.filter(b=>b.id!==box.id)),settings:{...input.settings,policy:'legacy',maxCandidates,inventoryMode:precise?input.settings.inventoryMode:'none'}};
}
function foundation(input:PlanningInput,box:Observation,size:Dimensions,orientation:Orientation){
 const capacity=materialInfo({...box,orientation},input.constraints.stability).capacity;
 if(capacity===null||capacity===0||box.handling==='no-top-load')return 0;
 let demand=0,covered=0;
 for(const other of input.available!){if(other.id===box.id)continue;const v=volume(other.size);demand+=v;
  if(other.weight<=capacity&&allowedOrientations(other.size,other.orientationAllowed,other.handling,other.maxLoadByAxis).some(o=>{const s=oriented(other.size,o);return s.w<=size.w&&s.d<=size.d;}))covered+=v;
 }
 if(!demand)return 0;
 return (.75*covered/demand+.25*size.w*size.d/(input.pallet.width*input.pallet.depth))*Math.min(1,Math.min(size.w,size.d)/size.h);
}
function score(input:PlanningInput,box:Observation,c:Candidate){
 const potential=foundation(input,box,c.placement.size,c.placement.orientation),bonus=45*potential*(1-c.placement.position.z/input.pallet.maxHeight),lowerBalance=-2*(input.settings.weights.balance+input.settings.weights.stability)*(c.features.lowerBalance??0);
 c.terms.foundation+=bonus;c.terms.lowerBalance=lowerBalance;c.fastScore+=bonus+lowerBalance;c.score=c.fastScore;return potential;
}
// Size is an explicit selection priority among feasible boxes, not a small score bonus.
// Among positions for an equally sized box, avoid tiny contacts on a neighbouring support
// when the whole footprint can sit on the pallet or one support. Bridges remain feasible.
const fullSeat=(c:Candidate)=>c.placement.position.z===0||c.placement.supports.some(s=>s.area>=c.placement.size.w*c.placement.size.d-EPS);
const lowerCenter=(a:Candidate,b:Candidate)=>{const delta=(a.features.lowerBalance??0)-(b.features.lowerBalance??0);return Math.abs(delta)>EPS?delta:0;};
const order=(a:Candidate,b:Candidate)=>b.placement.size.w*b.placement.size.d-a.placement.size.w*a.placement.size.d||volume(b.placement.size)-volume(a.placement.size)||Number(fullSeat(b))-Number(fullSeat(a))||lowerCenter(a,b)||b.score-a.score||top(a.placement)-top(b.placement)||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x||a.placement.id.localeCompare(b.placement.id);
export function planStock(input:PlanningInput,precise=true):Analysis {
 if(input.settings.stockPolicy==='compact')return planCompactStock(input,precise);
 const start=performance.now(),stock=input.available!,unique=stock.filter((b,i)=>stock.findIndex(a=>a.typeId===b.typeId)===i),deferred:{id:string;reason:string}[]=[],options:{box:Observation;best:Candidate;candidates:Candidate[]}[]=[];
 let generated=0,nodes=0,capped=false;const rejections:Record<string,number>={};
 for(const box of unique){const root=candidateSet(forBox(input,box,Math.min(input.settings.maxCandidates,16),false),true);generated+=root.generated;nodes+=root.candidates.length;capped||=root.capped;
  root.candidates.forEach(c=>{c.id=`${box.id}:${c.id}`;if(c.valid)score(input,box,c);for(const reason of c.reasons){const key=reason.split(' · ')[0].replace(/\([^)]*\)/g,'').trim();rejections[key]=(rejections[key]||0)+1;}});const valid=root.candidates.filter(c=>c.valid).sort(order);
  if(valid.length)options.push({box,best:valid[0],candidates:root.candidates});else deferred.push({id:box.typeId,reason:[...new Set(root.candidates.flatMap(c=>c.reasons))].join(' / ')||'현재 검토 위치에 유효 후보 없음'});
 }
 options.sort((a,b)=>order(a.best,b.best));let candidates:Candidate[]=[];
 if(precise)for(const option of options.slice(0,3)){const root=candidateSet(forBox(input,option.box,Math.min(input.settings.maxCandidates,24),true),true);generated+=root.generated;nodes+=root.candidates.length;capped||=root.capped;
  for(const c of root.candidates){c.id=`${option.box.id}:${c.id}`;if(c.valid)score(input,option.box,c);}candidates.push(...root.candidates);
 }else candidates=options.flatMap(o=>o.candidates);
 const valid=candidates.filter(c=>c.valid).sort(order);let shortlist=valid.slice(0,Math.min(6,input.settings.topK)),rolloutCalls=0;
 if(precise&&input.algorithm==='rollout')for(const c of shortlist){let available=stock.filter(b=>b.id!==c.placement.id),placed=[...input.placements,c.placement],added=0,v=0;const sequence:string[]=[];
  for(let depth=0;depth<Math.min(2,input.settings.depth)&&available.length;depth++){
   const future=planStock({...input,algorithm:'greedy',placements:placed,current:available[0],available,remaining:remaining(available)},false);nodes+=future.nodes;rolloutCalls++;const choice=future.candidates.find(c=>c.id===future.selectedId);if(!choice)break;
   available=available.filter(b=>b.id!==choice.placement.id);placed.push(choice.placement);added++;v+=volume(choice.placement.size);sequence.push(choice.placement.typeId);
  }
  c.future={added,volume:v,finalHeight:Math.max(0,...placed.map(top)),blocked:added<Math.min(2,input.settings.depth,stock.length-1)?1:0,sequences:[sequence],policies:['재고 선택']};c.score=c.fastScore+input.settings.weights.future*added/Math.max(1,Math.min(2,input.settings.depth));
 }
 if(!shortlist.length)shortlist=valid;
 let ranked=(input.algorithm==='rollout'?shortlist:valid).sort(order);
 if(input.algorithm==='bl'&&valid.length){const pool=valid.filter(c=>c.placement.typeId===valid[0].placement.typeId),fit=Math.max(0,...pool.map(c=>c.features.inventory.fitFraction));ranked=pool.filter(c=>c.features.inventory.fitFraction>=fit-1e-6).sort((a,b)=>top(a.placement)-top(b.placement)||(a.features.lowerBalance??0)-(b.features.lowerBalance??0)||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x);}
 const selected=ranked[0],box=stock.find(b=>b.id===selected?.placement.id);
 if(!candidates.length)candidates=unique.flatMap(box=>candidateSet(forBox(input,box,2,false),true).candidates.map(c=>({...c,id:`${box.id}:${c.id}`})));
 const potential=selected&&box?foundation(input,box,selected.placement.size,selected.placement.orientation):0;
 const explanation=selected?[
  `선택 가능한 재고 ${stock.length}개 / ${unique.length}종을 검사하고 ${box!.id}의 순서와 배치 위치를 함께 선택했습니다.`,
  `안전 제약을 통과한 박스 중 바닥 면적이 큰 순서, 같은 면적이면 부피가 큰 순서로 선택합니다. 선택 면적 ${(selected.placement.size.w*selected.placement.size.d/1e6).toFixed(3)} m² / 부피 ${(volume(selected.placement.size)/1e9).toFixed(3)} m³.`,
  `아랫단마다 자체 무게와 위에서 전달된 하중의 중심을 다시 계산합니다. 받침 중심에서의 치우침 ${(100*(selected.features.lowerBalance??0)).toFixed(1)}%를 배치 점수에 반영하고, 모든 접촉면의 전도 여유와 강도를 재검사합니다.`,
  ...(input.algorithm==='bl'?[]:[`같은 크기 박스의 위치는 전체 바닥을 지지하는 한 받침 → 아랫단 누적 하중 중심 정렬 → 종합 점수 순으로 비교합니다. 단일 받침 후보가 없으면 기존 지지 조건을 통과한 다중 받침도 검토합니다.`]),
  `넓은 받침·박스별 허용 하중·남은 박스가 올라갈 치수로 받침 기회 ${(potential*100).toFixed(1)}%를 평가했습니다. 재질 이름만으로 하단을 정하지 않습니다.`,
  `현재 놓이지 않는 ${deferred.length}종은 재고에 유지하고, 다른 가능한 박스를 먼저 배치합니다. 하부가 만들어진 다음 단계에서 다시 검사합니다.`,
  `종류별 위치 후보 최대 16개로 사전 평가, 상위 3종은 최대 24개 위치에서 잔량 공간까지 상세 평가합니다.${input.algorithm==='rollout'?' 선택 후보의 후속 재고 선택도 최대 2단계 검사합니다.':''}`,
 ]:[`남은 재고 ${stock.length}개 / ${unique.length}종을 모두 검사했지만 현재 검토 위치에서 유효 배치를 찾지 못했습니다. 놓이지 않는 재고를 삭제하거나 제약을 낮추지 않습니다.`];
 return {runId:input.runId,stepId:input.stepId,selectedId:selected?.id||null,selectedBoxId:box?.id,stockSelection:{available:stock.length,checkedTypes:unique.length,deferred,foundation:potential,sizePriority:'footprint-volume',footprintMm2:selected?selected.placement.size.w*selected.placement.size.d:undefined,volumeMm3:selected?volume(selected.placement.size):undefined},candidates,generated,valid:valid.length,rejections,nodes,rolloutCalls,milliseconds:performance.now()-start,capped,explanation,virtualSequences:selected?.future?.sequences||[]};
}
