import { HARD_KEYS } from './model';
import type { HardKey,HardResults,TrialRow,Violation } from './model';
export const HARD_NAMES:Record<HardKey,string>={collision:'박스 관통·중첩',bounds:'팔레트 외부 돌출',height:'최대 적재 높이',orientation:'허용 회전·방향',load:'하부 박스 허용하중',support:'최소 지지·정적 안정성',payload:'로봇 가반하중',robotCollision:'로봇·그리퍼 충돌',approach:'접근 자세·이동 경로',sequence:'실제 적재 순서 실행'};
/** Evidence belongs to the common evaluator, never to a planner's success claim.
 * PASS is scoped to the stated model. No IK/full-link/grasp evidence exists in this runner.
 */
export function hardResults(row:TrialRow):HardResults {
 const result={} as HardResults,checked=row.trace?.filter(t=>t.placement).length??0;
 const reasons=[...(row.proposalReasons??[]),...(row.finalReasons??[])];
 for(const key of HARD_KEYS){
  const base:Partial<Record<HardKey,Violation>>={collision:'collision',bounds:'bounds',height:'height',orientation:'orientation',load:'load',support:'support',payload:'payload'};
  const mapped=base[key];let violations=mapped?(row.proposalViolations[mapped]??0):0;
  if(key==='robotCollision')violations=reasons.filter(r=>/그리퍼|ROBOT/i.test(r)&&/충돌|간섭|collision/i.test(r)).length;
  if(key==='approach')violations=row.proposalViolations['robot-path']??0;
  if(key==='sequence')violations=(row.proposalViolations['robot-path']??0)+(row.proposalViolations.payload??0);
  const finalPatterns:Partial<Record<HardKey,RegExp>>={bounds:/경계|바닥 아래/,height:/최대 적재 높이/,collision:/겹침|관통/,orientation:/회전|Orientation|방향 유지|치수 불일치/i,load:/하중|적재 금지|무게 규칙|LOAD/i,support:/지지|무게중심|기둥|SUPPORT|전도/i};
  if(finalPatterns[key]&&row.finalReasons?.some(r=>finalPatterns[key]!.test(r)))violations=Math.max(1,violations);
  let verified=checked>0&&row.finalReasons!==undefined,scope='직육면체 기하·관측 규격 공통 검사',reason='확정 배치와 최종 적재 상태 검사';
  if(key==='load'){verified=verified&&row.strength==='explicit';scope='입력된 허용 상부하중 · 누적 정적 반력';reason=row.strength==='explicit'?'입력값 범위의 정적 검사. 실측 재료 인증 아님':'재질 예제값·생성 가정값 또는 강도 정보 누락';}
  if(key==='support'){scope='접촉·합력 작용점·정적 평형';reason='설정된 지지율·전도 여유 검사. 동적 붕괴·굽힘 파손 미검증';}
  if(key==='payload'){verified=verified&&row.robot==='proxy'&&Number.isFinite(row.constraints.gripper.payload)&&row.constraints.gripper.payload>0;scope='입력 가반하중 · 박스+그리퍼 질량';reason=verified?'사용자가 설정한 가반하중 한계 검사':'로봇 가반하중 검사 비활성 또는 유효한 사양 없음';}
  if(['robotCollision','approach','sequence'].includes(key)){verified=false;scope=row.robot==='proxy'?'TCP·그리퍼 스윕 근사만 수행':'로봇 검사 비활성';reason=key==='robotCollision'?'전체 로봇 링크 충돌 미검증':key==='approach'?'실제 관절 한계·역기구학·접근 자세 미검증':'실제 파지·관절 궤적·전 과정 실행 미검증';}
  result[key]={status:violations?'FAIL':verified?'PASS':'NOT VERIFIED',violations,checkedPlacements:checked,scope,reason:checked||violations?reason:'검증할 확정 배치 없음'};
 }
 return result;
}
export function aggregateHard(rows:TrialRow[]):HardResults {
 const matrices=rows.map(r=>r.hardConstraints??hardResults(r));
 return Object.fromEntries(HARD_KEYS.map(key=>{
  const items=matrices.map(m=>m[key]),status=items.some(v=>v.status==='FAIL')?'FAIL':items.length&&items.every(v=>v.status==='PASS')?'PASS':'NOT VERIFIED';
  return [key,{status,violations:items.reduce((n,v)=>n+v.violations,0),checkedPlacements:items.reduce((n,v)=>n+v.checkedPlacements,0),scope:[...new Set(items.map(v=>v.scope))].join(' / '),reason:[...new Set(items.map(v=>v.reason))].join(' / ')}];
 })) as HardResults;
}
