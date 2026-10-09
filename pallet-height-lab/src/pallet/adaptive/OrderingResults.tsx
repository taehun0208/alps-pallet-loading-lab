import type {Trial} from './performance';
import type {metrics} from './runtime';
import type {SearchStats} from './types';
export type OrderingComparison=Trial&{label:string;metrics:ReturnType<typeof metrics>};
function save(name:string,value:string,type:string){const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function OrderingResults({rows,busy,onRun,onTrial,search}:{rows:OrderingComparison[];busy:boolean;onRun:()=>void;onTrial:(r:Trial)=>void;search?:SearchStats}){
 return <section className="adaptive-panel adaptive-comparison"><details><summary>의존성·재사용·버퍼 비교 · 연구 옵션</summary>
 <p>현재 입력으로 11개 조건을 실행합니다. 기존 C와 동일한 실제 물품·도착 순서·난수·계산 예산·실행 판정을 사용합니다. 버퍼 실험만 임시 보관 용량을 변경합니다.</p>
 <div className="adaptive-section-title"><button disabled={busy} onClick={onRun}>개선 기법 비교 실행</button><div><button disabled={!rows.length} onClick={()=>save('ordering-comparison.json',JSON.stringify({scope:'도착한 물품만 선택; CDG는 탐색 보조',rows},null,2),'application/json')}>개선 비교 JSON</button><button disabled={!rows.length} onClick={()=>{const keys=['placed','heightMm','planningMs','bufferPeak','additionalHandlingEstimate'] as const;save('ordering-comparison.csv','label,seed,'+keys.join(',')+',candidates,priorHits,equivalentSkipped\n'+rows.map(r=>[r.label,r.config.seed,...keys.map(k=>r.metrics[k]),r.metrics.search.checked,r.metrics.search.priorHits,r.metrics.search.equivalentSkipped].join(',')).join('\n'),'text/csv');}}>개선 비교 CSV</button></div></div>
 {search&&<p>현재 누계 · 후보 {search.checked} · EMS 갱신 {search.spaceUpdates} · 이전 위치 재사용 {search.priorHits}/{search.priorChecks} · 동등 물품 생략 {search.equivalentSkipped} · 제거 검사 {search.dependencyChecks} · 예산 도달 {search.capped}</p>}
 {!!rows.length&&<div className="adaptive-table-wrap"><table><thead><tr>{['조건','배치 수','높이 mm','계획 ms','후보 수','재사용','버퍼 최대','추가 취급 추정','제약 위반','단계 재생'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{r.label}</td><td>{r.metrics.placed}/{r.metrics.input}</td><td>{r.metrics.heightMm.toFixed(0)}</td><td>{r.metrics.planningMs.toFixed(1)}</td><td>{r.metrics.search.checked}</td><td>{r.metrics.search.priorHits}</td><td>{r.metrics.bufferPeak}</td><td>{r.metrics.additionalHandlingEstimate}회</td><td>{r.metrics.finalViolations.length}</td><td><button onClick={()=>onTrial(r)}>{r.label} 보기</button></td></tr>)}</tbody></table></div>}
 <p>추가 취급은 보관 대상별 입고·출고 2회 가정이며 실제 로봇 동작 횟수가 아닙니다. 계산시간은 현재 장비·브라우저에서 측정합니다. 밀도·높이·지연시간의 개선은 입력에 따라 달라집니다.</p>
 </details></section>;
}
