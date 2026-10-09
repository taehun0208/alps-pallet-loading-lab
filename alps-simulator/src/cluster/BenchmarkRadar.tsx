import {useEffect,useRef,useState,type CSSProperties} from 'react';
import './benchmark-radar.css';

type Estimate={mean:number;ci95Low:number;ci95High:number};
type Axis={id:string;label:string;weight:number;formula:string};
type Row={algorithm:string;name:string;n:number;axes:Record<string,Estimate>;score:Estimate;frozenScore:Estimate;raw:{count:number;volumeL:number;heightMm:number;columnVoidL:number;trialP95Ms:number};pooledP95Ms:number};
type Condition={id:string;height:number;boxes:number;skus:number;width:number;depth:number;n:number;runs:number;rows:Row[]};
type Data={schema:string;complete:boolean;auditedRuns:number;plan:{postEvaluation:boolean;axes:Axis[]};conditions:Condition[]};
const format=(v:number,d=1)=>v.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});
const colors:Record<string,string>={blb:'#6c7f91','capacity-compact':'#547aa5','strategy-greedy':'#8666af',lookahead:'#b8668b','future-hybrid':'#a68b31','floor-dense':'#bd722d','cluster-layer':'#218577'};
const initial=['capacity-compact','floor-dense','cluster-layer'];
const point=(index:number,value:number,radius=154)=>{
 const angle=-Math.PI/2+index*Math.PI/3;
 return [330+Math.cos(angle)*radius*value/100,250+Math.sin(angle)*radius*value/100];
};
const polygon=(values:number[],radius=154)=>values.map((value,i)=>point(i,value,radius).join(',')).join(' ');

function Radar({axes,rows}:{axes:Axis[];rows:Row[]}){
 return <svg className="br-chart" viewBox="0 0 660 500" role="img" aria-labelledby="br-chart-title br-chart-desc">
  <title id="br-chart-title">여섯 가지 적재 성능 비교</title>
  <desc id="br-chart-desc">모든 축은 0점에서 100점입니다. 바깥쪽일수록 점수가 높습니다. {rows.map(r=>`${r.name} 종합 ${format(r.score.mean,2)}점`).join(', ')}. 축별 정확한 값은 옆 표에서 확인할 수 있습니다.</desc>
  {[100,80,60,40,20].map(value=><g key={value}><polygon points={polygon(Array(6).fill(value))} fill={value===100?'#f7fafc':'none'} stroke="#dbe5ec" strokeWidth="1"/><text x="338" y={250-value*154/100+4} className="br-grid-label">{value}</text></g>)}
  {axes.map((axis,i)=>{const [x,y]=point(i,100);const [lx,ly]=point(i,100,211);return <g key={axis.id}><line x1="330" y1="250" x2={x} y2={y} stroke="#dbe5ec"/><text x={lx} y={ly-3} textAnchor={i===1||i===2?'start':i===4||i===5?'end':'middle'} className="br-axis-label"><tspan x={lx}>{axis.label}</tspan><tspan x={lx} dy="19" className="br-axis-weight">가중치 {axis.weight}%</tspan></text></g>;})}
  {rows.map((row,index)=><g key={row.algorithm} style={{color:colors[row.algorithm]}}><polygon points={polygon(axes.map(a=>row.axes[a.id].mean))} fill="currentColor" fillOpacity=".055" stroke="currentColor" strokeWidth="2.4" strokeDasharray={index===1?'7 3':index===2?'2 3':undefined}/>{axes.map((axis,i)=>{const value=row.axes[axis.id].mean,[x,y]=point(i,value);return <g key={axis.id} tabIndex={0} role="img" aria-label={`${row.name}, ${axis.label} ${format(value,2)}점`}><title>{row.name} · {axis.label} {format(value,2)}점</title>{index===1?<rect x={x-3.5} y={y-3.5} width="7" height="7" fill="currentColor" stroke="white"/>:index===2?<polygon points={`${x},${y-4.5} ${x-4},${y+3.5} ${x+4},${y+3.5}`} fill="currentColor" stroke="white"/>:<circle cx={x} cy={y} r="4" fill="currentColor" stroke="white"/>}</g>;})}</g>)}
 </svg>;
}

