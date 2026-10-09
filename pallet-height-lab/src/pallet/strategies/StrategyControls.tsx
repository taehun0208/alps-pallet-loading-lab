import { DEFAULT_STRATEGY,type StrategyConfig } from './PackingStrategy';
import type { StrategyDebug } from './PackingStrategy';
const labels:Record<string,string>={compactness:'공간 효율',support:'지지',stability:'하중·아랫단 안정',centerOfMass:'무게중심',flatness:'평탄도',height:'높이 비용',fragmentation:'공간 분할 비용',macs:'MACS',fpl:'FPL',deadEnd:'미래 후보 소멸',reservation:'예약 침범',lowerSpace:'하단 공간 보존',lookahead:'Lookahead'};
export function StrategyControls({config=DEFAULT_STRATEGY,onChange}:{config?:StrategyConfig;onChange:(c:StrategyConfig)=>void}){
  const c={...DEFAULT_STRATEGY,...config,weights:{...DEFAULT_STRATEGY.weights,...config.weights},criticalWeights:{...DEFAULT_STRATEGY.criticalWeights,...config.criticalWeights}};
  const number=(key:'criticalK'|'futureCandidates'|'lookaheadDepth'|'lookaheadSamples'|'lookaheadCandidates'|'approachHeight'|'approachMargin',label:string,min:number,max:number)=><label className="pallet-field" key={key}><span>{label}</span><input type="number" aria-label={label} min={min} max={max} value={c[key]} onChange={e=>onChange({...c,[key]:Number(e.target.value)})}/></label>;
  return <details><summary>미래 공간 전략 설정</summary><p className="pallet-note">아래 변경은 ‘설정 적용’ 후 새 실행에 사용됩니다. 후보 수는 제한된 표본입니다.</p>
    {number('criticalK','Critical Top-K',1,8)}{number('futureCandidates','미래 종류별 후보 상한',4,64)}
    <label>FPL 계산<select aria-label="FPL 계산" value={c.lossMode} onChange={e=>onChange({...c,lossMode:e.target.value as StrategyConfig['lossMode']})}><option value="normalized">비율 손실 · normalized</option><option value="absolute">개수 손실 · absolute</option></select></label>
    <label>가상 순서 평가<select aria-label="가상 순서 평가" value={c.lookaheadMode} onChange={e=>onChange({...c,lookaheadMode:e.target.value as StrategyConfig['lookaheadMode']})}><option value="expected">표본 평균 · Expected</option><option value="worst">어려운 박스 먼저 / 나중 · Worst-case</option></select></label>
    {number('lookaheadDepth','Lookahead 깊이',1,6)}{number('lookaheadSamples','Lookahead 표본 순서',1,20)}{number('lookaheadCandidates','Lookahead 현재 후보 수',1,16)}
    <label><input type="checkbox" checked={c.approach} onChange={e=>onChange({...c,approach:e.target.checked})}/> 수직 접근 여유 검사</label>
    {c.approach&&<>{number('approachHeight','접근 높이 mm',0,3000)}{number('approachMargin','접근 측면 여유 mm',0,300)}</>}
    <details><summary>점수 가중치</summary>{Object.entries(c.weights).map(([key,value])=><label className="pallet-field" key={key}><span>{labels[key]}</span><input aria-label={`전략 가중치 ${key}`} type="number" min={0} max={10000} step={.05} value={value} onChange={e=>onChange({...c,weights:{...c.weights,[key]:Number(e.target.value)}})}/></label>)}</details>
    <details><summary>Criticality 가중치</summary>{Object.entries(c.criticalWeights).map(([key,value])=><label className="pallet-field" key={key}><span>{key}</span><input aria-label={`Criticality ${key}`} type="number" min={0} step={.1} value={value} onChange={e=>onChange({...c,criticalWeights:{...c.criticalWeights,[key]:Number(e.target.value)}})}/></label>)}</details>
  </details>;
}
export function StrategyDebugPanel({debug}:{debug?:StrategyDebug}){if(!debug)return null;return <section className="pallet-public" aria-label="미래 공간 판단"><b>미래 공간 판단 · 점수 {debug.selectedScore.toFixed(3)}</b><p>FPL {debug.futurePlacementLoss.toFixed(3)} · 후보 소멸 {debug.deadEnds}종 · 보호 위치 {debug.reservedSlots.length}</p>
  {debug.criticalBoxes.map(c=><p key={c.typeId}><b>Critical {c.typeId}</b> · {c.weightCritical?'무게 ':''}{c.shapeCritical?'형상 ':''}· 난도 {c.criticality.toFixed(3)}<br/>가능 위치 {c.feasibleBefore} → {c.feasibleAfter} · 최하단 {c.lowerBefore} → {c.lowerAfter}</p>)}
  <small>동시 적재 수가 아닌, 개별 배치 가능 위치 표본입니다. 겹치는 예약 후보도 있습니다.</small>
  <details><summary>점수 성분</summary>{Object.entries(debug.scoreComponents).map(([k,v])=><p key={k}>{labels[k]||k}: {v.toFixed(4)}</p>)}</details>
  {debug.sequences.length>0&&<details><summary>재고로 만든 가상 순서</summary>{debug.sequences.map((s,i)=><p key={i}>{s.join(' → ')}</p>)}</details>}
  </section>;}
