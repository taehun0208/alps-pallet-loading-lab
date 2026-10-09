import { contactsFor, EPS, intersects, volume } from '../geometry';
import { equilibrium } from '../equilibrium';
import { stability } from '../stability';
import { massCenter } from '../packaging/spec';
import { materialInfo } from '../materials';
import { DEFAULT_STABILITY } from '../types';
import type { Placement, Scenario, Vec3 } from '../types';
import type { RelayWorld } from './types';

export interface Diagnostic { boxId:string; robot:number; message:string; kind:'geometry'|'support'|'load' }
export interface PalletEvaluation {
  robot:number; cycle:number; dispatched:boolean; count:number; volumeMm3:number; heightMm:number;
  center:Vec3|null; minSupportRatio:number|null; minMarginMm:number|null; minTippingG:number|null;
  worstBoxId:string|null; violations:Diagnostic[];
}
export interface RelayEvaluation {
  completion:{placed:number;total:number;ratio:number|null};
  capacity:{usedPallets:number;volumeMm3:number;utilization:number|null};
  safety:{status:'pass'|'fail'|'unverified';violations:Diagnostic[];minSupportRatio:number|null;minMarginMm:number|null;minTippingG:number|null;worstBoxId:string|null;worstRobot:number|null;robotExecution:'unverified';compression:'unverified'};
  operation:{modeledElapsedSeconds:number;throughputPerHour:number|null;meanWorkSeconds:number|null};
  robustness:'unverified'; pallets:PalletEvaluation[];
}
export interface LatencySample { milliseconds:number;deadlineMs?:number;valid?:boolean }
export interface LatencySummary { count:number;p50:number|null;p95:number|null;p99:number|null;max:number|null;deadlineCount:number;validDeadlineRate:number|null }

/** Nearest-rank quantiles. Deadline rate requires an explicit deadline AND valid-result label. */
export function summarizeLatency(samples:readonly LatencySample[]):LatencySummary {
  const finite=samples.filter(s=>Number.isFinite(s.milliseconds)&&s.milliseconds>=0);
  const values=finite.map(s=>s.milliseconds).sort((a,b)=>a-b);
  const percentile=(p:number)=>values.length?values[Math.max(0,Math.ceil(p*values.length)-1)]:null;
  const deadlines=finite.filter(s=>s.deadlineMs!==undefined&&Number.isFinite(s.deadlineMs)&&s.deadlineMs>=0&&typeof s.valid==='boolean');
  return {count:values.length,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:values.at(-1)??null,deadlineCount:deadlines.length,
    validDeadlineRate:deadlines.length?deadlines.filter(s=>s.valid&&s.milliseconds<=s.deadlineMs!).length/deadlines.length:null};
}
const minimum=(values:(number|null)[])=>{const known=values.filter((v):v is number=>v!==null&&Number.isFinite(v));return known.length?Math.min(...known):null;};

/** Current contact-state diagnostic, not a full robot or physical transport certification.
 * Reconstruct contacts rather than trust cached placement support/load fields.
 * The tipping proxy is local contact margin / resultant height, under rigid no-slip assumptions.
 */
