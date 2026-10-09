import { useEffect, useMemo, useState } from 'react';
import PalletScene, { type ViewOptions } from '../PalletScene';
import { DEFAULT_ROBOT_ARM } from '../robotArm';
import type { OrderRun, Policy } from './model';
import './focused-alps.css';

type Section = 'benchmark' | 'robot' | 'store' | 'downloads';
type Statistic = { mean: number; ci95: [number, number] | null };
type CapacityResult = { algorithm: string; n: number; utilization: Statistic; count: Statistic; ms: Statistic };
type OrderResult = { policy: Policy; n: number; fill: number; pallets: number; total: number; packing: number; store: number; redistribution: number; shelf: number; rehandles: number; walked: number; meanMs: number; maxMs: number };
interface FocusData {
  capacity: { selected: string; holdout: CapacityResult[]; maxMs: number; completed: number; violations: number; rows: {algorithm: string; seed: number; split: string; utilization: number; meanMs: number; maxMs: number}[]; paired: {before: string; fillPercentagePointDifference: Statistic}[] };
  order: { policies: OrderResult[]; selection: {baseline: Policy; alps: Policy; worst: Policy}; replaySeed: number; report: {saved: Statistic; wins: number; losses: number; n: number}; storeConfig: {walkSpeed: number; elevatorSeconds: number; cartBoxes: number; cartKg: number; takeSeconds: number; sortSeconds: number} };
}
const names: Record<string, string> = { 'capacity-compact': 'Compact', 'future-hybrid': 'Future-Aware Hybrid', blb: 'Bottom-Left-Back', lookahead: 'Lookahead', 'strategy-greedy': 'Greedy' };
const policyName = (p: Policy) => `${names[p.algorithm] ?? p.algorithm}${p.organized ? ' + 구역 선호' : ''}`;
const f = (n: number, digits = 1) => n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const seconds = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
const options: ViewOptions = { opacity: 1, outlines: true, slice: 3000, weight: false, supports: false, center: false, candidates: false, path: true, arm: true, armModel: {...DEFAULT_ROBOT_ARM, baseX: -700, baseY: -500} };
const finishedOptions: ViewOptions = {...options, arm: false, tool: false, path: false};

function RobotStage({run, time, title}: {run: OrderRun; time: number; title: string}) {
  const [batch, setBatch] = useState(-1);
  const done = time >= run.packingSeconds;
  const index = run.packingEvents.findIndex(e => time >= e.start && time < e.end);
  const event = run.packingEvents[index], next = run.packingEvents[index + 1];
  const visible = useMemo(() => done ? run.batches[batch < 0 ? run.batches.length - 1 : batch].boxes : event?.before ?? [], [run, done, batch, index]);
  const moving = !done && event?.kind === 'robot';
  const parallel = !done && event && ['robot','exchange'].includes(event.kind) && next?.kind === 'plan' && (next.overlapSeconds ?? 0) > 0;
  const count = done ? run.total : run.packingEvents.filter(e => e.kind === 'robot' && e.end <= time).length;
  return <article className="focus-robot-stage"><header><div><span>{title}</span><h3>{policyName(run.policy)}</h3></div><b>{count}<small> / {run.total}박스</small></b></header>
    <div className="focus-3d"><PalletScene scenario={run.scenario} placements={visible} current={moving ? event.box : null} candidate={moving ? event.candidate : null} path={moving ? event.candidate?.path : null} motion={moving} progress={event ? (time-event.start)/(event.end-event.start) : 0} options={done ? finishedOptions : options} camera={done ? 'iso' : 'cell'} cameraVersion={0}/></div>
    <div className="focus-arrivals" aria-label="동일한 랜덤 입고 순서">{run.arrivals.map((id,i) => <i key={id} title={`${i+1}번째 ${id}`} style={{background: run.scenario.types.find(t=>id.startsWith(`${t.id}-`))?.color, opacity: i<count ? 1 : .25}}/>)}</div>
    <div className="focus-robot-status" role="status">{done ? '전체 주문 적재 완료' : parallel ? `다음 박스 ${next.box?.id} 계산 ${f(next.planningMs ?? 0)} ms · 운반 중 병행` : event?.message ?? '시연 재생을 누르면 적재를 시작합니다.'}</div>
    <dl className="focus-robot-metrics"><div><dt>로봇 적재 경과</dt><dd>{seconds(Math.min(time,run.packingSeconds))}<small> / {seconds(run.packingSeconds)}</small></dd></div><div><dt>사용 팔레트</dt><dd>{run.batches.length}<small>개</small></dd></div><div><dt>계산으로 추가 대기</dt><dd>{f(run.planningWaitSeconds*1000,2)}<small>ms</small></dd></div></dl>
    {done && run.batches.length > 1 && <label className="focus-batch">완료 팔레트<select aria-label={`${title} 완료 팔레트`} value={batch < 0 ? run.batches.length-1 : batch} onChange={e=>setBatch(+e.target.value)}>{run.batches.map(b=><option key={b.index} value={b.index}>{b.index+1}번 · {b.boxes.length}박스</option>)}</select></label>}
  </article>;
}

