import { ArrivalEnvironment } from '../environment';
import { inspectConstraints } from '../constraints';
import { withLoads, volume, top } from '../geometry';
import { stability } from '../stability';
import { auditProposal } from '../benchmark/runner';
import { getAlgorithm } from '../benchmark/registry';
import { distribution, fingerprint } from '../benchmark/statistics';
import { rng, shuffled } from '../scenarios';
import { strategyDemo } from '../strategies/demo';
import { DEFAULT_STRATEGY } from '../strategies/PackingStrategy';
import { ONLINE_SEARCH } from '../types';
import type { Analysis, Observation, Placement, PlanningInput, Scenario, SearchSettings } from '../types';
import type { AlgorithmEntry } from '../benchmark/model';

export type Group='apparel'|'other';
export type Routing='pooled'|'dedicated'|'overflow';
export const ROUTES:Record<Routing,string>={pooled:'분류 전 · 공용 2팔레트',dedicated:'ALPS · 대분류 전용',overflow:'ALPS · 용량 부족 시 혼합 허용'};
export interface AlpsConfig { scenario:Scenario; settings:SearchSettings; algorithms:string[]; discovery:number; holdout:number; seed:number; apparelShare:number; bufferCapacity:number; shipment:'priority'|'simultaneous'; trialMs:number }
export interface AlpsStep { phase:'inbound'|'redistribution'; boxId:string; action:string; selected:number|null; reason:string; source:Placement[][]; destination:Placement[][]; held:string[]; ms:number }
export interface AlpsTrial { id:string; algorithm:string; version:string; route:Routing; seed:number; split:'discovery'|'holdout'; fingerprint:string; arrivals:string[]; groups:Record<string,Group>; total:number; normal:number; placed:number; redistributed:number; rejected:number; violations:string[]; failures:Record<string,number>; utilization:number; height:number; minSupport:number|null; minMargin:number|null; planMs:number; p95Ms:number|null; candidates:number; moves:number; rehandles:number; bufferPeak:number; mixed:number; status:'finished'|'timeout'|'error'; reason:string; trace:AlpsStep[]; scenario:Scenario }
export function alpsDemo():Scenario {
 const s=strategyDemo();s.id='alps-retail-synthetic';s.name='ALPS 유통 합성 입력 · 36개';s.pallet.maxHeight=700;
 s.types=s.types.map(t=>({...t,quantity:t.quantity*2}));s.constraints.heavyRule='off';return s;
}
export function alpsSettings():SearchSettings { return {...structuredClone(ONLINE_SEARCH),maxCandidates:24,topK:3,samples:2,depth:1,virtualCandidates:4,reserveProbes:2,strategy:{...DEFAULT_STRATEGY,futureCandidates:4,lookaheadDepth:1,lookaheadSamples:2,lookaheadCandidates:3}}; }
export function defaultAlpsConfig():AlpsConfig {return {scenario:alpsDemo(),settings:alpsSettings(),algorithms:['random','blb','strategy-greedy','future-hybrid'],discovery:3,holdout:2,seed:20261010,apparelShare:.5,bufferCapacity:6,shipment:'priority',trialMs:30000};}
// Synthetic shipping category is per ITEM, independent of dimensions, material, strength and CoG.
export function categoryMap(s:Scenario,seed:number,share:number):Record<string,Group> {
 const ids=s.types.flatMap(t=>Array.from({length:t.quantity},(_,i)=>`${t.id}-${String(i+1).padStart(2,'0')}`));
 const apparel=new Set(shuffled(ids,rng(seed^0x51a7)).slice(0,Math.round(ids.length*share)));
 return Object.fromEntries(ids.map(id=>[id,apparel.has(id)?'apparel':'other']));
}
type Cell={placements:Placement[];state?:PlanningInput['strategyState']};
type Choice={index:number;analysis:Analysis;input:PlanningInput;placement:Placement};
export function runAlpsTrial(config:AlpsConfig,algorithm:string,route:Routing,seed:number,split:AlpsTrial['split'],definition:AlgorithmEntry=getAlgorithm(algorithm)):AlpsTrial {
 if(definition.scope!=='online')throw Error('ALPS 온라인 비교에는 오프라인 기준해를 포함하지 않습니다.');
 if(!Number.isFinite(config.apparelShare)||config.apparelShare<0||config.apparelShare>1||!Number.isInteger(config.bufferCapacity)||config.bufferCapacity<0)throw Error('분류 비율 또는 버퍼 용량 오류');
 const s=structuredClone(config.scenario);s.supplyMode='arrival';s.arrival={seed,pattern:'random-draw'};
 const env=new ArrivalEnvironment(s),groups=categoryMap(s,seed,config.apparelShare),cells:Cell[]=[{placements:[]},{placements:[]}],dest:Cell[]=[{placements:[]},{placements:[]}];
 const id=`${split}:${seed}:${algorithm}:${route}`,times:number[]=[],started=performance.now();
 const row:AlpsTrial={id,algorithm,version:definition.version??'미지정',route,seed,split,fingerprint:fingerprint({s,settings:config.settings,apparelShare:config.apparelShare,buffer:config.bufferCapacity,shipment:config.shipment,trialMs:config.trialMs}),arrivals:[],groups,total:env.total,normal:0,placed:0,redistributed:0,rejected:0,violations:[],failures:{},utilization:0,height:0,minSupport:null,minMargin:null,planMs:0,p95Ms:null,candidates:0,moves:0,rehandles:0,bufferPeak:0,mixed:0,status:'finished',reason:'',trace:[],scenario:s};
 const observations=new Map<string,Observation>(),remaining=Object.fromEntries(s.types.map(t=>[t.id,t.quantity]));
 const fail=(reason:string)=>{row.failures[reason]=(row.failures[reason]??0)+1;};
 const snapshot=(phase:AlpsStep['phase'],o:Observation,action:string,index:number|null,reason:string,ms=0)=>row.trace.push({phase,boxId:o.id,action,selected:index,reason,source:cells.map(c=>structuredClone(c.placements)),destination:dest.map(c=>structuredClone(c.placements)),held:held.map(o=>o.id),ms});
 const checkTime=()=>{if(performance.now()-started>config.trialMs){row.status='timeout';row.reason='단일 실험 시간 예산 초과 · 추천에서 제외';return true;}return false;};
 const choose=(o:Observation,targets:Cell[],allowed:number[],step:number,counts=remaining):Choice|undefined=>{
  const choices:Choice[]=[];
  for(const index of allowed){
   if(checkTime())break;
   const input:PlanningInput={runId:id+':'+index,stepId:step,pallet:structuredClone(s.pallet),types:structuredClone(s.types),constraints:structuredClone(s.constraints),placements:structuredClone(targets[index].placements),current:structuredClone(o),remaining:{...counts},algorithm:'greedy',settings:{...structuredClone(config.settings),plannerSeed:config.settings.plannerSeed+seed+step},strategyState:structuredClone(targets[index].state)};
   const begin=performance.now(),a=definition.plan(structuredClone(input)),reasons=auditProposal(input,a),ms=performance.now()-begin;times.push(ms);row.candidates+=a.checkedCandidates??a.candidates.length;
   if(reasons.length){row.rejected++;row.violations.push(...reasons);continue;}
   const selected=a.candidates.find(c=>c.id===a.selectedId&&c.valid);if(selected)choices.push({index,analysis:a,input,placement:selected.placement});
  }
  // Central server compares committed outcomes, not incomparable algorithm-specific raw scores.
  // Lower resulting height -> greater minimum support -> deterministic pallet index.
  return choices.sort((a,b)=>Math.max(top(a.placement),...a.input.placements.map(top),0)-Math.max(top(b.placement),...b.input.placements.map(top),0)||b.placement.supportRatio-a.placement.supportRatio||a.index-b.index)[0];
 };
 const commit=(choice:Choice,targets:Cell[])=>{
  const checked=inspectConstraints(choice.placement,choice.input.current,targets[choice.index].placements,s.pallet,s.constraints);
  if(checked.reasons.length){row.rejected++;row.violations.push(...checked.reasons);return false;}
  targets[choice.index]={placements:checked.stack,state:structuredClone(choice.analysis.strategyState)};return true;
 };
 const held:Observation[]=[];
 try {
  for(let step=0;step<env.total;step++){
   if(checkTime())break;const o=env.current(step)!;row.arrivals.push(o.id);remaining[o.typeId]--;observations.set(o.id,o);
   if(o.status==='damaged'||o.status==='missing'){fail(o.status==='damaged'?'손상 격리':'입고 누락');snapshot('inbound',o,'격리 / 재고 수정',null,o.status);continue;}row.normal++;
   const assigned=groups[o.id]==='apparel'?0:1,start=performance.now();
   let choice=choose(o,cells,route==='pooled'?[0,1]:[assigned],step);
   if(!choice&&route==='overflow'&&row.status==='finished')choice=choose(o,cells,[1-assigned],step);
   if(choice&&commit(choice,cells)){row.placed++;if(route!=='pooled'&&choice.index!==assigned)row.mixed++;snapshot('inbound',o,`P${choice.index+1} 배치`,choice.index,'중앙 선택 · 높이 → 지지율 → 팔레트 번호',performance.now()-start);}
   else {fail('현재 두 팔레트의 유효 후보 없음');snapshot('inbound',o,'미적재',null,'경계·충돌·지지·하중 검사 후 유효 후보 없음',performance.now()-start);}
  }
  // Explicit operational assumption: apparel ships first. Other-category destinations are closed
  // until apparel is done. Under simultaneous shipping no unnecessary temporary handling is forced.
  const sourceIds=new Set(cells.flatMap(c=>c.placements.map(p=>p.id))),pending=new Set(sourceIds);
  const sourceCell=(boxId:string)=>cells.findIndex(c=>c.placements.some(p=>p.id===boxId));
  const accessible=(p:Placement,stack:Placement[])=>!stack.some(b=>b.id!==p.id&&top(b)>top(p)+s.constraints.contactTolerance&&
   b.position.x< p.position.x+p.size.w+s.constraints.gripper.margin&&b.position.x+b.size.w>p.position.x-s.constraints.gripper.margin&&
   b.position.y< p.position.y+p.size.d+s.constraints.gripper.margin&&b.position.y+b.size.d>p.position.y-s.constraints.gripper.margin);
  let step=env.total;const attempted=new Set<string>();
  while(pending.size&&row.status==='finished'){
   if(checkTime())break;
   const priority:Group=config.shipment==='priority'&&[...pending].some(id=>groups[id]==='apparel')?'apparel':'other';
   const eligible=(id:string)=>config.shipment==='simultaneous'||groups[id]===priority;
   const fromHeld=held.find(o=>eligible(o.id)&&!attempted.has(o.id));
   const physical=cells.flatMap(c=>c.placements.filter(p=>eligible(p.id)&&!attempted.has(p.id)&&accessible(p,c.placements))).sort((a,b)=>top(b)-top(a)||a.id.localeCompare(b.id))[0];
   const o=fromHeld??(physical?observations.get(physical.id):undefined);
   if(o){
    const counts=Object.fromEntries(s.types.map(t=>[t.id,[...pending].filter(id=>id!==o.id&&observations.get(id)?.typeId===t.id).length]));
    const clean={...o,pickupPosition:undefined},target=groups[o.id]==='apparel'?0:1,choice=choose(clean,dest,[target],step++,counts);
    if(!choice||!commit(choice,dest)){if(row.status!=='finished')break;attempted.add(o.id);snapshot('redistribution',o,'목적지 후보 없음 · 다른 박스 검토',target,'같은 상태에서는 반복하지 않으며 목적지 지지 상태 변경 후만 재검토');continue;}
    if(fromHeld)held.splice(held.indexOf(fromHeld),1);else {const index=sourceCell(o.id);cells[index].placements=withLoads(cells[index].placements.filter(p=>p.id!==o.id));}
    pending.delete(o.id);attempted.clear();row.redistributed++;row.moves++;snapshot('redistribution',o,`출고 P${target+1} 재적재`,target,fromHeld?'임시 버퍼에서 회수':'상부 차단 없음 · 수직 인출 근사');continue;
   }
   // Remove only a top-accessible blocker on an actual ancestor chain of requested goods.
   const blockers=new Set<string>();
   for(const cell of cells){const walk=(p:Placement,seen:Set<string>)=>{for(const b of cell.placements){if(b.id===p.id||seen.has(b.id)||b.position.z<top(p)-s.constraints.contactTolerance)continue;if(b.position.x>=p.position.x+p.size.w+s.constraints.gripper.margin||b.position.x+b.size.w<=p.position.x-s.constraints.gripper.margin||b.position.y>=p.position.y+p.size.d+s.constraints.gripper.margin||b.position.y+b.size.d<=p.position.y-s.constraints.gripper.margin)continue;seen.add(b.id);blockers.add(b.id);walk(b,seen);}};for(const p of cell.placements.filter(p=>eligible(p.id)))walk(p,new Set());}
   const blocker=cells.flatMap(c=>c.placements.filter(p=>blockers.has(p.id)&&accessible(p,c.placements))).sort((a,b)=>top(b)-top(a)||a.id.localeCompare(b.id))[0];
   if(!blocker||held.length>=config.bufferCapacity){fail(!blocker?(attempted.size?'재분배 대상 팔레트 배치 불가':'수직 인출 경로 없음'):'임시 버퍼 용량 부족');row.reason='재분배 중단 · 현재 상태의 다른 접근 가능 박스도 검토함 · 무한 재시도 없음';break;}
   const box=observations.get(blocker.id)!,index=sourceCell(box.id);cells[index].placements=withLoads(cells[index].placements.filter(p=>p.id!==box.id));held.push(box);row.moves++;row.rehandles++;row.bufferPeak=Math.max(row.bufferPeak,held.length);snapshot('redistribution',box,'차단 박스 임시 이동',null,'우선 출고 대상의 수직 인출 경로를 확보');
  }
 }catch(error){row.status='error';row.reason=(error as Error).message;}
 const lastInbound=[...row.trace].reverse().find(t=>t.phase==='inbound'),packed=lastInbound?.source.flat()??[];
 row.utilization=packed.reduce((n,p)=>n+volume(p.size),0)/(2*s.pallet.width*s.pallet.depth*s.pallet.maxHeight);row.height=Math.max(0,...packed.map(top));
 row.minSupport=packed.length?Math.min(...packed.map(p=>p.supportRatio)):null;
 const margins=(lastInbound?.source??[]).flatMap(ps=>stability(ps,s.constraints.stability).supports.map(b=>b.reserve));row.minMargin=margins.length?Math.min(...margins):null;
 row.planMs=times.reduce((a,b)=>a+b,0);row.p95Ms=distribution(times).p95;return row;
}

