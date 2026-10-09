import { ArrivalEnvironment } from './environment';
import { inspectConstraints } from './constraints';
import type { Frame,Scenario,ScenarioEvent } from './types';

export function observedEvent(s:Scenario,frame:Frame,event:Omit<ScenarioEvent,'step'>):Scenario{
 const next=structuredClone(s),step=frame.processed+1;
 next.events=[...next.events.filter(e=>e.step!==step),{...event,step}];return next;
}

// Reconfigure the uncommitted suffix. Confirmed IDs, geometry and observations remain immutable.
export function replanFrame(frame:Frame,old:Scenario,next:Scenario):Frame{
 if(old.supplyMode==='stock-select'||next.supplyMode==='stock-select')throw Error('부분 재계획은 순차 투입 모드에서 사용합니다.');
 if(JSON.stringify(old.types)!==JSON.stringify(next.types)||JSON.stringify(old.arrival)!==JSON.stringify(next.arrival))throw Error('박스 세트·수량·입고 시드 변경은 새 실행을 사용하세요. 부분 재계획은 팔레트·제약·현재 관측을 변경합니다.');
 const env=new ArrivalEnvironment(next),records=frame.records.filter(r=>r.disposition!=='blocked');let placed:Frame['placements']=[];
 for(const r of records){
  if(JSON.stringify(env.current(r.step-1))!==JSON.stringify(r.observation))throw Error('이미 처리한 입고 관측은 변경할 수 없습니다.');
  if(r.disposition!=='placed')continue;
  const p=frame.placements.find(p=>p.id===r.observation.id)!,check=inspectConstraints(p,r.observation,placed,next.pallet,{...next.constraints,robotMode:'ideal'});
  if(check.reasons.length)throw Error(`확정 적재 ${p.id}가 새 조건을 위반합니다: ${check.reasons.join(' / ')}`);
  placed=check.stack;
 }
 return {...frame,replanCount:(frame.replanCount||0)+1,records,placements:placed,blocked:false,reason:''};
}
