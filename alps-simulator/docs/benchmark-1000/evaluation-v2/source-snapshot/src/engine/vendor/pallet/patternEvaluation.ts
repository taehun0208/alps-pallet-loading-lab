import { metrics } from './environment';
import { inspectConstraints } from './constraints';
import { stability } from './stability';
import { originalSize } from './orientations';
import type { Frame,Scenario } from './types';
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export function evaluatePattern(frame:Frame,s:Scenario){
 const m=metrics(frame,s),total=s.types.reduce((n,t)=>n+t.quantity,0),coverage=m.count/total,staticState=stability(frame.placements,s.constraints.stability),reasons=new Set<string>(staticState.violations);
 for(const r of frame.records){if(r.disposition!=='placed'||!r.placement)continue;const context=r.context||s,check=inspectConstraints(r.placement,r.observation,r.before,context.pallet,context.constraints);check.reasons.forEach(reason=>reasons.add(`${r.observation.id}: ${reason}`));}
 for(const p of frame.placements){const recorded=frame.records.find(r=>r.disposition==='placed'&&r.observation.id===p.id)?.observation,observation=recorded||{...p,size:originalSize(p.size,p.orientation),status:'normal' as const,orientationAllowed:[p.orientation]},check=inspectConstraints(p,observation,frame.placements.filter(b=>b.id!==p.id),s.pallet,{...s.constraints,robotMode:'ideal'});check.reasons.forEach(reason=>reasons.add(`${p.id}: ${reason}`));}
 if(m.count>total||new Set(frame.placements.map(p=>p.id)).size!==m.count)reasons.add('확정 수량 또는 ID 중복 위반');
 const has=m.count>0,robot=s.constraints.robotMode!=='ideal',reserve=staticState.supports.length?Math.min(...staticState.supports.map(p=>clamp(p.reserve/Math.max(1,p.margin)))):0;
 const dimensions={packing:has?50*(clamp(m.utilization)+clamp(m.efficiency)):0,balance:has?100*clamp(1-m.imbalance):0,stability:has?100*Math.min(reserve,clamp(1-m.loadUtilization)):0,robotTime:has&&robot?100/(1+m.workSeconds/m.count/10):null,generationTime:has?100/(1+m.medianMs/1000):0};
 const quality=(.25*dimensions.packing+.2*dimensions.balance+.35*dimensions.stability+.05*dimensions.generationTime+(dimensions.robotTime===null?0:.15*dimensions.robotTime))/(robot?1:.85),verified=m.unknownCapacity===0;
 return {score:reasons.size||!verified?null:coverage*quality,coverage,dimensions,valid:!reasons.size,capacityVerified:verified,complete:m.complete,reasons:[...reasons],scope:robot?'그리퍼 자세·스윕·도달 반경 근사':'기하/정적 적재 · 로봇 미평가',physics:'별도 강체 검증',ik:'관절·IK 미검증'};
}
