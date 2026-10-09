import { aggregateHard } from './hardConstraints';
import { AREAS,DEFAULT_THRESHOLDS,DEFAULT_WEIGHTS } from './model';
import type { Aggregate,Area,Thresholds,TrialRow } from './model';
import { distribution,clamp,lowerScore,fingerprint } from './statistics';
import { METRICS } from './metrics';
const average=(v:(number|null)[])=>{const n=v.filter((x):x is number=>x!==null&&Number.isFinite(x));return n.length?n.reduce((a,b)=>a+b,0)/n.length:null;};
export function validWeights(weights:Record<Area,number>){return AREAS.every(k=>Number.isFinite(weights[k])&&weights[k]>=0&&weights[k]<=100)&&Math.abs(AREAS.reduce((s,k)=>s+weights[k],0)-100)<1e-6;}
export function aggregate(rows:TrialRow[],weights=DEFAULT_WEIGHTS,t:Thresholds=DEFAULT_THRESHOLDS):Aggregate[]{
 if(!validWeights(weights))throw Error('가중치는 0~100, 합계는 정확히 100%여야 합니다.');
 if(!(t.utilizationTarget>0&&t.utilizationTarget<=1&&t.latencyBadMs>t.latencyGoodMs&&t.secondsBad>t.secondsGood&&t.tippingTargetG>0))throw Error('점수 정규화 기준값을 확인하세요.');
 const offMap=new Map(rows.filter(r=>r.scope==='offline').map(r=>[`${r.caseId}:${r.seed}:${r.fingerprint}`,r])),baseMap=new Map(rows.filter(r=>r.caseId==='mixed').map(r=>[`${r.algorithm}:${r.seed}`,r]));
 const paired=rows.map(r=>{const v={...r.values},off=offMap.get(`${r.caseId}:${r.seed}:${r.fingerprint}`),base=baseMap.get(`${r.algorithm}:${r.seed}`);
  if(off&&off.values.utilization!=null&&v.utilization!=null&&!['timeout','error'].includes(off.outcome))v.regret=off.values.utilization-v.utilization;
  if(base&&base.values.utilization&&v.utilization!=null&&r.exceptions.some(e=>e.encountered))v.exceptionRetention=100*v.utilization/base.values.utilization;
  return {...r,values:v};});
 const out:Aggregate[]=[...new Set(paired.map(r=>r.algorithm))].map(algorithm=>{
  const rr=paired.filter(r=>r.algorithm===algorithm),metrics:Aggregate['metrics']={};
  for(const m of METRICS)metrics[m.key]=distribution(rr.map(r=>r.values[m.key]??null));
  const val=(k:string)=>metrics[k]?.mean??null,random=rr.filter(r=>['random','mixed'].includes(r.caseId)),proxy=rr.every(r=>r.robot==='proxy'),explicit=rr.every(r=>r.strength==='explicit');
  const efficiency=val('completion')===null||val('utilization')===null?null:.6*val('completion')!+.4*clamp(val('utilization')!/(t.utilizationTarget*100))*100;
  const stability=val('supportMin')===null||val('tippingG')===null||val('imbalance')===null?null:.4*val('supportMin')!+.4*clamp(val('tippingG')!/t.tippingTargetG)*100+.2*(100-clamp(val('imbalance')!/100)*100);
  const latency=val('p95Ms')===null?null:lowerScore(val('p95Ms')!,t.latencyGoodMs,t.latencyBadMs),seconds=average(rr.map(r=>r.values.workSeconds!=null&&r.values.count? r.values.workSeconds/r.values.count:null));
  const time=latency===null?null:proxy&&seconds!==null?.6*latency+.4*lowerScore(seconds,t.secondsGood,t.secondsBad):latency;
  const rd=distribution(random.map(r=>r.values.completion??null)),robustness=rd.n<2?null:.5*rd.mean!+.5*rd.p05!;
  const robot=proxy?average([val('reachProxy'),val('executionSuccess')]):null;
  const scores:Record<Area,number|null>={efficiency,stability,time,robustness,robot,exception:val('exceptionSuccess')};
  const active=AREAS.filter(k=>weights[k]>0),missing=active.filter(k=>scores[k]===null),total=active.reduce((s,k)=>s+weights[k],0),covered=active.filter(k=>scores[k]!==null).reduce((s,k)=>s+weights[k],0);
  const hardConstraints=aggregateHard(rr),verified=Object.values(hardConstraints).every(h=>h.status==='PASS');
  const safe=!Object.values(hardConstraints).some(h=>h.status==='FAIL')&&rr.every(r=>!Object.values(r.proposalViolations).some(n=>n!>0)&&r.outcome!=='constraint-rejected');
  const failed=rr.filter(r=>['no-placement','error','timeout','constraint-rejected','environment-blocked'].includes(r.outcome)).length;
  const eligible=safe&&!failed&&rr.every(r=>(r.values.count??0)>0),coverageKey=fingerprint({areas:active.filter(k=>scores[k]!==null),time:proxy?'model+compute':'compute',robot:proxy,strength:[...new Set(rr.map(r=>r.strength))].sort(),hard:Object.entries(hardConstraints).map(([k,v])=>[k,v.status,v.scope]),timing:[...new Set(rr.map(r=>JSON.stringify(r.warmup?{requested:r.warmup.requested,completed:r.warmup.completed,sameWorker:r.warmup.sameWorker}:null)))].sort(),tests:rr.map(r=>[r.caseId,r.seed,r.fingerprint]).sort()});
  return {algorithm,hardConstraints,rankGroup:rr[0].scope==='offline'?'reference':!eligible?'excluded':verified?'verified':'provisional',scope:rr[0].scope,rows:rr,metrics,scores,score:eligible&&covered?active.reduce((s,k)=>s+(scores[k]??0)*weights[k],0)/covered:null,coverage:100*covered/total,coverageKey,missing,safe,eligible,complete:rr.filter(r=>r.outcome==='complete').length,failed,timeouts:rr.filter(r=>r.outcome==='timeout').length,rank:null,unknown:[...(!explicit?['하중 한계: 재질 예제 가정 또는 정보 없음']:[]),'동적 붕괴·판지 압축 미검증',proxy?'로봇: TCP·그리퍼 기하 근사, IK·실제 파지 미검증':'로봇 작업·IK·실제 파지 미검증',...(rd.n<2?['순서 반복시험 2회 미만']:[])]};
 });
 for(const key of new Set(out.map(a=>a.coverageKey))){const group=out.filter(a=>a.coverageKey===key&&a.scope==='online'&&a.eligible&&a.score!==null).sort((a,b)=>b.score!-a.score!);group.forEach((a,i)=>a.rank=i&&Math.abs(a.score!-group[i-1].score!)<1e-9?group[i-1].rank:i+1);}
 return out;
}
