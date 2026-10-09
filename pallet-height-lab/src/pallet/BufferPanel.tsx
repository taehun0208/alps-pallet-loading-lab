import type { Analysis,Frame } from './types';
export function BufferPanel({frame,analysis,enabled}:{frame:Frame;analysis:Analysis|null;enabled:boolean}){
 const held=frame.buffer||[],returned=frame.records.filter(r=>r.disposition==='placed'&&r.analysis?.bufferPlan?.releasedId);
 return <section className="pallet-buffer-panel" aria-label="임시 대기 및 상단 복귀">
  <b>임시 대기 {held.length} / 1 · 상단 복귀 {returned.length}개</b>
  <p>{enabled?'다른 박스의 자리를 막는 박스는 팔레트 밖에 보류합니다. 주변 적재 후에도 안전한 최상단 복귀 자리가 남는 배치만 진행합니다.':'전체 재고 선택 · 낮은 빈자리 전략에서 임시 대기를 켜면 사용할 수 있습니다.'}</p>
  {held.map(h=><div key={h.observation.id}><strong>{h.observation.id} · 외부 대기 중</strong><p>{h.reason}</p><small>현재 검증된 복귀 바닥 높이 {h.reservedTop.position.z} mm · 다음 배치마다 재검사</small></div>)}
  {!held.length&&analysis?.bufferPlan?.addedIds.length? <p>다음 확정 시 보류 예정: {analysis.bufferPlan.addedIds.join(', ')}</p>:null}
  {analysis?.bufferPlan?.releasedId&&<p>다음 배치: {analysis.bufferPlan.releasedId} 회수 → 최상단</p>}
  {!!returned.length&&<small>복귀 완료: {returned.map(r=>`${r.observation.id} (${r.placement!.position.z} mm 위)`).join(' · ')}</small>}
  <details><summary>보류 조건과 적용 범위</summary><p>이미 도착해 선택 가능한 재고만 사용합니다. 외부 대기대는 800 × 650 mm, 1개 자리입니다. 대기대로 분류하는 공급 과정은 모델 밖이며, 회수 경로는 대기대 위치에서 계산합니다. 기존 적재 박스를 빼거나 미도착 박스를 미리 가져오지 않습니다.</p><p>두 배치 순서와 제한된 후보 위치를 비교합니다. 전역 최적해를 보장하지 않으며, 지지·재질 하중·높이·접근 조건을 유지합니다. 상단 복귀 여유가 없어지기 전 먼저 회수할 수 있습니다.</p></details>
 </section>;
}
