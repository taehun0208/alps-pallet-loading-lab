import { HARD_KEYS } from './model';
import type { Aggregate,HardResults } from './model';
import { HARD_NAMES } from './hardConstraints';
import { getAlgorithm } from './registry';
export function ConstraintMatrix({data}:{data:Aggregate[]}){
 return <details className="bench-panel bench-constraints"><summary>필수 제약 검증 / 점수와 독립 판정</summary><p>PASS는 표시된 모델과 입력 사양 범위에서만 통과입니다. 전체 로봇 링크·역기구학·실제 파지가 검증되지 않아 현재 결과는 잠정 순위입니다. 위반 후보의 사전 탈락은 실행 위반으로 세지 않습니다.</p><div className="bench-table-wrap"><table><thead><tr><th>필수 제약</th>{data.map(a=><th key={a.algorithm}>{getAlgorithm(a.algorithm).name}</th>)}</tr></thead><tbody>{HARD_KEYS.map(k=><tr key={k}><th>{HARD_NAMES[k]}</th>{data.map(a=>{const h=a.hardConstraints[k];return <td key={a.algorithm} className={h.status==='FAIL'?'bench-error':h.status==='PASS'?'bench-best':'bench-unverified'} title={`${h.scope} · ${h.reason}`}><b>{h.status}</b><small>{h.status==='FAIL'?`${h.violations}건`:h.status==='PASS'?`${h.checkedPlacements} 배치 검사`:'미검증'}</small></td>;})}</tr>)}</tbody></table></div>{!data.length&&<p>실행 후 항목별 근거가 표시됩니다.</p>}</details>;
}
export function TrialConstraints({data}:{data:HardResults}){return <details><summary>선택 실행의 10개 제약 판정</summary>{HARD_KEYS.map(k=><p key={k}><b>{HARD_NAMES[k]} · {data[k].status}</b><br/>{data[k].scope} · {data[k].reason}</p>)}</details>;}
