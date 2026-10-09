import type { Frame } from './types';
export function HeightChart({frames,limit}:{frames:Frame[];limit:number}){
 if(!frames.some(f=>f.records.length))return <p className="pallet-note">배치 후 단계별 최대 높이 그래프가 표시됩니다.</p>;
 const steps=Math.max(1,...frames.map(f=>f.records.length)),W=560,H=130;
 return <figure className="pallet-height-chart"><figcaption>단계별 최대 적재 높이 <span>한계 {limit} mm</span></figcaption><svg role="img" aria-label="실제 실행의 단계별 최대 적재 높이" viewBox={`0 0 ${W} ${H}`}><path className="pallet-chart-grid" d={`M35 12H550M35 59H550M35 106H550M35 12V106`}/><text x="2" y="17">{limit}</text><text x="17" y="109">0</text><text x="35" y="125">1단계</text><text x="500" y="125">{steps}단계</text>{frames.map((f,index)=>{let height=0;const points=f.records.map((r,i)=>{if(r.placement)height=Math.max(height,r.placement.position.z+r.placement.size.h);return `${35+(i/Math.max(1,steps-1))*515},${106-height/limit*94}`;}).join(' ');return <polyline key={index} className={`pallet-chart-line pallet-chart-${index}${f.records[0]?.algorithm==='random'?' pallet-chart-random':''}`} points={points}/>;})}</svg></figure>;
}
