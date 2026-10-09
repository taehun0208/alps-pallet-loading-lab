import { streamInventory,bedOrderItems } from '../relay/streamInventory';
import { heterogeneousInventory } from '../inventoryGeneration';
import { rng,shuffled } from '../rng';
import { volume } from '../geometry';
import { BED_SPLIT,PHASE_SEEDS,MAIN_CONDITIONS,caseSeeds,type CaseSeeds,type Phase } from './config';
import type { BoxType,Dimensions,Scenario } from '../types';

/**
 * Environment-side events. `at` is the 0-based arrival index at which the event becomes
 * observable; nothing about an event is given to the planner before that arrival.
 * - missing: the box at `at` never arrives; its type count is corrected at that moment.
 * - damaged: the box arrives damaged and must be isolated, not placed.
 * - resize: the box arrives with corrected size/weight (catalogue was wrong); observed correctly.
 * - mismeasure: the first observation is wrong; the true size is measured at pick, before placing.
 * - buffer-down: the staging buffer accepts no new box for `duration` arrivals.
 * - disturb: the top box of the current pallet is found displaced by `shiftMm`; the stack must be
 *   re-verified and, if invalid, quarantined instead of loaded further.
 */
export type EventKind='missing'|'damaged'|'resize'|'mismeasure'|'buffer-down'|'disturb';
export interface HarnessEvent { kind:EventKind;at:number;size?:Dimensions;weight?:number;duration?:number;shiftMm?:number }
export interface CaseSource { dataset:'synthetic'|'repeated-sku'|'bed-bpp';orderIds:string[];generator:string }
/** Everything one comparison case needs. `sequence` and `events` stay inside the environment. */
export interface CaseInput { situation:string;phase:Phase;seeds:CaseSeeds;scenario:Scenario;sequence:string[];events:HarnessEvent[];bufferSize:number;source:CaseSource }
/** How events are generated: probabilities/ranges are experiment assumptions, not field data. */
export interface EventProfile { kinds:EventKind[];count:number;sizeChange:[number,number];weightChange:[number,number] }
export interface Situation { id:string;label:string;question:string;bufferSize:number;events?:EventProfile;build:(phase:Phase,seeds:CaseSeeds)=>CaseInput }