export function evaluatePallet(s:Scenario,placements:readonly Placement[],robot=0,cycle=1,dispatched=false):PalletEvaluation {
  const violations:Diagnostic[]=[],add=(boxId:string,message:string,kind:Diagnostic['kind'])=>violations.push({boxId,robot,message,kind});
  const invalid=placements.filter(b=>![b.position.x,b.position.y,b.position.z,b.size.w,b.size.d,b.size.h,b.weight].every(Number.isFinite)||Math.min(b.size.w,b.size.d,b.size.h,b.weight)<=0);
  const ids=new Set<string>();for(const b of placements){if(ids.has(b.id))add(b.id,'중복 적재 ID','geometry');ids.add(b.id);}
  if(invalid.length||violations.length){
    for(const b of invalid)add(b.id,'치수·질량 입력 오류','geometry');
    // Invalid mass or duplicate graph IDs cannot be fed to the force solver. Returning
    // unknown physical margins prevents an invalid model looking like a stable zero-load stack.
    return {robot,cycle,dispatched,count:placements.length,volumeMm3:placements.reduce((n,b)=>n+volume(b.size),0),heightMm:Math.max(0,...placements.map(b=>b.position.z+b.size.h)),center:null,minSupportRatio:null,minMarginMm:null,minTippingG:null,worstBoxId:violations[0].boxId,violations};
  }
  const rebuilt=placements.map(b=>{const supports=contactsFor(b,placements.filter(p=>p.id!==b.id),s.constraints.contactTolerance);return {...b,supports,supportRatio:Math.abs(b.position.z)<EPS?1:supports.reduce((n,c)=>n+c.area,0)/(b.size.w*b.size.d)};});
  for(let i=0;i<rebuilt.length;i++){
    const b=rebuilt[i],p=b.position;
    if(p.x< -EPS||p.y< -EPS||p.z< -EPS||p.x+b.size.w>s.pallet.width+EPS||p.y+b.size.d>s.pallet.depth+EPS||p.z+b.size.h>s.pallet.maxHeight+EPS)add(b.id,'팔레트 경계·높이 위반','geometry');
    if(b.supportRatio+EPS<(b.packaging?.minSupportRatio??s.constraints.supportRatio))add(b.id,'바닥 지지면적 부족','support');
    for(let j=0;j<i;j++)if(intersects(b,rebuilt[j],s.constraints.horizontalGap))add(b.id,`${rebuilt[j].id}와 관통·작업 여유 위반`,'geometry');
  }
  const cfg=s.constraints.stability??DEFAULT_STABILITY,solution=equilibrium(rebuilt),balance=stability(rebuilt,cfg,solution);
  for(const message of balance.violations){const support=balance.supports.find(b=>message.includes(`· ${b.id} (`));add(support?.id??rebuilt.find(b=>message.endsWith(`· ${b.id}`))?.id??rebuilt[0]?.id??'',message,'support');}
  const lookup=new Map(solution.placements.map(b=>[b.id,b]));
  for(const b of solution.placements){
    const info=materialInfo(b,cfg);
    if(info.capacity!==null&&b.loadAbove>info.capacity+EPS)add(b.id,`설정 허용하중 초과 · ${info.source}`,'load');
    for(const c of b.supports){const lower=lookup.get(c.id);if(!lower)continue;
      if(lower.handling==='no-top-load'||lower.packaging?.stackable===false)add(lower.id,'상부 적재 금지 위반','load');
      if(!b.packaging&&s.constraints.heavyRule!=='off'&&(s.constraints.heavyRule==='share'?b.weight*c.share:b.weight)>lower.weight+EPS)add(b.id,`${lower.id}에 대한 중량 배치 규칙 위반`,'load');
    }
  }
  const mass=rebuilt.reduce((n,b)=>n+b.weight,0),center=mass>0?rebuilt.reduce((n,b)=>{const c=massCenter(b);return {x:n.x+c.x*b.weight/mass,y:n.y+c.y*b.weight/mass,z:n.z+c.z*b.weight/mass};},{x:0,y:0,z:0}):null;
  if(s.pallet.maxLoadKg!==undefined&&(!Number.isFinite(s.pallet.maxLoadKg)||s.pallet.maxLoadKg<=0||mass>s.pallet.maxLoadKg+EPS))add(rebuilt.at(-1)?.id??'','팔레트 허용 적재중량 초과','load');
  const worst=[...balance.supports].sort((a,b)=>a.reserve-b.reserve)[0];
  return {robot,cycle,dispatched,count:placements.length,volumeMm3:placements.reduce((n,b)=>n+volume(b.size),0),heightMm:Math.max(0,...placements.map(b=>b.position.z+b.size.h)),center,
    minSupportRatio:minimum(rebuilt.map(b=>b.supportRatio)),minMarginMm:minimum(balance.supports.map(b=>b.margin)),
    minTippingG:minimum(balance.supports.map(b=>b.center.z>b.planeZ?Math.max(0,b.margin)/(b.center.z-b.planeZ):null)),worstBoxId:violations[0]?.boxId??worst?.id??null,violations};
}