function RobotDemo({data}: {data: FocusData}) {
  const [runs, setRuns] = useState<OrderRun[]>([]), [error,setError] = useState('');
  const [demo,setDemo] = useState('compare'), [left,setLeft] = useState(data.order.selection.worst.id);
  const [time,setTime] = useState(0), [playing,setPlaying] = useState(false), [speed,setSpeed] = useState(16);
  useEffect(()=>{const c=new AbortController(); fetch(asset('presentation-example.json'),{signal:c.signal}).then(r=>{if(!r.ok)throw Error('시연 기록을 불러오지 못했습니다.'); return r.json();}).then(d=>setRuns(d.replays)).catch(e=>{if(e.name!=='AbortError')setError(e.message);}); return()=>c.abort();},[]);
  const baseline = runs.find(r=>r.policy.id===data.order.selection.baseline.id), alps = runs.find(r=>r.policy.id===data.order.selection.alps.id), contender = runs.find(r=>r.policy.id===left);
  const shown = (demo==='before' ? [baseline] : demo==='after' ? [alps] : [contender,alps]).filter((r):r is OrderRun=>!!r);
  const maximum=Math.max(1,...shown.map(r=>r.packingSeconds));
  useEffect(()=>{if(!playing)return; let id=0, previous=performance.now(); const tick=(now:number)=>{const dt=Math.min(.15,(now-previous)/1000);previous=now;setTime(t=>{if(t+dt*speed>=maximum){setPlaying(false);return maximum;}return t+dt*speed;});id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[playing,speed,maximum]);
  const reset=()=>{setPlaying(false);setTime(0);};
  return <><div className="focus-section-heading"><div><h1>로봇이 옮기는 동안,<br/>다음 배치를 계산합니다.</h1><p>동일한 랜덤 주문 24박스의 저장된 배치를 재생합니다. 계산과 운반을 병행하는 8초 사이클 모델입니다.</p></div><span className="focus-condition">높이 1,200 mm · 시드 {data.order.replaySeed}</span></div>
    <div className="focus-demo-tabs" aria-label="로봇 시연 선택">{[['before','ALPS 적용 전'],['after','ALPS 적용 후'],['compare','알고리즘 비교']].map(([id,label])=><button key={id} aria-pressed={demo===id} onClick={()=>{setDemo(id);reset();}}>{label}</button>)}{demo==='compare' && <select aria-label="비교 알고리즘" value={left} onChange={e=>{setLeft(e.target.value);reset();}}>{runs.map(r=><option key={r.id} value={r.policy.id}>{policyName(r.policy)}</option>)}</select>}</div>
    {!runs.length ? <p role="status">{error || '로봇 시연 기록을 불러오는 중…'}</p> : <><div className={`focus-robot-grid ${shown.length===1?'single':''}`}>{shown.map((r,i)=><RobotStage key={r.id} run={r} time={time} title={r.policy.id===alps?.policy.id ? 'ALPS · 사전 선택' : i===0 ? '비교 기준' : '비교 후보'}/>)}</div><div className="focus-playback"><button className="focus-primary" onClick={()=>{if(time>=maximum)setTime(0);setPlaying(v=>!v);}}>{playing?'일시정지':'적재 재생'}</button><button onClick={reset}>처음</button><input aria-label="적재 시연 시간" type="range" min="0" max={maximum} step=".1" value={time} onChange={e=>{setPlaying(false);setTime(+e.target.value);}}/><b>{seconds(time)}</b><select aria-label="재생 배속" value={speed} onChange={e=>setSpeed(+e.target.value)}>{[1,8,16,32,64].map(v=><option key={v} value={v}>{v}배속</option>)}</select><button onClick={()=>{setPlaying(false);setTime(maximum);}}>결과</button></div></>}
    <p className="focus-footnote">기본 비교는 선택용 5개 입고 순서에서 예상 전체 작업시간이 가장 길었던 Greedy와 사전 선택된 Compact+구역 선호입니다. 전체 주문 24박스 실험으로, 72박스 단일 팔레트 적재율 실험과 물량·운영 방식이 다릅니다.</p>
    <div className="focus-equation"><b>8초 × 적재 수 + 팔레트 교체 + 초기 계산·노출 대기</b><p>8초 안에 끝난 다음 박스 계산을 매번 작업시간에 더하지 않습니다. 인식 추가 지연은 0으로 가정하며 실제 로봇의 제어·복귀 지연은 실측 보정이 필요합니다.</p></div>
  </>;
}

function Benchmark({data}: {data: FocusData}) {
  const c=data.capacity, selected=c.holdout.find(r=>r.algorithm===c.selected)!;
  const hybridPair=c.paired.find(r=>r.before==='future-hybrid')!.fillPercentagePointDifference;
  return <><div className="focus-section-heading"><div><h1>적재율과 다음 8초.</h1><p>로봇팔 한 대가 정해진 높이 안에 얼마나 담는지,<br/>다음 동작 전에 계산을 마치는지 함께 비교합니다.</p></div><a className="focus-text-link" href={asset('presentation-charts/07-single-pallet-eight-second-capacity.png')} target="_blank" rel="noreferrer">발표용 그래프 보기 ↗</a></div>
    <div className="focus-conditions"><span><b>1,200 mm</b> 최고 높이</span><span><b>72박스 / 6품목</b> 입력 물량</span><span><b>8,000 ms</b> 계획 호출 한도</span><span><b>3회 선택 + 5회 평가</b> 입고 순서 분리</span></div>
    <div className="focus-benchmark-grid"><section className="focus-fill"><header><h2>한 팔레트의 부피 적재율</h2><span>별도 평가 5회 평균</span></header><div className="focus-bar-axis"><span>0%</span><span>50%</span><span>100%</span></div>{c.holdout.map(r=><div className="focus-fill-row" key={r.algorithm}><div><b>{names[r.algorithm]}</b>{r.algorithm===c.selected&&<span>사전 선택</span>}<small>평균 {f(r.count.mean)}박스</small></div><div className="focus-fill-track"><i style={{width:`${100*r.utilization.mean}%`}} data-selected={r.algorithm===c.selected}/><b>{f(100*r.utilization.mean,2)}<small>%</small></b></div></div>)}<p>적재한 박스 부피 ÷ (1,200 × 1,000 × 1,200 mm). 후보 생성·그리퍼 접근·지지·하중 조건을 공통 적용했습니다.</p></section>
    <aside className="focus-timing"><h2>8초 안에 계산됐을까?</h2><p>40회 실험의 가장 오래 걸린<br/>단일 계획 호출은 <strong>{f(c.maxMs/1000,3)}초</strong>였습니다.</p><div className="focus-cycle" aria-label={`8초 중 관측 최대 계산 ${f(c.maxMs/1000,3)}초`}><i style={{width:`${c.maxMs/8000*100}%`}}/></div><div className="focus-cycle-label"><b>관측 최대 계산</b><span>로봇 8초</span></div><dl><div><dt>실험 완료</dt><dd>{c.completed}/40</dd></div><div><dt>배치 제약 위반</dt><dd>{c.violations}건</dd></div></dl><p className="focus-footnote">센싱·통신·후속 검사는 제외한 호출 시간입니다. 보류 박스의 연속 재계산까지 포함한 전체 8초 제어 주기를 보장하는 값은 아닙니다.</p></aside></div>
    <section className="focus-speed"><h2>알고리즘별 계산 속도</h2><div className="focus-table-wrap"><table><thead><tr><th>알고리즘</th><th>평균 호출</th><th>관측 최대 호출</th><th>평가 완료</th></tr></thead><tbody>{c.holdout.map(r=><tr key={r.algorithm}><th>{names[r.algorithm]}</th><td>{f(r.ms.mean,2)} ms</td><td>{f(Math.max(...c.rows.filter(x=>x.split==='holdout'&&x.algorithm===r.algorithm).map(x=>x.maxMs)),2)} ms</td><td>{r.n}/5</td></tr>)}</tbody></table></div></section>
    <div className="focus-conclusion"><h3>현재 기반 후보는 Compact, Hybrid도 비교 대상입니다.</h3><p>선택용 입고 순서에서 고른 Compact는 별도 평가에서도 평균 {f(selected.utilization.mean*100,2)}%를 기록했습니다. Hybrid와의 차이는 +{f(hybridPair.mean,2)}%p지만 95% 신뢰구간은 {hybridPair.ci95?.map(v=>f(v,2)).join(' ~ ')}%p입니다. 이 표본만으로 일반적인 우월성이나 최대 적재율의 최적해를 확정하지 않습니다.</p></div>
    <details className="focus-details"><summary>비교 조건과 검증 범위</summary><p>Apple M5 · Node 24.14.1 · 같은 6품목의 무작위 순서. 선택 시드 410~412, 별도 평가 2410~2414. 보류 버퍼 2개, 지지율 85%, 계획 호출당 8초·실험당 120초. 실행 한도는 동기 호출 반환 후 검사합니다. 합성 상자 강도와 그리퍼 경로 근사를 사용하며 실제 흡착·관절 충돌·운송 진동은 검증하지 않았습니다.</p><p>매장 작업시간은 별도의 전체 주문 실험에서 추정합니다. 한 팔레트의 적재 박스 수가 다른 이 실험에서 총 작업시간을 직접 비교하지 않습니다.</p></details>
  </>;
}

function StoreEfficiency({data}: {data: FocusData}) {
  const o=data.order, report=o.report, max=Math.max(...o.policies.map(p=>p.total));
  return <><div className="focus-section-heading"><div><h1>쌓는 방법이,<br/>매대까지의 일을 바꿉니다.</h1><p>적재 방식에 따른 재취급과 이동을 비교하고,<br/>매장 진열 효율은 가정이 명시된 예상 지표로 설명합니다.</p></div><span className="focus-condition">24박스 전체 주문 · 별도 평가 20회</span></div>
    <div className="focus-store-flow"><div><b>구역별 적재</b><p>같은 부서의 상품에 접근하기 쉬운 배치</p></div><span>→</span><div><b>인출·재분배</b><p>방해 상자 재취급과 이동거리의 변화</p></div><span>→</span><div><b>매대 진열</b><p>공통 진열 작업에 추가되는 준비시간 비교</p></div></div>
    <section className="focus-store-times"><header><h2>같은 주문을 끝내는 예상 작업시간</h2><div className="focus-legend"><span><i className="packing"/>적재·교체</span><span><i className="redistribution"/>이동·분류·인출</span><span><i className="shelf"/>공통 진열 600초</span></div></header>{o.policies.map(p=><div className="focus-time-row" key={p.policy.id}><span>{policyName(p.policy)}</span><div className="focus-time-track"><i className="packing" style={{width:`${p.packing/max*100}%`}}/><i className="redistribution" style={{width:`${p.redistribution/max*100}%`}}/><i className="shelf" style={{width:`${p.shelf/max*100}%`}}/></div><b>{f(p.total,1)}<small>초</small></b></div>)}</section>
    <div className="focus-table-wrap"><table><thead><tr><th>적재 정책</th><th>평균 팔레트</th><th>방해 상자 재취급</th><th>예상 이동거리</th><th>예상 매장 작업</th></tr></thead><tbody>{o.policies.map(p=><tr key={p.policy.id}><th>{policyName(p.policy)}</th><td>{f(p.pallets,2)}개</td><td>{f(p.rehandles)}개</td><td>{f(p.walked)} m</td><td>{f(p.store)}초</td></tr>)}</tbody></table></div>
    <div className="focus-conclusion"><h3>진열 효율은 적재율과 함께 판단해야 합니다.</h3><p>구역별 배치가 재취급을 줄여도 팔레트 수가 늘면 이동·교체가 증가할 수 있습니다. 기준 Greedy 대비 사전 선택 ALPS의 예상 전체시간 차이는 평균 {f(report.saved.mean)}초 감소, 95% 신뢰구간 {report.saved.ci95?.map(v=>f(v)).join(' ~ ')}초입니다. 개선 {report.wins}회·악화 {report.losses}회로, 실제 매장 작업시간 단축이 입증된 수치는 아닙니다.</p></div>
    <details className="focus-details"><summary>매장 시간의 가정 보기</summary><p>양쪽 모두 입고장 분류 후 카트 이동 / 팔레트 직접 순회와 6개 구역 방문 순서 중 가능한 빠른 방법을 선택합니다. 이동 {o.storeConfig.walkSpeed} m/s, 층간 {o.storeConfig.elevatorSeconds}초, 카트 {o.storeConfig.cartBoxes}박스/{o.storeConfig.cartKg}kg, 인출 {o.storeConfig.takeSeconds}초, 분류 {o.storeConfig.sortSeconds}초를 가정합니다. 개봉·낱개 진열·포장재 정리 600초는 양쪽 공통입니다. 통로 혼잡·피로·실제 승강기 대기는 포함하지 않습니다.</p><p>24박스 전체 부피는 한 팔레트 허용 용적의 43.08%입니다. 따라서 이 실험의 적재율을 72박스 용량 실험과 직접 비교하지 않습니다.</p></details>
  </>;
}

function Downloads() {
  return <><div className="focus-section-heading"><div><h1>발표에 바로 쓰는 자료.</h1><p>현재 비교에 필요한 그래프 두 장과 계산 원본을 모았습니다.<br/>수치는 내부 실험 결과와 가정에 따른 예상값으로 구분했습니다.</p></div><a className="focus-primary" href={asset('presentation-charts/ALPS-current-presentation.zip')} download>현재 발표 자료 전체 받기</a></div>
    <div className="focus-download-grid">{[['07-single-pallet-eight-second-capacity','한 팔레트 적재율과 8초 판단','72박스 · 단일 팔레트 · 알고리즘당 평가 5회'],['06-pipeline-eight-second','로봇 병렬 계산과 예상 매장 효율','24박스 전체 주문 · 정책당 평가 20회']].map(([file,title,desc])=><article key={file}><a href={asset(`presentation-charts/${file}.png`)} target="_blank" rel="noreferrer"><img src={asset(`presentation-charts/${file}-preview.png`)} alt={title}/></a><div><h2>{title}</h2><p>{desc}</p><a href={asset(`presentation-charts/${file}.png`)} download>4K PNG</a><a href={asset(`presentation-charts/${file}.svg`)} download>벡터 SVG</a></div></article>)}</div>
    <div className="focus-data-download"><div><h2>Opus 5.5 실행 결과</h2><p>Opus 5.5가 계산 도구를 호출한 6개 케이스의 JSON과 원본 실행 기록입니다. 계산 결과와 모델의 해석을 함께 확인할 수 있습니다.</p></div><div><a href={asset('claude-simulation-report.json')} download>검토 JSON</a><a href={asset('claude-simulation-results.zip')} download>전체 실행 원본 ZIP</a><a href={asset('alps-current.json')} download>화면 집계 JSON</a></div></div>
    <div className="focus-claims"><div><h3>발표에서 설명할 수 있는 내용</h3><p>동일 조건에서의 적재율·계산시간 비교, 운반과 계산의 병행 방식, 적재 순서에 따른 재취급·예상 매장 효율의 관계.</p></div><div><h3>현재 측정하지 않은 내용</h3><p>실제 매장 시간 단축, 운송 진동 내구성, 로봇 전체 관절 충돌 및 실시간 제어 보장. 현대 HRPal은 공식 프로그램을 실행할 수 없어 수치 비교에서 제외했습니다.</p></div></div>
  </>;
}

export default function FocusedAlps() {
  const [section,setSection]=useState<Section>('benchmark'), [data,setData]=useState<FocusData|null>(null), [error,setError]=useState('');
  useEffect(()=>{document.title='ALPS | 적재율과 다음 8초';const c=new AbortController();fetch(asset('alps-current.json'),{signal:c.signal}).then(r=>{if(!r.ok)throw Error('실험 결과를 불러오지 못했습니다.');return r.json();}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[]);
  return <div className="focus-alps"><header className="focus-header"><a href="/alps" aria-label="ALPS 처음"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 12 16 5l13 7v14H3Z M3 12l13 7 13-7 M16 19v7 M3 28h26"/></svg><b>ALPS</b><span>한 대의 로봇, 다음 적재</span></a><nav aria-label="ALPS 주요 화면">{([['benchmark','적재율·계산'],['robot','로봇 시연'],['store','매장 진열 효율'],['downloads','발표 자료']] as const).map(([id,label])=><button key={id} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);window.scrollTo(0,0);}}>{label}</button>)}</nav></header>
    <main>{!data ? <p role="status">{error||'검증 기록을 불러오는 중…'}</p> : section==='benchmark' ? <Benchmark data={data}/> : section==='robot' ? <RobotDemo data={data}/> : section==='store' ? <StoreEfficiency data={data}/> : <Downloads/>}</main>
    <footer className="focus-footer"><span>ALPS · 단일 로봇 적재 연구</span><span>2026.10.10 · 내부 시뮬레이션 / 매장 시간은 가정 기반 추정</span></footer>
  </div>;
}
