import type {TrialResult} from './engine/types';
import {distribution} from './metrics/statistics';
type Row=Pick<TrialResult,'algorithm'|'seed'|'metrics'|'status'|'violations'>;
const f=(n:number|null,d=2)=>n==null?'—':n.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});
export default function ImprovementPanel({rows}:{rows:Row[]}){
 const passing=rows.filter(r=>r.status==='finished'&&!r.violations.length&&!r.metrics.deadlineMisses);
 const base=new Map(passing.filter(r=>r.algorithm==='capacity-compact').map(r=>[r.seed,r]));
 const pairs=passing.filter(r=>r.algorithm==='floor-dense'&&base.has(r.seed)).map(r=>[base.get(r.seed)!,r] as const);
 if(!pairs.length)return null;
 const factors=[{title:'전체 적재율',unit:'%p',display:'%',direction:1,get:(r:Row)=>r.metrics.fill*100},
  {title:'바닥 면적 사용률',unit:'%p',display:'%',direction:1,get:(r:Row)=>(r.metrics.floorCoverage??NaN)*100},
  {title:'상자 사이 내부 빈틈',unit:'L',display:' L',direction:-1,get:(r:Row)=>r.metrics.columnVoidMm3/1e6}];
 return <section className="improvement"><header><h2>바꾸기 전과, 바꾼 다음</h2><span>Compact → ALPS Tetris · 같은 입고 {pairs.length}개 시드</span></header><div className="improvement-grid">{factors.map(metric=>{const valid=pairs.filter(([a,b])=>Number.isFinite(metric.get(a))&&Number.isFinite(metric.get(b))),left=distribution(valid.map(([a])=>metric.get(a))),right=distribution(valid.map(([,b])=>metric.get(b))),difference=distribution(valid.map(([a,b])=>metric.get(b)-metric.get(a)));return <article key={metric.title} data-better={difference.mean!==null&&difference.mean*metric.direction>0}><span>{metric.title}</span><strong>{difference.mean!==null&&difference.mean>0?'+':''}{f(difference.mean)}<small>{metric.unit}</small></strong><p>{f(left.mean)}{metric.display}<b>→</b>{f(right.mean)}{metric.display}</p><small>{difference.ci95?`차이의 95% CI [${f(difference.ci95[0])}, ${f(difference.ci95[1])}]`:'단일 실행 차이 · 신뢰구간 없음'}</small></article>;})}</div><p className="fine">차이는 같은 시드끼리 대응해 계산합니다. 양쪽 모두 기한·제약을 통과한 실행만 포함하며, 신뢰구간에 0이 포함되면 우열이 확정되었다고 해석하지 않습니다.</p></section>;
}