function cell(s:Scenario,standingRule:boolean=MAIN_CONDITIONS.standingHeightRule):Scenario{
 s.supplyMode='arrival';s.events=[];
 s.constraints={...s.constraints,robotMode:'gripper',heavyRule:MAIN_CONDITIONS.heavyRule,supportRatio:MAIN_CONDITIONS.supportRatio,standingHeight:{enabled:standingRule,maxRiseMm:s.constraints.standingHeight?.maxRiseMm??100},reach:undefined,workspace:{...s.constraints.workspace,xMin:-5000,xMax:5000,yMin:-5000,yMax:5000},stability:{...s.constraints.stability!}};
 return s;
}
type Order='shuffle'|'large-late'|'heavy-late'|'source';
/** Arrival sequence from the catalogue; the planner never receives it. */
function arrival(types:BoxType[],order:Order,seed:number):string[]{
 const pool=types.flatMap(t=>Array.from({length:t.quantity},()=>t.id)),byId=new Map(types.map(t=>[t.id,t]));
 const q=shuffled(pool,rng(seed));
 if(order==='large-late')q.sort((a,b)=>volume(byId.get(a)!.size)-volume(byId.get(b)!.size));
 if(order==='heavy-late')q.sort((a,b)=>byId.get(a)!.weight-byId.get(b)!.weight);
 return q;
}
function events(profile:EventProfile|undefined,s:Scenario,sequence:string[],seed:number):HarnessEvent[]{
 if(!profile)return [];
 const random=rng(seed),n=sequence.length,used=new Set<number>(),list:HarnessEvent[]=[],between=([a,b]:[number,number])=>a+random()*(b-a);
 for(let i=0;i<profile.count;i++){
  let at=0;do{at=Math.floor(n*.2+random()*n*.6);}while(used.has(at));used.add(at);
  const kind=profile.kinds[i%profile.kinds.length],t=s.types.find(t=>t.id===sequence[at])!;
  const scale=(d:Dimensions)=>({w:Math.round(d.w*(1+between(profile.sizeChange))),d:Math.round(d.d*(1+between(profile.sizeChange))),h:Math.round(d.h*(1+between(profile.sizeChange)))});
  if(kind==='resize')list.push({kind,at,size:scale(t.size),weight:Math.round(t.weight*(1+between(profile.weightChange))*100)/100});
  else if(kind==='mismeasure')list.push({kind,at,size:scale(t.size)});
  else if(kind==='buffer-down')list.push({kind,at,duration:5});
  else if(kind==='disturb')list.push({kind,at,shiftMm:Math.round(between([40,120]))});
  else list.push({kind,at});
 }
 return list.sort((a,b)=>a.at-b.at);
}
type Build=(phase:Phase,seeds:CaseSeeds)=>Omit<CaseInput,'situation'>;
function synthetic(count:number,order:Order,bufferSize:number=MAIN_CONDITIONS.bufferSize,profile?:EventProfile,support?:number,standingRule:boolean=MAIN_CONDITIONS.standingHeightRule):Build{
 return (phase,seeds)=>{
  const s=cell(streamInventory(seeds.dataset,count),standingRule);if(support!==undefined)s.constraints.supportRatio=support;
  const sequence=arrival(s.types,order,seeds.arrival);
  return {phase,seeds,scenario:s,sequence,events:events(profile,s,sequence,seeds.event),bufferSize,source:{dataset:'synthetic',orderIds:[],generator:`streamInventory(${seeds.dataset},${count})`}};
 };
}
function repeated(order:Order):Build{
 return (phase,seeds)=>{
  const s=cell(streamInventory(seeds.dataset,8)),input=heterogeneousInventory({seed:seeds.dataset,typeCount:5,totalCount:60,assortment:'repeated'});
  s.id='repeated-sku';s.name='반복 규격 5종 60개 · KS T11';s.types=input.types;s.generation=input.generation;s.pallet={width:1100,depth:1100,maxHeight:1500};
  const sequence=arrival(s.types,order,seeds.arrival);
  return {phase,seeds,scenario:s,sequence,events:[],bufferSize:MAIN_CONDITIONS.bufferSize,source:{dataset:'repeated-sku',orderIds:[],generator:`heterogeneousInventory(${seeds.dataset},5,60,repeated)`}};
 };
}
/** BED-BPP from the phase's own order pool only. `count` undefined = one complete order. */
function bed(order:Order,count?:number):Build{
 return (phase,seeds)=>{
  // Order by the dataset's position in its phase list, so a phase can only reach its own orders.
  const index=PHASE_SEEDS[phase].indexOf(seeds.dataset);if(index<0)throw Error(`${phase} 단계에 속하지 않은 데이터 시드: ${seeds.dataset}`);
  const pool=BED_SPLIT[phase],start=index%pool.length,orderIds:string[]=[],items:ReturnType<typeof bedOrderItems>=[];
  for(let k=0;k<pool.length&&(count===undefined?orderIds.length<1:items.length<count);k++){const id=pool[(start+k)%pool.length];orderIds.push(id);items.push(...bedOrderItems(id));}
  const chosen=count===undefined?items:items.slice(0,count),s=cell(streamInventory(seeds.dataset,8));
  s.id='bed-bpp';s.name=`BED-BPP ${orderIds.join('+')}`;s.pallet={width:1200,depth:800,maxHeight:1600};
  s.constraints.standingHeight={enabled:false,maxRiseMm:100};s.constraints.stability={...s.constraints.stability!,slendernessMode:'score'};
  // One catalogue entry per distinct (size, weight); the source sequence stays environment-side.
  const key=(i:typeof chosen[number])=>`${i.size.w}x${i.size.d}x${i.size.h}@${i.weight}`,types=new Map<string,BoxType>();
  for(const item of chosen){const k=key(item),t=types.get(k);if(t)t.quantity++;else types.set(k,{id:k,name:k,size:{...item.size},weight:item.weight,quantity:1,orientations:[0,90],material:'unknown',color:'#a9c4b0'});}
  s.types=[...types.values()];
  const sequence=order==='source'?chosen.map(key):arrival(s.types,order,seeds.arrival);
  return {phase,seeds,scenario:s,sequence,events:[],bufferSize:MAIN_CONDITIONS.bufferSize,source:{dataset:'bed-bpp',orderIds,generator:`BED-BPP v1 subset · ${count??'complete order'} · ${order}`}};
 };
}
const exceptions=(kinds:EventKind[],count:number):EventProfile=>({kinds,count,sizeChange:[-.12,.12],weightChange:[-.3,.3]});
function def(id:string,label:string,question:string,build:Build,profile?:EventProfile):Situation{
 const probe=build('dev',caseSeeds(PHASE_SEEDS.dev[0]));
 return {id,label,question,bufferSize:probe.bufferSize,events:profile,build:(phase,seeds)=>({situation:id,...build(phase,seeds)})};
}