export default function BenchmarkRadar({replayReady,replayBoxes=72}:{replayReady:boolean;replayBoxes?:number}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[conditionId,setConditionId]=useState('h1200-n30-s6'),[selected,setSelected]=useState(initial);
 const section=useRef<HTMLElement>(null);
 useEffect(()=>{let active=true;fetch('/benchmark-radar/index.json').then(async response=>{if(!response.ok)throw Error('1,400회 벤치마크 자료를 불러오지 못했습니다.');const value:Data=await response.json();if(value.schema!=='alps-six-axis-benchmark/1'||!value.complete||value.auditedRuns!==1400||value.plan.axes.length!==6||value.plan.axes.reduce((n,a)=>n+a.weight,0)!==100||value.conditions.length!==2||value.conditions.some(c=>c.rows.length!==7||c.rows.some(r=>r.n!==100||!Number.isFinite(r.score.mean)||value.plan.axes.some(a=>!Number.isFinite(r.axes[a.id]?.mean)))))throw Error('벤치마크 표본 또는 지표 형식을 확인해주세요.');if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 useEffect(()=>{if(data&&replayReady&&new URLSearchParams(location.search).get('benchmark')==='six')section.current?.scrollIntoView({block:'start'});},[data,replayReady]);
 const condition=data?.conditions.find(c=>c.id===conditionId);
 const rows=condition?.rows.filter(r=>selected.includes(r.algorithm))??[];
 const toggle=(id:string)=>setSelected(ids=>ids.includes(id)?ids.length>1?ids.filter(x=>x!==id):ids:ids.length<3?[...ids,id]:ids);
 return <section className="br-section" id="benchmark-six" ref={section} aria-labelledby="br-title">
  <header className="br-heading"><div><h2 id="br-title">여섯 지표로 보는 벤치마킹</h2><p>우리 1,400회 시험 · 정책별 100회 전체 평균 · 모든 축은 100점 기준</p></div><span className="br-audited">원자료 1,400회 검산 완료</span></header>
  <p className="br-dataset-note">아래 차트는 <b>30개 박스·6 / 8 SKU 시험</b> 결과입니다. {replayBoxes===72?'72개 박스를 재생하는 화면과는 별도 조건이며, ':'선택한 개별 배치와 구별되는 전체 평균이며, '}선택한 재생 시드는 이 평균을 바꾸지 않습니다.</p>
  {error?<p className="br-error" role="alert">{error}</p>:!data||!condition?<p className="br-loading" role="status">1,400회 원자료에서 계산한 점수를 불러오는 중…</p>:<>
   <div className="br-controls"><div className="br-condition-buttons" role="group" aria-label="벤치마크 SKU 조건">{data.conditions.map(c=><button key={c.id} aria-pressed={c.id===conditionId} onClick={()=>setConditionId(c.id)}>{c.skus} SKU <span>100입고 순서</span></button>)}</div><span>{condition.width} × {condition.depth}mm · 높이 {condition.height}mm · {condition.boxes}개 · 700회</span></div>
   <fieldset className="br-policy-options"><legend>차트에서 비교할 알고리즘 · 최대 3개</legend>{condition.rows.map(row=>{const checked=selected.includes(row.algorithm);return <label key={row.algorithm} style={{'--br-policy-color':colors[row.algorithm]} as CSSProperties}><input type="checkbox" checked={checked} disabled={checked?selected.length===1:selected.length===3} onChange={()=>toggle(row.algorithm)}/><i/>{row.name}</label>;})}</fieldset>
   <div className="br-main"><div className="br-plot"><Radar axes={data.plan.axes} rows={rows}/><p>바깥쪽일수록 높은 점수 · 선 모양과 점 모양으로도 정책을 구분합니다.</p></div><div className="br-results">
    <div className="br-score-cards">{rows.map(row=><article key={row.algorithm} style={{borderTopColor:colors[row.algorithm]}}><h3>{row.name}</h3><strong>{format(row.score.mean,2)}<small> / 100</small></strong><p>평균의 95% 구간<br/>{format(row.score.ci95Low,2)}–{format(row.score.ci95High,2)}</p><span>n = {row.n}</span></article>)}</div>
    <div className="br-axis-table"><table><caption>지표별 점수 · 100회 평균</caption><thead><tr><th>평가지표</th>{rows.map(r=><th key={r.algorithm} style={{color:colors[r.algorithm]}}>{r.name}</th>)}</tr></thead><tbody>{data.plan.axes.map(axis=><tr key={axis.id}><th>{axis.label}<small>{axis.weight}%</small></th>{rows.map(r=><td key={r.algorithm} title={axis.formula}>{format(r.axes[axis.id].mean,2)}</td>)}</tr>)}</tbody></table></div>
   </div></div>
   <div className="br-weight-note"><b>종합 점수</b><span>{data.plan.axes.map(a=>`${a.label} ${a.weight}`).join(' + ')}</span><p>적재량·밀도·공극·바닥 활용에 85%, SKU 접촉에 10%, 계산 속도에 5%를 둔 <b>사후 표시용 점수</b>입니다. 기존 사전 점수와 통계 검정 결과는 유지합니다.</p></div>
   <div className="br-full-table"><table><caption>{condition.skus} SKU · 7개 알고리즘 전체 · 정책별 n = 100</caption><thead><tr><th>알고리즘</th><th>6축 점수</th><th>기존 사전 점수</th><th>적재 수 /30</th><th>부피 수용률</th><th>사용 높이 밀도</th><th>내부 공극 L</th><th>SKU 접촉</th><th>판단 P95 ms</th></tr></thead><tbody>{condition.rows.map(row=><tr key={row.algorithm} className={selected.includes(row.algorithm)?'br-highlight':''}><th>{row.name}</th><td><b>{format(row.score.mean,2)}</b></td><td>{format(row.frozenScore.mean,2)}</td><td>{format(row.raw.count,2)}</td><td>{format(row.axes.acceptance.mean)}%</td><td>{format(row.axes.density.mean)}%</td><td>{format(row.raw.columnVoidL,2)}</td><td>{format(row.axes.sku.mean)}%</td><td>{format(row.pooledP95Ms)}</td></tr>)}</tbody></table></div>
   <details className="br-method"><summary>여섯 지표의 계산식과 점수 해석</summary><dl>{data.plan.axes.map(axis=><div key={axis.id}><dt>{axis.label} · {axis.weight}%</dt><dd>{axis.formula}</dd></div>)}</dl><p>각 실행의 여섯 점수를 가중합한 뒤, 같은 SKU 조건의 입고 순서 100개를 평균했습니다. 신뢰구간은 입고 순서를 표본으로 한 기술통계 95% t 구간입니다. 알고리즘 우월성을 검정한 보정 구간과는 구별합니다.</p><p>계산 속도 점수는 실행별 30개 판단의 P95를 먼저 점수화한 평균입니다. 위 전체 표의 P95는 3,000개 판단시간을 합친 분위수이므로 두 집계 방식은 다릅니다. 시간은 공유 CPU 실측값이며 9,000ms 기한에 대한 여유 점수입니다.</p><p>내부 공극 효율은 각 수직 기둥의 최상단 아래 채워진 비율입니다. 공극의 연결성·로봇 접근 가능성·동적 붕괴를 검증하는 점수는 아닙니다. 서로 다른 SKU 조건을 합쳐 평균하지 않았으며 팀원 시험 수치는 사용하지 않았습니다.</p><p>기존 사전 점수 = 부피 수용률 60 + 바닥 활용 15 + 동일 SKU 접촉 15 + 기한 준수 10. 새 6축 점수는 사후에 구성한 설명 지표이며 산업 표준·보편적 최적성의 근거로 해석하지 않습니다.</p></details>
   <div className="br-downloads"><a href={`/benchmark-radar/radar-${condition.skus}sku.png`} download>육각형 차트 PNG</a><a href="/benchmark-radar/index.json" download>평균·신뢰구간 JSON</a><a href="/benchmark-radar/trials.csv" download>1,400회 실행별 점수 CSV</a><a href="/benchmark-radar/score-plan.json" download>가중치·계산식</a><a href="/benchmark-radar/physics-guide.md" download>군집 물리·계산식 쉬운 설명</a><a href="/benchmark-radar/ppt-guide.md" download>PPT용 핵심 설명·발표 멘트</a></div>
  </>}
 </section>;
}
