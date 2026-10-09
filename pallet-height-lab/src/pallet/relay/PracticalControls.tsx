import {TOOL_NAMES,type PracticalSettings} from './practical';
export function PracticalControls({value,onChange}:{value:PracticalSettings;onChange:(v:PracticalSettings)=>void}){
 const patch=(v:Partial<PracticalSettings>)=>onChange({...value,...v});
 return <details className="practical-controls" open><summary>실전 배치 · 회전·교체 도구·정렬</summary>
 <label>회전 탐색<select aria-label="박스 회전 탐색" value={value.rotation} onChange={e=>patch({rotation:e.target.value as PracticalSettings['rotation']})}><option value="upright">Z축 0·90° · 세운 상태 유지</option><option value="xyz">XYZ축 90° · 허용된 6방향</option></select></label>
 <label>교체형 말단 도구<select aria-label="말단 도구" value={value.tool} onChange={e=>patch({tool:e.target.value as PracticalSettings['tool']})}>{Object.entries(TOOL_NAMES).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label>
 <label>중량 배치 기준<select aria-label="중량 배치 기준" value={value.weightPolicy} onChange={e=>patch({weightPolicy:e.target.value as PracticalSettings['weightPolicy']})}><option value="capacity">안정성·누적 허용하중 · 무게 순서 자유</option><option value="legacy">기존 무거운 박스 아래 규칙</option></select></label>
 <div className="flow-inputs">{([['positionErrorMm','배치 XY 오차 ± mm',50],['yawErrorDeg','배치 각도 오차 ± °',15],['jigTravelMm','정렬 보정 이동 한계 mm',100],['jigAngleDeg','정렬 보정 각도 한계 °',15]] as const).map(([k,n,max])=><label key={k}>{n}<input aria-label={n} type="number" min={0} max={max} step={.1} value={value[k]} onChange={e=>patch({[k]:Number(e.target.value)})}/></label>)}</div>
 <label className="practical-check"><input type="checkbox" checked={value.jig} onChange={e=>patch({jig:e.target.checked})}/>정렬 보조틀 · 범위 내 기하 보정</label>
 <label className="practical-check"><input type="checkbox" checked={value.assumeAxisLoads} onChange={e=>patch({assumeAxisLoads:e.target.checked})}/>합성 박스에 축별 하중 가정 적용</label>
 {value.assumeAxisLoads&&<label>옆면 허용하중 / 원래 허용하중<input aria-label="옆면 하중 가정 비율" type="number" min={0} max={1} step={.05} value={value.sideLoadFactor} onChange={e=>patch({sideLoadFactor:Number(e.target.value)})}/></label>}
 <p>90° 회전과 방향별 강도·취급 제한을 검사합니다. 강도 미상 방향은 눕히지 않습니다. 설정된 하중은 합성 가정이며 실측값이 아닙니다.</p><p>배치 후 실제 좌표를 재검사하고 중앙 상태를 갱신합니다. 보정되지 않은 각도 오차는 미지원으로 대기시킵니다. 정렬틀의 접촉력·실제 파지·IK는 미검증입니다. 교체 도구는 충돌 외곽·자중·가반하중 모델이며 현재 적재 대상은 박스입니다.</p>
 </details>;
}
