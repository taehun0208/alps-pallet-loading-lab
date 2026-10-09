import {lazy,Suspense,useEffect,useMemo,useState} from 'react';
import {ALGORITHMS} from './engine/config';
import type {AlgorithmId,TrialResult} from './engine/types';
import {planRedistribution} from './redistribution';
import type {VisualBox} from './Scene';

const Scene=lazy(()=>import('./Scene'));
const names=Object.fromEntries(ALGORITHMS.map(a=>[a.id,a.name]));
const number=(x:number|null,n=1)=>x==null||!Number.isFinite(x)?'—':x.toLocaleString('ko-KR',{minimumFractionDigits:n,maximumFractionDigits:n});
type Row=Pick<TrialResult,'id'|'algorithm'|'seed'|'config'|'status'|'metrics'|'violations'|'inputFingerprint'>&{traceUrl?:string;split?:'discovery'|'holdout'};
type Demo='before'|'after'|'extremes';
type Plan=ReturnType<typeof planRedistribution>;
const valid=(r:Row)=>r.status==='finished'&&!r.violations.length&&!r.metrics.deadlineMisses;
const DESTINATIONS=['식품','생활','뷰티'];
function ranked(rows:Row[]){return ALGORITHMS.map(a=>{const rr=rows.filter(r=>r.algorithm===a.id);return {id:a.id,fill:rr.reduce((n,r)=>n+r.metrics.fill,0)/Math.max(1,rr.length),offset:rr.reduce((n,r)=>n+r.metrics.cogHorizontalOffsetMm,0)/Math.max(1,rr.length),n:rr.length,pass:rr.length>0&&rr.every(valid)};}).filter(x=>x.pass).sort((a,b)=>b.fill-a.fill||a.offset-b.offset);}

function DemoStage({row,plan,elapsed,onlyRedistribution,title}:{row:TrialResult;plan:Plan;elapsed:number;onlyRedistribution:boolean;title:string}){
  const loading=!onlyRedistribution&&elapsed<row.metrics.totalSeconds;
  const redistributionTime=Math.max(0,elapsed-(onlyRedistribution?0:row.metrics.totalSeconds));
  const move=loading?row.decisions.find(d=>d.accepted&&d.timing.robotStart!==null&&elapsed>=d.timing.robotStart&&elapsed<d.timing.robotEnd!):undefined;
  const placed=loading?row.decisions.filter(d=>d.accepted&&d.timing.robotEnd!==null&&d.timing.robotEnd<=elapsed).length:row.placements.length;
  const completed=loading?0:plan.steps.filter(s=>s.end<=redistributionTime).length;
  const step=loading?undefined:plan.steps.find(s=>redistributionTime>=s.start&&redistributionTime<s.end);
  const boxes=useMemo(()=>{if(loading)return row.placements.slice(0,placed) as VisualBox[];const removed=new Set(plan.steps.slice(0,completed+(step?1:0)).filter(s=>s.stage!=='buffer-to-destination').map(s=>s.boxId));return row.placements.filter(p=>!removed.has(p.id)) as VisualBox[];},[row,plan,loading,placed,completed,step?.index]);
  const done=plan.steps.slice(0,completed),delivered=done.filter(s=>s.stage!=='pallet-to-buffer');
  const buffer=done.filter(s=>s.stage==='pallet-to-buffer').length-done.filter(s=>s.stage==='buffer-to-destination').length-(step?.stage==='buffer-to-destination'?1:0);
  const moving=loading?move?.placement:step?.box;
  const progress=loading&&move?(elapsed-move.timing.robotStart!)/(move.timing.robotEnd!-move.timing.robotStart!):step?(redistributionTime-step.start)/step.seconds:0;
  const from=step?(step.stage==='buffer-to-destination'?{x:-650,y:350,z:120}:step.box.position):undefined;
  const to=step?(step.stage==='pallet-to-buffer'?{x:-650,y:350,z:120}:{x:step.zone*450,y:1500,z:0}):undefined;
  const finished=!loading&&completed===plan.steps.length;
  return <article className="demo-stage"><header><div><span>{title}</span><h2>{names[row.algorithm]}</h2></div><b>{number(row.metrics.fill*100,2)}<small>% 적재율</small></b></header>
    <div className="stage-status"><b>{loading?'랜덤 입고 · 적재':finished?'재분배 완료':'구역별 재분배'}</b><span>{loading?`${placed}/${row.metrics.count}개 적재`:step?(step.stage==='pallet-to-buffer'?`${step.box.typeId} → 임시 보류`: `${step.box.typeId} → ${DESTINATIONS[step.zone]}`):`${delivered.length}/${plan.metrics.targetBoxes}개 인출`}</span></div>
    <Suspense fallback={<div className="scene-loading">작업셀을 불러오는 중…</div>}><Scene width={row.scenario.pallet.width} depth={row.scenario.pallet.depth} height={row.config.maxHeightMm} boxes={boxes} moving={moving??null} progress={progress} motionFrom={from} motionTo={to} showCenter robot={!finished}/></Suspense>
    <div className="destination-counts">{DESTINATIONS.map((name,z)=><div key={name}><span>{name}</span><b>{delivered.filter(s=>s.zone===z).length}<small>개 인출</small></b></div>)}<div className="buffer-count"><span>임시 보류</span><b>{buffer}<small>개</small></b></div></div>
    <div className="demo-metrics"><span>재분배 대상<b>{plan.metrics.targetBoxes}개</b><small>미적재 {row.unplaced.length}개 별도</small></span><span>추가 취급<b>{plan.metrics.extraHandles}회</b><small>총 {plan.metrics.totalMoves}회 이동</small></span><span>재분배 모델 시간<b>{number(plan.metrics.totalSeconds,0)}초</b><small>100개당 {number(plan.metrics.secondsPer100Boxes,0)}초</small></span><span>바닥 사용률<b>{number(row.placements.filter(p=>p.position.z===0).reduce((n,p)=>n+p.size.w*p.size.d,0)/(row.scenario.pallet.width*row.scenario.pallet.depth)*100)}%</b><small>바닥 직접 접촉 면적</small></span><span>적재 내부 빈틈<b>{number(row.metrics.columnVoidMm3/1e6)} L</b><small>각 기둥의 최상단 아래</small></span></div>
  </article>;
}

