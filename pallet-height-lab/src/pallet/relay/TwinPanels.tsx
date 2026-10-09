import {top,volume} from '../geometry';
import type {Scenario,Placement} from '../types';

export function TwinRunStatus({playing,complete,error,time,seed}:{playing:boolean;complete:boolean;error:string;time:number;seed:number}){
 const state=error?'ERROR':complete?'COMPLETED':playing?'RUNNING':time?'PAUSED':'READY';
 return <div className="twin-run-status" aria-label="시뮬레이션 실행 상태">
  <span className="twin-state" data-state={state}><i/>{state}</span>
  <span>SEED <b>{seed}</b></span><span>SIM TIME <b>{time.toFixed(1)} <small>s</small></b></span>
 </div>;
}

export function TwinPackingReadout({scenario,stacks}:{scenario:Scenario;stacks:Placement[][]}){
 const placements=stacks.flat(),capacity=scenario.pallet.width*scenario.pallet.depth*scenario.pallet.maxHeight*stacks.length;
 const utilization=capacity?100*placements.reduce((n,p)=>n+volume(p.size),0)/capacity:0;
 const height=Math.max(0,...placements.map(top));
 return <section className="twin-packing" aria-label="현재 팔레트 분석">
  <div className="studio-section-label"><h3>적재 분석</h3><span>PACKING</span></div>
  <div className="twin-utilization"><span>현재 팔레트 용적 사용률</span><strong>{utilization.toFixed(1)}<small>%</small></strong></div>
  <progress max={100} value={utilization} aria-label="현재 팔레트 용적 사용률"/>
  <dl><div><dt>적재된 박스</dt><dd>{placements.length}<small> 개</small></dd></div><div><dt>가장 높은 적재</dt><dd>{height}<small> / {scenario.pallet.maxHeight} mm</small></dd></div><div><dt>최저 바닥 지지</dt><dd>{placements.length?(100*Math.min(...placements.map(p=>p.supportRatio))).toFixed(1)+'%':'—'}</dd></div></dl>
  <p>현재 작업셀 기준 · 반출한 팔레트 제외</p>
 </section>;
}
