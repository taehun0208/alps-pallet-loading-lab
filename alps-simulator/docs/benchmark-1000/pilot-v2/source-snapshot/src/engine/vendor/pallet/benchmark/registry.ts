import { BUNDLED_ALGORITHM_VERSION } from './version';
import { plan } from '../planner';
import { candidateSet } from '../candidates';
import { ALGORITHM_NAMES } from '../types';
import { planPackaging,sceneCandidate,PACKAGE_SETTINGS } from '../packaging/planner';
import type { Method } from '../packaging/planner';
import type { Algorithm,Analysis } from '../types';
import type { AlgorithmEntry } from './model';
const entries=new Map<string,AlgorithmEntry>();
/** Add a bundled adapter here; Worker and UI import this same registry. Never overwrite an ID. */
export function registerAlgorithm(entry:AlgorithmEntry){if(!entry.id||entries.has(entry.id))throw Error('중복 알고리즘 ID');entries.set(entry.id,entry);}
for(const [id,name] of Object.entries(ALGORITHM_NAMES))registerAlgorithm({id,name,version:BUNDLED_ALGORITHM_VERSION,scope:'online',family:'기존 공통 계획기',description:'현재 도착 박스·잔여 종류별 수량만 사용',plan:i=>plan({...i,algorithm:id as Algorithm,available:undefined})});
registerAlgorithm({id:'blb',name:'Bottom-Left-Back',version:BUNDLED_ALGORITHM_VERSION,scope:'online',family:'기준선',description:'공통 제약 통과 후 z → y → x, 미래 평가 없음',plan:i=>{
 const start=performance.now(),r=candidateSet({...i,settings:{...i.settings,inventoryMode:'none'}}),valid=r.candidates.filter(c=>c.valid).sort((a,b)=>a.placement.position.z-b.placement.position.z||a.placement.position.y-b.placement.position.y||a.placement.position.x-b.placement.position.x);
 return {...r,runId:i.runId,stepId:i.stepId,selectedId:valid[0]?.id??null,valid:valid.length,rejections:{},nodes:r.candidates.length,rolloutCalls:0,milliseconds:performance.now()-start,virtualSequences:[],explanation:['최저 z → y → x']};
}});
for(const [id,name,method] of [['pack-first','First Fit','first'],['pack-greedy','Greedy · 포장 후보','greedy'],['pack-tetris','3D Tetris · 포장 휴리스틱','tetris'],['pack-beam','Beam · Future-aware','future'],['pack-robust','Robust Beam · Future-aware','robust']] as const){
 registerAlgorithm({id,name,version:BUNDLED_ALGORITHM_VERSION,scope:'online',family:'기존 포장 계획기 어댑터',description:method==='future'||method==='robust'?'기존 Beam + 가상 잔량 순서. 실제 미래 비공개':'기존 포장 계획기. 공통 확정 검사 재사용',plan:i=>{
  const r=planPackaging({scenario:{pallet:i.pallet,types:i.types,constraints:i.constraints},placements:i.placements,current:i.current,remaining:i.remaining,method:method as Method,step:i.stepId,settings:{...structuredClone(PACKAGE_SETTINGS),seed:i.settings.plannerSeed,maxCandidates:i.settings.maxCandidates}});
  return {runId:i.runId,stepId:i.stepId,selectedId:r.selectedId,candidates:r.candidates.map(sceneCandidate),generated:r.generated,checkedCandidates:r.checked,valid:r.valid,rejections:r.rejected,nodes:r.checked,rolloutCalls:r.futureChecks,milliseconds:r.milliseconds,capped:r.capped,virtualSequences:r.sequences,explanation:['기존 포장 계획기를 공통 인터페이스로 연결']};
 }});
}
registerAlgorithm({id:'offline-stock',name:'오프라인 기준해 · 전체 재고',version:BUNDLED_ALGORITHM_VERSION,scope:'offline',family:'참고용, 순위 제외',description:'전체 재고 재정렬 허용 Greedy. 최적해 아님; 온라인 정보 조건과 다름',plan:i=>plan({...i,algorithm:'greedy'})});
export const algorithmRegistry=()=>[...entries.values()];
export function getAlgorithm(id:string){const result=entries.get(id);if(!result)throw Error(`등록되지 않은 알고리즘: ${id}`);return result;}