export default function Showcases({rows,selectionRows,complete}:{rows:Row[];selectionRows:Row[];complete:boolean}){
  const [demo,setDemo]=useState<Demo>('before'),[seed,setSeed]=useState<number|null>(null),[traces,setTraces]=useState<TrialResult[]>([]),[error,setError]=useState(''),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(32),[redistributeOnly,setRedistributeOnly]=useState(false);
  const ranking=useMemo(()=>ranked(selectionRows.length?selectionRows:rows),[selectionRows,rows]);
  const best=ranking[0]?.id,worst=ranking.at(-1)?.id;
  const leftId:AlgorithmId=demo==='extremes'?(worst??'blb'):'blb',rightId=best;
  const ids=demo==='before'?[leftId]:demo==='after'?(rightId?[rightId]:[]):rightId?[leftId,rightId]:[leftId];
  const seeds=[...new Set(rows.filter(valid).map(r=>r.seed))].sort((a,b)=>a-b).filter(s=>ids.every(id=>rows.some(r=>r.algorithm===id&&r.seed===s&&valid(r))));
  const selectedSeed=seed!==null&&seeds.includes(seed)?seed:seeds[0];
  const selectedRows=ids.map(id=>rows.find(r=>r.algorithm===id&&r.seed===selectedSeed&&valid(r))).filter((r):r is Row=>!!r);
  const noData=selectedRows.length!==ids.length||!selectedRows.length||(demo==='extremes'&&leftId===rightId);
  const signature=selectedRows.map(r=>r.id+':'+r.inputFingerprint).join('|');
  const tracesMatch=traces.length>0&&traces.map(r=>r.id+':'+r.inputFingerprint).join('|')===signature;
  useEffect(()=>{setTime(0);setPlaying(false);setTraces([]);setError('');if(noData)return;let keep=true;Promise.all(selectedRows.map(async row=>{if('placements' in row)return row as TrialResult;if(!row.traceUrl)throw Error('이 실행의 배치 기록이 없습니다.');const response=await fetch(row.traceUrl);if(!response.ok)throw Error('배치 기록을 불러오지 못했습니다.');const trace:TrialResult=await response.json();if(trace.id!==row.id||trace.inputFingerprint!==row.inputFingerprint)throw Error('배치 원본이 선택한 실험과 일치하지 않습니다.');return trace;})).then(rr=>{if(rr.length>1&&rr.some(r=>r.inputFingerprint!==rr[0].inputFingerprint))throw Error('서로 다른 입력의 실행은 나란히 비교할 수 없습니다.');if(keep)setTraces(rr);}).catch(e=>{if(keep)setError(e.message);});return()=>{keep=false;};},[signature,demo,noData]);
  const plans=useMemo(()=>traces.map(row=>planRedistribution(row.placements,{cycleSeconds:row.config.cycleSeconds,palletWidthMm:row.scenario.pallet.width,palletDepthMm:row.scenario.pallet.depth,unplacedCount:row.unplaced.length})),[traces]);
  const onlyRedistribution=demo==='before'||redistributeOnly;
  const duration=Math.max(.1,...plans.map((plan,i)=>plan.metrics.totalSeconds+(onlyRedistribution?0:traces[i].metrics.totalSeconds)));
  useEffect(()=>{setTime(0);setPlaying(false);},[onlyRedistribution]);
  useEffect(()=>{if(!playing)return;let raf=0,last=performance.now();const tick=(now:number)=>{if(now-last>=50){const dt=Math.min(.2,(now-last)/1000);last=now;setTime(t=>{const next=Math.min(duration,t+dt*speed);if(next>=duration)setPlaying(false);return next;});}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[playing,duration,speed]);
  const save=()=>{const blob=new Blob([JSON.stringify({schema:'alps-showcase/1',demo,seed:selectedSeed,rankingSource:selectionRows.length?'discovery-11040-11041':'current-run',ranking,rows:traces.map((row,i)=>({id:row.id,inputFingerprint:row.inputFingerprint,config:row.config,packing:row.metrics,redistribution:plans[i]}))},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`ALPS-${demo}-${selectedSeed}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="showcases"><div className="demo-tabs">{([['before','01','적용 전','적재 완료 팔레트 → 재분배'],['after','02','적용 후','랜덤 입고 → 적재 → 재분배'],['extremes','03','상·하위 비교','같은 입력으로 나란히 시연']] as const).map(([id,num,title,description])=><button key={id} aria-pressed={demo===id} onClick={()=>{setDemo(id);setRedistributeOnly(false);}}><span>{num}</span><b>{title}</b><small>{description}</small></button>)}</div>
    <div className="demo-toolbar"><label>동일 입고 시드<select value={selectedSeed??''} onChange={e=>setSeed(+e.target.value)} aria-label="필수 시연 입고 시드">{seeds.map(s=><option key={s} value={s}>{s}</option>)}</select></label>{demo!=='before'&&<label><input type="checkbox" checked={redistributeOnly} onChange={e=>setRedistributeOnly(e.target.checked)}/>재분배부터 보기</label>}<span>한 번 이동 = 목표 {selectedRows[0]?.config.cycleSeconds??10}초 · 식품 → 생활 → 뷰티</span></div>
    <details className="demo-selection"><summary>알고리즘 선정 기준</summary><p className="demo-method">적용 전은 기본 Bottom-Left-Back입니다. ALPS 후보는 {selectionRows.length?'별도 선정 시드 11040·11041의':'이번 실행의'} 평균 부피 적재율이 높은 순으로 선정하고, 동률이면 중심 편차를 비교합니다. 기본 방식이 최상일 경우에도 그대로 선정합니다. 하위 후보도 같은 기준입니다. 현재 재생은 시드 {selectedSeed??'—'}이며 개별 결과의 순위는 다를 수 있습니다.{!complete&&' 저장 실험이 진행 중이라 선정은 잠정적입니다.'}</p></details>
    {error?<p className="notice">{error}</p>:noData?<div className="empty"><h2>이 시연에 필요한 비교 결과가 없습니다.</h2><p>적용 전은 Bottom-Left-Back, 상·하위 비교는 서로 다른 알고리즘 두 개의 같은 시드 결과가 필요합니다. 저장 실험을 선택하거나 해당 알고리즘을 함께 실행하세요.</p></div>:!tracesMatch?<div className="scene-loading">같은 조건의 배치 결과를 불러오는 중…</div>:<>
    <div className={`demo-stages ${traces.length===2?'two-up':''}`}>{traces.map((row,i)=><DemoStage key={row.id} row={row} plan={plans[i]} elapsed={time} onlyRedistribution={onlyRedistribution} title={demo==='before'?'기존 기본 배치':demo==='after'?'ALPS 선정 후보':i===0?'선정 실험 하위 후보':'ALPS 선정 실험 상위 후보'}/>)}</div>
    <div className="playback"><button className="primary" onClick={()=>{if(time>=duration)setTime(0);setPlaying(p=>!p);}}>{playing?'일시정지':'시연 재생'}</button><button onClick={()=>{setTime(0);setPlaying(false);}}>처음</button><input type="range" aria-label="적용 전후 시연 시간" min="0" max={duration} step=".1" value={time} onChange={e=>{setTime(+e.target.value);setPlaying(false);}}/><b>{number(time,0)}초</b><select aria-label="적용 전후 시연 배속" value={speed} onChange={e=>setSpeed(+e.target.value)}>{[1,8,16,32,64].map(s=><option key={s} value={s}>{s}배속</option>)}</select><button onClick={()=>{setTime(duration);setPlaying(false);}}>완료 보기</button><button onClick={save}>시연 JSON</button></div>
    <div className="reallocation-note"><b>재분배에 시간이 더 드는 이유</b><p>먼저 꺼낼 구역의 상자 위에 다른 구역 상자가 있으면 임시 보류했다가 나중에 목적 구역으로 다시 옮깁니다. 이 추가 이동을 모든 알고리즘에 같은 규칙으로 계산합니다. 적재 수가 다르므로 총시간과 100개당 시간을 함께 봅니다.</p>{traces.length===2&&<p className="comparison-callout">이 시드의 추가 취급: {names[traces[0].algorithm]} {plans[0].metrics.extraHandles}회 / {names[traces[1].algorithm]} {plans[1].metrics.extraHandles}회. {(plans[1].metrics.secondsPer100Boxes??Infinity)<(plans[0].metrics.secondsPer100Boxes??Infinity)?'ALPS 후보의 상자당 재분배 시간이 짧습니다.':'이 조건에서는 ALPS 후보의 상자당 재분배 시간 단축이 확인되지 않았습니다.'}</p>}</div>
    <details className="method"><summary>추가 취급의 원본 이동 기록</summary><div className="table-scroll"><table><thead><tr><th>알고리즘</th><th>순서</th><th>박스</th><th>이동</th><th>완료 시각</th></tr></thead><tbody>{plans.flatMap((plan,i)=>plan.steps.map(step=><tr key={`${i}:${step.index}`}><td>{names[traces[i].algorithm]}</td><td>{step.index+1}</td><td>{step.boxId}</td><td>{step.stage==='pallet-to-buffer'?'팔레트 → 임시 보류':step.stage==='buffer-to-destination'?`임시 보류 → ${DESTINATIONS[step.zone]}`:`팔레트 → ${DESTINATIONS[step.zone]}`}</td><td>{step.end}초</td></tr>))}</tbody></table></div></details>
    </>}
    <p className="fine">적재 좌표는 알고리즘의 실제 계산 결과입니다. 재분배는 상부 접근·구역 순서·추가 취급을 계산한 모델이며, 목적 구역의 실제 재적재·로봇 관절 경로·매장 이동시간을 검증한 결과는 아닙니다. 목적 구역 카드는 인출된 수량을 나타냅니다. 미적재 박스의 이송 시간은 별도입니다.</p>
  </section>;
}