type PalletEvaluator=typeof evaluatePallet;
function aggregate(s:Scenario,w:RelayWorld,evaluate:PalletEvaluator):RelayEvaluation {
  const pallets=[...w.cells.flatMap((c,robot)=>c.placements.length?[evaluate(s,c.placements,robot,w.stream?.cells[robot]?.cycle??1,false)]:[]),...(w.stream?.dispatched??[]).filter(c=>c.placements.length).map(c=>evaluate(s,c.placements,c.robot,c.cycle,true))];
  const stored=[...w.cells.flatMap(c=>c.placements),...(w.stream?.dispatched??[]).flatMap(p=>p.placements)];
  const placed=new Set(stored.map(b=>b.id)).size,total=w.boxes.length,volumeMm3=pallets.reduce((n,p)=>n+p.volumeMm3,0);
  const violations=pallets.flatMap(p=>p.violations),worst=pallets.find(p=>p.violations.length)??[...pallets].sort((a,b)=>(a.minMarginMm??Infinity)-(b.minMarginMm??Infinity))[0];
  if(stored.length!==placed)violations.push({boxId:'',robot:-1,message:'중복 적재 ID','kind':'geometry'});
  const records=w.records.filter(r=>r.kind==='place'||r.kind==='receive-place');
  return {completion:{placed,total,ratio:total?placed/total:null},capacity:{usedPallets:pallets.length,volumeMm3,utilization:pallets.length&&Number.isFinite(volumeMm3)&&volumeMm3>=0?volumeMm3/(pallets.length*s.pallet.width*s.pallet.depth*s.pallet.maxHeight):null},
    safety:{status:violations.length?'fail':placed?'pass':'unverified',violations,minSupportRatio:minimum(pallets.map(p=>p.minSupportRatio)),minMarginMm:minimum(pallets.map(p=>p.minMarginMm)),minTippingG:minimum(pallets.map(p=>p.minTippingG)),worstBoxId:worst?.worstBoxId??null,worstRobot:worst?.robot??null,robotExecution:'unverified',compression:'unverified'},
    operation:{modeledElapsedSeconds:w.time,throughputPerHour:w.time>0?placed/w.time*3600:null,meanWorkSeconds:records.length?records.reduce((n,r)=>n+r.finished-r.started,0)/records.length:null},robustness:'unverified',pallets};
}
export function evaluateRelay(s:Scenario,w:RelayWorld):RelayEvaluation { return aggregate(s,w,evaluatePallet); }

/** Cache geometry by run/cell version/cycle; safe to call on animation ticks.
 * Stream snapshots deep-clone arrays every tick, but increment cell versions on geometry changes.
 * A changed scenario object or run clears the cache. Mutations must increment the cell version.
 */
export function createRelayEvaluator():typeof evaluateRelay {
  let previousScenario:Scenario|null=null,runId='';
  const cache=new Map<string,{version:number;count:number;result:PalletEvaluation}>();
  return (s,w)=>{
    if(s!==previousScenario||runId!==w.runId){cache.clear();previousScenario=s;runId=w.runId;}
    return aggregate(s,w,(scenario,placements,robot=0,cycle=1,dispatched=false)=>{
      const key=`${dispatched?'closed':'active'}:${robot}:${dispatched?cycle:''}`,version=dispatched?cycle:w.cells[robot].version;
      let cached=cache.get(key);
      if(!cached||cached.version!==version||cached.count!==placements.length){cached={version,count:placements.length,result:evaluatePallet(scenario,placements,robot,cycle,dispatched)};cache.set(key,cached);}
      return {...cached.result,cycle,dispatched};
    });
  };
}
