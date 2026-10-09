import { heightSummary } from './heightSummary';
import type { Frame,Scenario } from './types';

export function HeightSummary({frame,scenario:s}:{frame:Frame;scenario:Scenario}){
 const h=heightSummary(frame,s);
 return <section className="pallet-height-summary" aria-label="적재 높이 분석" data-layers={h.layers}>
  <div className="pallet-height-heading"><b>최대 {h.layers}단 <small>지지 연결 기준</small></b><span>{h.height.toLocaleString()} / {h.limit.toLocaleString()} mm</span></div>
  <meter aria-label="현재 적재 높이" min={0} max={h.limit} value={h.height}/>
  <p>높이 여유 {h.headroom.toLocaleString()} mm · 서로 다른 높이의 박스는 같은 단에서도 윗면이 다를 수 있습니다.</p>
  {frame.blocked&&<div className="pallet-height-diagnosis">
   <b>왜 여기서 멈췄나요?</b>
   {h.blockedBox&&s.supplyMode!=='stock-select'&&<p>다음 박스 {h.blockedBox.id}: {h.blockedBox.size.w} × {h.blockedBox.size.d} × {h.blockedBox.size.h} mm · {h.blockedBox.weight} kg</p>}
   <p>{h.headroom>0?'위쪽 높이가 남아 있어도 박스가 들어갈 바닥 공간이나 하중을 버틸 지지면이 필요합니다.':'설정한 적재 높이에 도달했습니다. 추가 적재에는 높이뿐 아니라 지지·하중·로봇 조건도 필요합니다.'}</p>
   {h.bestUpperSupport!==null&&s.supplyMode!=='stock-select'&&<p>팔레트 안에서 검사한 상단 후보 {h.upperInspected}개: 최대 바닥 지지율 {(100*h.bestUpperSupport).toFixed(1)}% / 필요한 지지율 {(100*s.constraints.supportRatio).toFixed(1)}%</p>}
   {Object.keys(h.rejectionCounts).length>0&&<p>주요 탈락 조건: {Object.entries(h.rejectionCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([reason,n])=>`${reason} (${n}회)`).join(' · ')}</p>}
   <p>{s.supplyMode==='stock-select'?'남은 재고 종류를 모두 검토했지만 현재 탐색 위치에서 가능한 배치를 찾지 못했습니다.':'현재는 버퍼가 없는 순차 투입입니다. 도착한 박스를 보류할 수 없어 여기서 멈춥니다. 상단의 ‘현재 재고 모아서 실행’은 모든 박스를 꺼낼 수 있다는 별도 조건으로 순서를 다시 정합니다.'}</p>
   <small>진단은 검토한 후보 기준입니다. 생성 {h.generated.toLocaleString()} / 결과에 표시한 후보 {h.inspected.toLocaleString()}개이며, 전체 연속 공간의 불가능성 증명은 아닙니다.</small>
  </div>}
 </section>;
}