/** Normal comparison situations (no events) and exception situations (same events for every policy). */
export const SITUATIONS:Situation[]=[
 def('mixed-small','다품종 소량 20개','한 팔레트도 다 채우지 않는 주문에서 부분 팔레트의 균형',synthetic(20,'shuffle')),
 def('mixed-48','다품종 48개 · 무작위','모두 다른 박스가 무작위로 올 때 기본 성능',synthetic(48,'shuffle')),
 def('mixed-96','다품종 96개 · 무작위','여러 팔레트가 필요한 대량 주문',synthetic(96,'shuffle')),
 def('mixed-large-late','다품종 48개 · 큰 박스 늦게','받침이 될 큰 박스가 나중에 올 때 공간 보존',synthetic(48,'large-late')),
 def('mixed-heavy-late','다품종 48개 · 무거운 박스 늦게','무거운 박스가 나중에 올 때 하중 규칙과 무게중심',synthetic(48,'heavy-late')),
 def('mixed-no-buffer','다품종 48개 · 대기 자리 없음','못 놓는 박스를 잠시 둘 곳이 없을 때',synthetic(48,'shuffle',0)),
 def('mixed-buffer-4','다품종 48개 · 버퍼 4칸','동일한 박스와 순서에서 버퍼 0·2·4칸의 효과 비교',synthetic(48,'shuffle',4)),
 def('mixed-standing-rule','다품종 48개 · 세움 높이 규칙 켬','세워진 박스 주변 높이 보조 규칙(100mm)을 켜면 순위가 바뀌는가',synthetic(48,'shuffle',MAIN_CONDITIONS.bufferSize,undefined,undefined,true)),
 def('mixed-support-80','다품종 48개 · 지지 기준 80%','지지면적 기준 92%→80% 완화 시 순위 변화',synthetic(48,'shuffle',2,undefined,.8)),
 def('repeated-sku','소품종 반복 5종 60개','같은 규격이 반복될 때 미래 수량 정보의 가치',repeated('shuffle')),
 def('bed-bpp-order','BED-BPP 주문 · 원래 순서','공개 데이터 주문을 원래 순서 그대로 처리',bed('source')),
 def('bed-bpp-shuffle','BED-BPP 주문 · 무작위 순서','같은 주문을 원래 순서 대신 무작위 순서로',bed('shuffle')),
 def('event-missing','예외 · 누락 2건','확인된 누락 후 잔량 정정',synthetic(48,'shuffle',2,exceptions(['missing'],2)),exceptions(['missing'],2)),
 def('event-damaged','예외 · 파손 2건','파손 박스 격리',synthetic(48,'shuffle',2,exceptions(['damaged'],2)),exceptions(['damaged'],2)),
 def('event-resize','예외 · 규격/중량 정정 3건','카탈로그와 다른 실제 규격·중량',synthetic(48,'shuffle',2,exceptions(['resize'],3)),exceptions(['resize'],3)),
 def('event-buffer-down','예외 · 버퍼 일시 사용 불가','대기 자리를 잠시 못 쓸 때',synthetic(48,'shuffle',2,exceptions(['buffer-down'],2)),exceptions(['buffer-down'],2)),
 def('event-combined','복합 예외 · 사건 6건 + 측정 오차','여러 사건과 입력 오차가 겹칠 때',synthetic(48,'shuffle',2,exceptions(['missing','damaged','resize','mismeasure','buffer-down','disturb'],6)),exceptions(['missing','damaged','resize','mismeasure','buffer-down','disturb'],6)),
];
export const NORMAL_SITUATIONS=SITUATIONS.filter(s=>!s.events);
export const EVENT_SITUATIONS=SITUATIONS.filter(s=>!!s.events);
/** Boundary/sensitivity studies are reported separately from ordinary operating conditions. */
export const BOUNDARY_SITUATIONS=NORMAL_SITUATIONS.filter(s=>['mixed-large-late','mixed-heavy-late','mixed-support-80','mixed-no-buffer','mixed-buffer-4','mixed-standing-rule'].includes(s.id));
export const CORE_SITUATIONS=NORMAL_SITUATIONS.filter(s=>!BOUNDARY_SITUATIONS.includes(s));
export const SITUATION_SUITES={core:CORE_SITUATIONS,boundary:BOUNDARY_SITUATIONS,events:EVENT_SITUATIONS,all:SITUATIONS};
export function selectSituations(suite:string,ids?:string[]|null):Situation[]{
 if(!Object.prototype.hasOwnProperty.call(SITUATION_SUITES,suite))throw Error('--suite core|boundary|events|all');
 // Explicit IDs override suite selection, but never silently accept a typo or empty run.
 if(ids){for(const id of ids)if(!SITUATIONS.some(s=>s.id===id))throw Error(`unknown situation ${id}`);
  return SITUATIONS.filter(s=>ids.includes(s.id));}
 return SITUATION_SUITES[suite as keyof typeof SITUATION_SUITES];
}
export function buildCase(situation:string,phase:Phase,dataset:number):CaseInput{
 const s=SITUATIONS.find(x=>x.id===situation);if(!s)throw Error(`unknown situation ${situation}`);return s.build(phase,caseSeeds(dataset));
}
/** Source order IDs behind a case (BED-BPP only). */
export const sourceOrders=(c:CaseInput)=>c.source.orderIds;
export { PHASE_SEEDS };
export { compactPolicy,legacyGreedyPolicy,strategyPolicy,policies } from './config';
