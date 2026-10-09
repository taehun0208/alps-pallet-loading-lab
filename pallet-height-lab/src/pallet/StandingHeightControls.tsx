import { DEFAULT_STANDING_HEIGHT } from './standingHeight';
import type { Constraints } from './types';
export function StandingHeightControls({value,onChange}:{value:Constraints['standingHeight'];onChange:(value:NonNullable<Constraints['standingHeight']>)=>void}){
 const cfg={...DEFAULT_STANDING_HEIGHT,...value};
 return <div className="pallet-contract"><label><input type="checkbox" checked={cfg.enabled} onChange={e=>onChange({...cfg,enabled:e.target.checked})}/> 세로 박스 주변 높이 맞춤</label><label>세로 박스 최대 돌출 mm<input type="number" aria-label="세로 박스 최대 돌출 mm" min={0} max={500} step={10} value={cfg.maxRiseMm} disabled={!cfg.enabled} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))onChange({...cfg,maxRiseMm:Math.max(0,Math.min(500,n))});}}/></label><small>높이가 바닥 짧은 변의 1.25배를 넘으면 가까운 눕힌 적재와 높이를 맞춥니다. 돌출은 설정값과 박스 높이의 25% 중 작은 값까지 허용합니다. 주변 층이 부족한 박스는 재고 선택 모드에서 보류·재검사합니다. 이웃을 하중 받침으로 간주하지 않습니다.</small></div>;
}