export function summarizeAlps(rows:AlpsTrial[],split:AlpsTrial['split']) {
 const keys=[...new Set(rows.filter(r=>r.split===split).map(r=>`${r.algorithm}:${r.route}`))];
 return keys.map(key=>{const all=rows.filter(r=>r.split===split&&`${r.algorithm}:${r.route}`===key),valid=all.filter(r=>r.status==='finished'&&!r.violations.length),first=all[0];
  return {key,algorithm:first.algorithm,route:first.route,n:valid.length,excluded:all.length-valid.length,completion:distribution(valid.map(r=>r.normal?r.placed/r.normal:0)),redistribution:distribution(valid.map(r=>r.normal?r.redistributed/r.normal:0)),height:distribution(valid.map(r=>r.height)),utilization:distribution(valid.map(r=>r.utilization)),rehandles:distribution(valid.map(r=>r.rehandles)),planMs:distribution(valid.map(r=>r.planMs)),support:distribution(valid.map(r=>r.minSupport)),margin:distribution(valid.map(r=>r.minMargin))};
 }).sort((a,b)=>(b.redistribution.mean??-1)-(a.redistribution.mean??-1)||(b.completion.mean??-1)-(a.completion.mean??-1)||(a.rehandles.mean??Infinity)-(b.rehandles.mean??Infinity)||(a.planMs.mean??Infinity)-(b.planMs.mean??Infinity));
}
export function shortlistAlps(rows:AlpsTrial[]) {
 const discovered=summarizeAlps(rows,'discovery').filter(r=>r.route!=='pooled'&&r.n>0&&r.excluded===0),seen=new Set<string>();
 return discovered.filter(r=>!seen.has(r.algorithm)&&!!seen.add(r.algorithm)).slice(0,2).map(r=>({...r,holdout:summarizeAlps(rows,'holdout').find(v=>v.key===r.key)??null}));
}
export function pairedRoutingEffect(rows:AlpsTrial[],route:Routing,split:AlpsTrial['split']) {
 return [...new Set(rows.map(r=>r.algorithm))].map(algorithm=>{const differences=rows.filter(r=>r.algorithm===algorithm&&r.route===route&&r.split===split&&r.status==='finished'&&!r.violations.length).flatMap(r=>{const b=rows.find(b=>b.algorithm===algorithm&&b.seed===r.seed&&b.split===split&&b.route==='pooled'&&b.status==='finished'&&!b.violations.length);return b?[{completion:(r.placed/Math.max(1,r.normal)-b.placed/Math.max(1,b.normal))*100,rehandles:r.rehandles-b.rehandles,redistribution:(r.redistributed/Math.max(1,r.normal)-b.redistributed/Math.max(1,b.normal))*100}]:[];});return {algorithm,completion:distribution(differences.map(r=>r.completion)),rehandles:distribution(differences.map(r=>r.rehandles)),redistribution:distribution(differences.map(r=>r.redistribution))};});
}
export function alpsCsv(rows:AlpsTrial[]) {return ['algorithm,route,seed,split,status,normal,placed,redistributed,utilization,height,minSupport,minMargin,planMs,p95Ms,candidates,moves,rehandles,bufferPeak,mixed,rejected,fingerprint',...rows.map(r=>[r.algorithm,r.route,r.seed,r.split,r.status,r.normal,r.placed,r.redistributed,r.utilization,r.height,r.minSupport,r.minMargin,r.planMs,r.p95Ms,r.candidates,r.moves,r.rehandles,r.bufferPeak,r.mixed,r.rejected,r.fingerprint].join(','))].join('\n');}
