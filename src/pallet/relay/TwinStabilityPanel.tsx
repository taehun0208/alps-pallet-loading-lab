import type {ComAssessment} from '../comAssessment';
import type {Pallet} from '../types';

export function TwinStabilityPanel({assessments,pallet,focus,onFocus,archived=false}:{
 assessments:ComAssessment[];pallet:Pallet;focus:number|null;onFocus:(id:number)=>void;archived?:boolean;
}){
 // Never combine positions from separate local pallet coordinate systems.
 // A nonempty invalid pallet is surfaced before any scored pallet.
 const invalid=assessments.findIndex(a=>a.status==='invalid');
 const ranked=assessments.map((a,i)=>({a,i})).filter(v=>v.a.score!==null).sort((a,b)=>a.a.score!-b.a.score!);
 const selected=focus??(invalid>=0?invalid:ranked[0]?.i??0),a=assessments[selected];
 const number=(n:number|null,digits=0)=>n===null?'—':n.toFixed(digits);
 const scale=Math.min(164/pallet.width,128/pallet.depth);
 const x=(n:number)=>100+(n-pallet.width/2)*scale,y=(n:number)=>84-(n-pallet.depth/2)*scale;
 const title=archived?'출고 팔레트':a.status==='empty'?'적재 후 평가':focus===null?(invalid>=0?'현재 팔레트 · 데이터 확인':'현재 팔레트 중 최저'):'선택 팔레트';
 return <section className="twin-stability" aria-label="무게중심 안정성 평가">
  <div className="studio-section-label"><h3>안정성 평가</h3><span>CENTER OF MASS</span></div>
  <div className="twin-score-head"><div><span>{title}</span><b>P0{selected+1} · {a.reason}</b></div><strong data-testid="stability-score">{number(a.score)}<small>/100</small></strong></div>
  <div className="twin-cell-scores" aria-label="팔레트별 안정성 점수">{assessments.map((item,i)=><button key={i} aria-label={`P0${i+1} 안정성 상세`} aria-pressed={focus===i} data-state={item.status} onClick={()=>onFocus(i)}><span>P0{i+1}</span><b>{number(item.score)}</b></button>)}</div>
  <div className="twin-com-detail">
   <svg viewBox="0 0 200 168" role="img" aria-label={`P0${selected+1} 바닥 지지 외곽과 무게중심 투영`}>
    <rect className="com-floor" x={x(0)} y={y(pallet.depth)} width={pallet.width*scale} height={pallet.depth*scale}/>
    {[.25,.5,.75].map(t=><g key={t} className="com-grid"><line x1={x(pallet.width*t)} x2={x(pallet.width*t)} y1={y(0)} y2={y(pallet.depth)}/><line x1={x(0)} x2={x(pallet.width)} y1={y(pallet.depth*t)} y2={y(pallet.depth*t)}/></g>)}
    {a.hull.length>2&&<polygon className="com-hull" points={a.hull.map(p=>`${x(p.x)},${y(p.y)}`).join(' ')}/>}
    <path className="com-origin" d="M 94 84 h 12 M 100 78 v 12"/>
    {a.center&&<g className="com-point" data-state={a.status}><line x1="100" y1="84" x2={x(a.center.x)} y2={y(a.center.y)}/><circle cx={x(a.center.x)} cy={y(a.center.y)} r="4"/></g>}
    <text x="18" y="163">TOP / {pallet.width} × {pallet.depth} mm</text>
   </svg>
   <dl><div><dt>경계 여유</dt><dd>{number(a.marginMm)}<small> mm</small></dd></div><div><dt>무게중심 높이</dt><dd>{number(a.center?.z??null)}<small> mm</small></dd></div><div><dt>전도 임계각*</dt><dd>{number(a.tippingDeg,1)}<small> °</small></dd></div><div><dt>총 질량</dt><dd>{a.center?number(a.mass,1):'—'}<small> kg</small></dd></div></dl>
  </div>
  <p className="com-legend"><i/> 무게중심 <span>＋ 팔레트 중심 · 면: 바닥 접촉 외곽</span></p>
  <details className="com-method"><summary>점수 산식과 가정</summary><p>균등 질량 박스의 질량 가중 평균 좌표를 사용합니다. 점수 = 100 × d / (d + h). d는 바닥 접촉 볼록 외곽까지의 최소 수평 여유, h는 무게중심 높이입니다. 경계·외부는 0점, 빈 팔레트·잘못된 데이터는 — 입니다.</p><p>*전도 임계각 = atan(d/h). 전체 적재를 하나의 강체로 보는 기하 지표입니다. 박스별 전도·하중·마찰과 동적 안정성은 별도 검사하며, 이 점수는 안전 인증이나 붕괴 확률이 아닙니다.</p></details>
 </section>;
}
