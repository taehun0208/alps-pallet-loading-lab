import {usesRoller} from './rollerQueue';
import type {Scenario} from '../types';
import type {RelayWorld,RelayMotion} from './types';
import type {FlowDecision} from './streamPlanner';
export function DecisionInspector({scenario,world,motions,decision}:{scenario:Scenario;world:RelayWorld;motions:RelayMotion[];decision:FlowDecision|null}){
 const action=motions[0]?.action,proposal=action?decision?.proposals.find(p=>p.boxId===action.boxId):decision?.proposals[0];
 const box=world.boxes.find(b=>b.observation.id===(action?.boxId??proposal?.boxId)),c=action?.candidate??proposal?.candidates[0],p=c?.placement;
 return <section className="decision-inspector" aria-label="한 대의 적재 알고리즘 상세">
  <div className="studio-section-label"><h3>이 박스를 고른 이유</h3><span>DECISION TRACE</span></div>
  <ol className="decision-pipeline"><li>01 계측된 박스만 확인</li><li>02 회전·빈자리 후보 생성</li><li>03 지지·하중·경로 검사</li><li>04 후속 공간 손실 비교</li><li>05 중앙 명령 → {usesRoller(scenario.pallet)?'롤러 선두 집기':'추적 집기'}</li></ol>
  <p className="decision-state">{action?'실행 중인 중앙 명령':proposal?'최근 검토 · 아직 실행 보장 아님':'첫 박스의 계측을 기다립니다.'}</p>
  {box&&<><h4>{box.observation.id} <small>{box.observation.weight} kg</small></h4><p>{box.observation.size.w} × {box.observation.size.d} × {box.observation.size.h} mm</p><p>{action?.reason??box.flow?.lastReason??proposal?.reason}</p></>}
  {p&&<dl><div><dt>선택 팔레트 · 위치 X / Y / Z</dt><dd>P{(action?.pallet??proposal?.pallet??0)+1} · {p.position.x.toFixed(0)} / {p.position.y.toFixed(0)} / {p.position.z.toFixed(0)} mm</dd></div><div><dt>회전 / 배치 후 상면</dt><dd>{String(p.orientation)} / {(p.position.z+p.size.h).toFixed(0)} mm</dd></div><div><dt>바닥 지지율</dt><dd>{(p.supportRatio*100).toFixed(1)}%</dd></div><div><dt>후속 막힘 표본</dt><dd>{proposal?.blocked??'—'} / {proposal?.tested??'—'}개</dd></div></dl>}
  <small>3D 선: 운반 경로 · 점선: 목표 위치 · 면: 접촉 영역. 높이 상한 {scenario.pallet.maxHeight} mm. 후속 표본은 확률이 아닙니다.</small>
  <details><summary>최근 완료된 적재 {world.records.length}회</summary>{world.records.slice(-5).reverse().map(r=><p key={r.step}><b>{r.step}. {r.boxId}</b> · {r.position?`${r.position.x}, ${r.position.y}, ${r.position.z} mm`:''}<br/>{r.reason}</p>)}</details>
 </section>;
}
