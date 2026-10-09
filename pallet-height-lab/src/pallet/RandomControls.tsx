import { isStanding,standingPermissions } from './orientations';
import { useState,useEffect } from 'react';
import { randomScenario,DEFAULT_RANDOM } from './random';
import { DEFAULT_DIMENSIONS } from './inventoryGeneration';
import type { RandomSetSettings } from './random';
import type { Scenario } from './types';
const seed=()=>crypto.getRandomValues(new Uint32Array(1))[0]&0x7fffffff;
function optionsFor(s:Scenario):RandomSetSettings {
 const g=s.generation;
 return {...DEFAULT_RANDOM,model:'heterogeneous',seed:g?.seed??DEFAULT_RANDOM.seed,typeCount:g?.model==='heterogeneous'?g.typeCount:DEFAULT_RANDOM.typeCount,totalCount:g?.totalCount??DEFAULT_RANDOM.totalCount,assortment:g?.model==='heterogeneous'?g.assortment:'individual',dimensions:structuredClone(g?.model==='heterogeneous'?g.dimensions!:DEFAULT_DIMENSIONS),arrivalSeed:s.arrival.seed,arrivalPattern:s.arrival.pattern==='random-draw'?'random-draw':'shuffle'};
}
export function RandomControls({scenario:s,pending,onApply}:{scenario:Scenario;pending:boolean;onApply:(s:Scenario)=>void}){
 const [options,setOptions]=useState<RandomSetSettings>(()=>optionsFor(s)),[status,setStatus]=useState<{state:'error'|'success';text:string}|null>(null);
 useEffect(()=>{setOptions(optionsFor(s));if(!s.generation)setStatus(null);},[s.generation,s.arrival.seed,s.arrival.pattern]);
 const generate=(random:boolean,both=false)=>{try{
  const o={...options,model:'heterogeneous' as const,seed:random?seed():options.seed,arrivalSeed:both?seed():options.arrivalSeed,arrivalPattern:both?'random-draw' as const:options.arrivalPattern},next=randomScenario(o);
  // Randomize stock and arrivals, retaining the user's pallet and safety conditions.
  if(s.types.some(t=>t.orientations.some(isStanding)))next.types.forEach(t=>{if(t.handling!=='upright')t.orientations=standingPermissions(t.orientations);});
  next.pallet=structuredClone(s.pallet);next.constraints=structuredClone(s.constraints);next.events=[];next.supplyMode=s.supplyMode;
  setOptions(o);onApply(next);setStatus({state:'success',text:`세트 시드 ${o.seed} · 입고 시드 ${o.arrivalSeed} · ${o.assortment==='repeated'?`${o.typeCount}종 / ${o.totalCount}개`:`서로 다른 ${o.totalCount}개`}로 새 실행${s.supplyMode==='stock-select'?' · 재고 선택으로 순서 계산':o.arrivalPattern==='random-draw'?' · 매 단계 무작위 추첨':''}`});
 }catch(e){setStatus({state:'error',text:(e as Error).message});}};
 const shuffle=()=>{const next=structuredClone(s);next.arrival={seed:seed(),pattern:options.arrivalPattern??'shuffle'};onApply(next);setStatus({state:'success',text:`박스 구성 유지 · 새 입고 시드 ${next.arrival.seed}${next.arrival.pattern==='random-draw'?' · 매 단계 무작위 추첨':''}`});};
 return <details className="pallet-random-controls" data-state={pending?'loading':status?.state||'default'} aria-busy={pending}><summary>랜덤 박스 세트 · 순서</summary>
 <p className="pallet-note">기본은 박스마다 치수·무게·재질·허용 하중이 다른 합성 입력입니다. 치수는 1 mm 단위로 독립 추첨하며 팔레트에 맞도록 보정하지 않습니다.</p>
 <label className="pallet-random-mode">박스 구성<select aria-label="랜덤 박스 구성" value={options.assortment??'individual'} onChange={e=>{setOptions(o=>({...o,assortment:e.target.value as 'individual'|'repeated'}));setStatus(null);}}><option value="individual">개별 박스 · 각각 다른 치수</option><option value="repeated">여러 규격 · 수량 반복</option></select></label>
 <label className="pallet-random-mode">입고 방식 · 도착 순서 모드<select aria-label="입고 추첨 방식" value={options.arrivalPattern??'random-draw'} onChange={e=>{setOptions(o=>({...o,arrivalPattern:e.target.value as 'shuffle'|'random-draw'}));setStatus(null);}}><option value="shuffle">고정 재고 · 순서 섞기</option><option value="random-draw">남은 재고에서 매 단계 추첨</option></select></label>
 {([['seed','세트 생성 시드',0,2147483647],['arrivalSeed','무작위 입고 시드',0,2147483647],...(options.assortment==='repeated'?[['typeCount','랜덤 종류 수',1,120] as const]:[]),['totalCount','랜덤 전체 수량',1,120]] as const).map(([key,label,min,max])=><label className="pallet-field" key={key}><span>{label}</span><input type="number" aria-label={label} value={options[key]} min={min} max={max} step={1} onChange={e=>{setOptions(o=>({...o,[key]:Number(e.target.value)}));setStatus(null);}}/></label>)}
 <fieldset className="pallet-size-ranges"><legend>치수 범위 mm · 최소 / 최대</legend>{(['w','d','h'] as const).map((axis,i)=><div key={axis}><span>{['가로','깊이','높이'][i]}</span>{(['min','max'] as const).map(bound=><input key={bound} aria-label={`랜덤 ${['가로','깊이','높이'][i]} ${bound==='min'?'최소':'최대'} mm`} type="number" min={50} max={2000} step={1} value={options.dimensions![axis][bound]} onChange={e=>{const value=Number(e.target.value);setOptions(o=>({...o,dimensions:{...o.dimensions!,[axis]:{...o.dimensions![axis],[bound]:value}}}));setStatus(null);}}/>)}</div>)}</fieldset>
 <div className="pallet-random-actions"><button className="pallet-primary" onClick={()=>generate(true,true)}>{s.supplyMode==='stock-select'?'새 재고 무작위 생성':'재고·입고 모두 랜덤'}</button><button onClick={()=>generate(false)}>이 시드로 세트 생성</button><button onClick={()=>generate(true)}>랜덤 세트 생성</button><button onClick={shuffle} disabled={s.supplyMode==='stock-select'} title={s.supplyMode==='stock-select'?'입고 순서는 도착 순서 모드에서 무작위로 바꿀 수 있습니다.':undefined}>입고 순서만 랜덤</button></div>
 {pending&&<small>배치 계산 중에도 새 입력으로 전환할 수 있습니다.</small>}{status&&<p role={status.state==='error'?'alert':'status'} className="pallet-note">{status.text}</p>}
 <p className="pallet-note">강도·마찰·무게도 생성 예제값이며 실측 자료가 아닙니다. 같은 재질도 강도가 다르고 플라스틱이 항상 더 강하지 않습니다. 제조사나 시험 데이터를 박스별로 편집할 수 있습니다. 박스 내부 질량은 균일하게 분포한다고 가정합니다.</p>
 <p className="pallet-note">{s.supplyMode==='stock-select'?'현재는 전체 재고에서 받침에 적합한 박스를 먼저 선택합니다. 입고 방식과 입고 시드는 도착 순서 모드에만 적용합니다. ':''}세트·입고 시드는 독립입니다. 재고·입고 모두 랜덤은 남은 개수에 비례해 다음 박스를 추첨합니다. 생성 시 팔레트와 적용된 제약을 유지하며, 적재 불가능한 입력도 중단 결과로 표시합니다.</p>
 {s.generation&&s.generation.model!=='heterogeneous'&&<p className="pallet-note">현재 입력은 이전 격자형 예제입니다. 새로 생성하면 개별 치수 모델을 적용합니다.</p>}
 </details>;
}
