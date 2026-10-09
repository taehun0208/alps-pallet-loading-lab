import { isStrategy } from './strategies/PackingStrategy';
import { strategyMetrics } from './strategies/metrics';
import { rng,shuffled } from './scenarios';
import { volume,top,withLoads } from './geometry';
import { balance,loadSummary } from './features';
import { stability } from './stability';
import { plan } from './planner';
import { inspectConstraints } from './constraints';
import { emptyFrame } from './types';
import type { Scenario,Observation,Frame,PlanningInput,SearchSettings,Algorithm,Analysis,Metrics,RunResult,StepRecord } from './types';
export class ArrivalEnvironment {
 #queue:Observation[];
 #pool:Observation[];
 #available:Observation[]=[];
 #draw:()=>number;
 #total:number;
 constructor(readonly scenario:Scenario){
  const pool=scenario.types.flatMap(t=>Array.from({length:t.quantity},(_,i)=>({id:`${t.id}-${String(i+1).padStart(2,'0')}`,typeId:t.id,size:{...t.size},weight:t.weight,status:'normal' as const,orientationAllowed:[...t.orientations],packaging:t.packaging,maxLoadKg:t.maxLoadKg,maxLoadSource:t.maxLoadSource,maxLoadByAxis:t.maxLoadByAxis,handling:t.handling,material:t.material,strengthFactor:t.strengthFactor,friction:t.friction})));
  this.#pool=pool;this.#total=pool.length;this.#draw=rng(scenario.arrival.seed);
  if(scenario.supplyMode==='stock-select'){this.#queue=[];}
  else if(scenario.arrival.pattern==='random-draw'){this.#queue=[];this.#available=pool;}
  else {
   this.#queue=scenario.arrival.pattern==='ordered'?pool:shuffled(pool,this.#draw);
   if(scenario.arrival.pattern==='large-late')this.#queue.sort((a,b)=>volume(a.size)-volume(b.size));
   if(scenario.arrival.pattern==='heavy-late')this.#queue.sort((a,b)=>a.weight-b.weight);
   this.#queue=this.#queue.map((o,i)=>this.#event(o,i));
  }
 }
 #event(o:Observation,index:number){const event=this.scenario.events.find(e=>e.step===index+1);if(!event)return o;const next={...o,status:event.kind==='resize'?'resized' as const:event.kind,...(event.kind==='resize'?{size:{...event.size!}}:{})};if(event.kind==='resize'&&o.packaging){const spec=structuredClone(o.packaging),size=event.size!;spec.centerOfGravity={x:spec.centerOfGravity.x*size.w/spec.length,y:spec.centerOfGravity.y*size.d/spec.width,z:spec.centerOfGravity.z*size.h/spec.height};spec.length=size.w;spec.width=size.d;spec.height=size.h;next.packaging=spec;}return next;}
 current(processed:number){
  if(this.scenario.supplyMode==='stock-select')return null;
  if(!Number.isInteger(processed)||processed<0||processed>=this.#total)return null;
  // Draw uniformly over individual remaining boxes, only when this observation is requested.
  // Cache observations so re-render, pause, replay and branching cannot re-roll a difficult box.
  if(this.scenario.arrival.pattern==='random-draw')while(this.#queue.length<=processed){const index=Math.floor(this.#draw()*this.#available.length),o=this.#available.splice(index,1)[0];this.#queue.push(this.#event(o,this.#queue.length));}
  return structuredClone(this.#queue[processed]);
 }
 available(frame:Frame){const used=new Set(frame.records.filter(r=>r.disposition!=='blocked').map(r=>r.observation.id));return structuredClone(this.#pool.filter(o=>!used.has(o.id)).map(o=>{const held=frame.buffer?.find(h=>h.observation.id===o.id);return held?{...o,pickupPosition:held.source}:o;}));}
 currentFor(frame:Frame,analysis?:Analysis|null){if(this.scenario.supplyMode!=='stock-select')return this.current(frame.processed);const stock=this.available(frame);return stock.find(o=>o.id===analysis?.selectedBoxId)||stock[0]||null;}
 get total(){return this.#total;}
 get sampledCount(){return this.scenario.arrival.pattern==='random-draw'?this.#queue.length:0;}
 remaining(frame:Frame){const counts=Object.fromEntries(this.scenario.types.map(t=>[t.id,t.quantity]));for(const r of frame.records)if(r.disposition!=='blocked')counts[r.observation.typeId]--;const current=this.scenario.supplyMode==='stock-select'?null:this.current(frame.processed);if(current)counts[current.typeId]--;return counts;}
 input(frame:Frame,algorithm:Algorithm,settings:SearchSettings,runId:string):PlanningInput|null{
  const current=this.currentFor(frame);if(!current||frame.blocked)return null;
  // Deliberate projection: neither arrival configuration, events, hidden queue nor arrival RNG crosses this boundary.
  return {runId,stepId:frame.processed,pallet:structuredClone(this.scenario.pallet),types:structuredClone(this.scenario.types),constraints:structuredClone(this.scenario.constraints),placements:structuredClone(frame.placements),current,remaining:this.remaining(frame),...(this.scenario.supplyMode==='stock-select'?{available:this.available(frame),buffer:structuredClone(frame.buffer||[])}:{}),algorithm,settings:structuredClone(settings),...(isStrategy(algorithm)?{strategyState:structuredClone([...frame.records].reverse().find(r=>r.analysis?.strategyState)?.analysis?.strategyState)}:{})};
 }
}
export function advance(frame:Frame,input:PlanningInput,analysis:Analysis|null):Frame{
 if(frame.blocked||input.stepId!==frame.processed)return frame;
 if(analysis&&(analysis.runId!==input.runId||analysis.stepId!==input.stepId))return frame;
 const o=input.available?.find(o=>o.id===analysis?.selectedBoxId)||input.current,proposed=analysis?.candidates.find(c=>c.id===analysis.selectedId&&c.valid&&c.placement.id===o.id&&c.placement.typeId===o.typeId),finalCheck=proposed?inspectConstraints(proposed.placement,o,frame.placements,input.pallet,input.constraints):null;
 // Recheck the promised return site at commit, not just the candidate being placed.
 const held=analysis?.bufferPlan?.held??frame.buffer??[],after=finalCheck?.stack||frame.placements;
 const bufferValid=held.length<=1&&(frame.buffer||[]).every(h=>h.observation.id===o.id||held.some(v=>v.observation.id===h.observation.id))&&held.every(h=>{
  const box=input.available?.find(v=>v.id===h.observation.id);return box&&box.id!==o.id&&h.reservedTop.id===box.id&&h.reservedTop.position.z>=Math.max(0,...after.map(top))&&
   !inspectConstraints(h.reservedTop,{...box,pickupPosition:h.source},after,input.pallet,input.constraints).reasons.length;
 });
 const chosen=proposed&&finalCheck&&!finalCheck.reasons.length&&bufferValid?{...proposed,placement:finalCheck.placement,path:finalCheck.path}:undefined,disposition=o.status==='damaged'?'excluded':o.status==='missing'?'missing':chosen?'placed':'blocked';
 const remaining={...input.remaining};if(input.available&&disposition!=='blocked')remaining[o.typeId]--;
 const reason=disposition==='excluded'?'시나리오에서 손상으로 표시되어 격리했습니다.':disposition==='missing'?'시나리오의 누락 이벤트로 재고를 수정했습니다.':disposition==='blocked'?(!bufferValid?'임시 대기 박스의 상단 복귀 위치를 보존할 수 없음':'')||finalCheck?.reasons.join(' / ')||Object.keys(analysis?.rejections||{}).join(' / ')||'유효 후보 없음':'';
 const placements=disposition==='placed'?finalCheck!.stack:frame.placements;
 const buffer=disposition==='placed'&&analysis?.bufferPlan?structuredClone(analysis.bufferPlan.held):frame.buffer;
 const record:StepRecord={...(frame.replanCount?{replanCount:frame.replanCount}:{}),...(buffer!==undefined?{bufferBefore:structuredClone(frame.buffer||[]),bufferAfter:buffer}:{}),context:{pallet:structuredClone(input.pallet),constraints:structuredClone(input.constraints)},step:frame.processed+1,observation:structuredClone(o),disposition,placement:chosen?.placement,before:frame.placements,after:placements,analysis,remaining,algorithm:input.algorithm,plannerSeed:input.settings.plannerSeed,reason,path:chosen?.path,settings:structuredClone(input.settings)};
 return {...(frame.replanCount?{replanCount:frame.replanCount}:{}),...(buffer!==undefined?{buffer}:{}),processed:frame.processed+(disposition==='blocked'?0:1),placements,excluded:disposition==='excluded'?[...frame.excluded,o]:frame.excluded,missing:disposition==='missing'?[...frame.missing,o]:frame.missing,blocked:disposition==='blocked',reason,records:[...frame.records,record]};
}
export function replay(records:StepRecord[],count:number):Frame {
 let f=emptyFrame();for(const r of records.slice(0,count)){f={...(r.replanCount?{replanCount:r.replanCount}:{}),...(r.bufferAfter!==undefined?{buffer:structuredClone(r.bufferAfter)}:f.buffer?{buffer:f.buffer}:{}),processed:f.processed+(r.disposition==='blocked'?0:1),placements:r.disposition==='placed'?r.after:f.placements,excluded:r.disposition==='excluded'?[...f.excluded,r.observation]:f.excluded,missing:r.disposition==='missing'?[...f.missing,r.observation]:f.missing,blocked:r.disposition==='blocked',reason:r.reason,records:[...f.records,r]};}return f;
}
export function metrics(frame:Frame,s:Scenario):Metrics{
 const v=frame.placements.reduce((a,b)=>a+volume(b.size),0),weight=frame.placements.reduce((a,b)=>a+b.weight,0),height=Math.max(0,...frame.placements.map(top)),times=frame.records.flatMap(r=>r.analysis?[r.analysis.milliseconds]:[]).sort((a,b)=>a-b),percentile=(p:number)=>times.length?times[Math.min(times.length-1,Math.ceil(times.length*p)-1)]:0;
 const stable=stability(frame.placements,s.constraints.stability);
 return {...loadSummary(frame.placements,s.constraints.stability),slenderness:stable.slenderness,supportBalances:stable.supports,count:frame.placements.length,volume:v,weight,height,utilization:v/(s.pallet.width*s.pallet.depth*s.pallet.maxHeight),efficiency:height?v/(s.pallet.width*s.pallet.depth*height):0,...balance(frame.placements,s.pallet),distanceM:frame.records.reduce((a,b)=>a+(b.disposition==='placed'?(b.path?.lengthMm||0):0),0)/1000,workSeconds:frame.records.reduce((a,b)=>a+(b.disposition==='placed'&&b.path?.model!=='ideal'?(b.path?.seconds||0):0),0),medianMs:times.length?(times[Math.floor((times.length-1)/2)]+times[Math.floor(times.length/2)])/2:0,p95Ms:percentile(.95),totalMs:times.reduce((a,b)=>a+b,0),complete:frame.placements.length===s.types.reduce((a,b)=>a+b.quantity,0),failedStep:frame.blocked?frame.processed+1:null,reason:frame.reason,excluded:frame.excluded.length,missing:frame.missing.length};
}
export function runScenario(s:Scenario,algorithm:Algorithm,settings:SearchSettings,runId=`${algorithm}-${s.arrival.seed}`,progress?:(f:Frame)=>void):RunResult{
 const env=new ArrivalEnvironment(s);let frame=emptyFrame();while(!frame.blocked&&frame.processed<env.total){const input=env.input(frame,algorithm,settings,runId)!;frame=advance(frame,input,input.current.status==='damaged'||input.current.status==='missing'?null:plan(input));progress?.(frame);}
 return {runId,algorithm,seed:s.arrival.seed,settings,frame,metrics:{...metrics(frame,s),strategyDetails:strategyMetrics(frame,s,algorithm)}};
}
