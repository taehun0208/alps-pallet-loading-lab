import {syntheticObserver,type ObservationProvider} from './adapters';
import type {Box,Config,Frame,Observed,Placed} from './types';
import {bounds,makeBoxes,volumes,worldParts} from './shape';
import {assess} from './mechanics';
import {planObserved} from './planner';
import {suctionCandidates,transport} from './grasp';
export function validateConfig(c:Config):void {
 if(!['A','B','C'].includes(c.mode)||!['pallet','roll'].includes(c.environment)||Object.values(c.pallet).some(v=>!Number.isFinite(v)||v<=0)||[c.contactMm,c.penetrationMm,c.deformation,c.edgeMarginMm,c.maxBridgeMm,c.alignmentMm,c.cup.marginMm,c.cup.flatnessMm,c.cup.angleDeg].some(v=>!Number.isFinite(v)||v<0)||Object.values(c.gripper).some(v=>!Number.isFinite(v)||v<=0))throw Error('단위·제약 입력은 유한한 유효 범위여야 합니다.');
 if(!Array.isArray(c.damageKinds)||!c.damageKinds.length||c.damageKinds.some(d=>!['normal','corner','dent','bulge','bottom','tear'].includes(d)))throw Error('형상 시나리오를 한 개 이상 선택하세요.');
 const positive=[c.pallet.width,c.pallet.depth,c.pallet.maxHeight,c.maxCandidates,c.maxEms,c.timeBudgetMs,c.bufferSize,c.maxWait,c.workspaceHeight,c.gripper.speedMmS,c.cup.diameterMm];
 if(positive.some(v=>!Number.isFinite(v)||v<=0)||!Number.isInteger(c.seed)||!Number.isInteger(c.count)||c.count<1||c.count>96||c.bufferSize>12||!Number.isInteger(c.bufferSize)||c.maxCandidates>256||c.maxEms>160||c.maxRetries<0||c.maxRetries>5||c.supportRatio<=0||c.supportRatio>1||c.materialResidual<0||c.materialResidual>1||Object.values(c.noise).some(v=>!Number.isFinite(v)||v<0||v>30)||Object.values(c.weights).some(v=>!Number.isFinite(v)||v<0))throw Error('설정 범위 오류: 물량 1~96, 버퍼 1~12, 후보 ≤256, 재시도 0~5, 지지율 (0,1], 잡음 0~30');
}
export function validateBoxes(boxes:Box[]):void {
 if(!Array.isArray(boxes)||!boxes.length||boxes.length>96||new Set(boxes.map(b=>b.id)).size!==boxes.length)throw Error('박스 수 1~96 및 고유 ID 필요');
 for(const b of boxes){
  if(!b.id||b.id.startsWith('@')||!b.nominal||!b.com||!b.strength||!b.suction||!Array.isArray(b.parts)||!b.parts.length||b.parts.length>64||!Array.isArray(b.masks)||!Array.isArray(b.rotations)||!b.rotations.length||b.rotations.some(r=>r!==0&&r!==90))throw Error('박스 형상·회전 입력 오류');
  if([b.mass,b.nominal.w,b.nominal.d,b.nominal.h].some(v=>!Number.isFinite(v)||v<=0)||Object.values(b.com).some(v=>!Number.isFinite(v))||b.friction<0||!Number.isFinite(b.friction)||b.strength.residual<0||b.strength.residual>1||!Number.isFinite(b.strength.residual)||(b.strength.topLoadKg!==null&&(!Number.isFinite(b.strength.topLoadKg)||b.strength.topLoadKg<0)))throw Error('질량·규격·강도 입력 오류');
  if(!['assumption','measured','research-example','unknown'].includes(b.strength.source)||(b.strength.source==='unknown'&&b.strength.topLoadKg!==null))throw Error('강도 출처 또는 미확인 값 오류');
  if(b.parts.some(p=>Object.values(p).some(v=>!Number.isFinite(v))||Math.min(p.w,p.d,p.h)<=0)||b.masks.some(p=>Object.values(p).some(v=>!Number.isFinite(v))||Math.min(p.w,p.d)<=0))throw Error('형상은 유한 양의 길이여야 합니다.');
  if(!Number.isFinite(b.suction.maxMassKg)||b.suction.maxMassKg<=0||!Number.isFinite(b.suction.maxMomentNm)||b.suction.maxMomentNm<0)throw Error('흡착 가반 조건 오류');
 }
}
export function initialFrame():Frame{return{tick:0,arrived:0,placed:[],observed:[],buffer:[],rejected:[],candidates:[],selected:null,retries:0,waitTicks:0,planningMs:0,executionSeconds:0,alignments:0,events:[],attempts:{pickGeometricPass:0,pickGeometricFail:0,placementPass:0,placementFail:0},incidents:{},done:false};}
export function adjudicate(p:Placed,stack:Placed[],c:Config,chosen?:{x:number;y:number;z?:number}|null){
 const mechanics=assess([...stack,p],c),grasps=chosen===null?[]:suctionCandidates(p.box,c,chosen?[chosen]:undefined),grasp=grasps.find(g=>g.valid&&(chosen?.z===undefined||Math.abs(chosen.z-g.point.z)<=c.contactMm))||null,motion=transport(p,stack,grasp,c);
 return{reasons:[...new Set([...mechanics.reasons,...(!grasp?['grasp']:[]),...motion.reasons])],mechanics,grasp,motion};
}
export class Session {
 readonly boxes:Box[];frame:Frame;private incoming=new Map<string,Observed>();
 constructor(readonly config:Config,boxes?:Box[],private observer:ObservationProvider=syntheticObserver){validateConfig(config);this.boxes=structuredClone(boxes||makeBoxes(config));validateBoxes(this.boxes);this.frame=initialFrame();}
 step():Frame {
  const f=this.frame,c=this.config;if(f.done)return structuredClone(f);f.tick++;f.selected=null;
  const limit=c.features.buffer?c.bufferSize:1;
  while(f.buffer.length<limit&&f.arrived<this.boxes.length){const b=this.boxes[f.arrived++];f.buffer.push({id:b.id,wait:0,attempts:0,reasons:[]});this.incoming.set(b.id,this.observer.capture({box:b,rotation:0,position:{x:0,y:0,z:0}},c,0));f.events.push({tick:f.tick,id:b.id,kind:'도착·관측',reasons:[]});}
  const before=performance.now(),arrived=f.buffer.map(p=>this.incoming.get(p.id)!),result=planObserved(arrived,f.observed,Object.fromEntries(f.buffer.map(p=>[p.id,p.wait])),c,Object.fromEntries(f.buffer.map(p=>[p.id,p.attempts])));f.planningMs+=performance.now()-before;f.candidates=result.candidates;f.selected=result.selected;
  const selected=result.selected;
  if(selected){
   const pending=f.buffer.find(v=>v.id===selected.boxId)!,truth=this.boxes.find(v=>v.id===selected.boxId)!,p:Placed={box:truth,position:{...selected.position},rotation:selected.rotation};
   let verdict=adjudicate(p,f.placed,c,selected.pickPoint||selected.grasp?.point||null);
   if(c.mode==='C'&&c.features.alignment&&verdict.reasons.length&&c.alignmentMm>0){
    // Kinematic trial offsets checked against truth by executor, never silently changing dimensions.
    const offsets=[[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]].slice(0,c.alignmentTrials);
    for(const [x,y] of offsets){const q={...p,position:{x:p.position.x+x*c.alignmentMm,y:p.position.y+y*c.alignmentMm,z:p.position.z}},v=adjudicate(q,f.placed,c,selected.pickPoint||selected.grasp?.point||null);if(!v.reasons.length){p.position=q.position;verdict=v;f.alignments++;f.events.push({tick:f.tick,id:p.box.id,kind:'제한된 기하 정렬 · 접촉력 미검증',reasons:[]});break;}}
   }
   if(verdict.grasp)f.attempts.pickGeometricPass++;else f.attempts.pickGeometricFail++;
   if(!verdict.reasons.length){
    f.placed.push(p);f.observed=f.placed.map(v=>this.observer.capture(v,c,f.tick));f.buffer=f.buffer.filter(v=>v.id!==p.box.id);this.incoming.delete(p.box.id);f.attempts.placementPass++;f.executionSeconds+=verdict.motion.seconds;
    f.selected={...selected,position:p.position,path:verdict.motion.path,assessment:verdict.mechanics,grasp:verdict.grasp};
    f.events.push({tick:f.tick,id:p.box.id,kind:'기하 배치 완료·전체 재관측',reasons:[]});
   }else{
    f.attempts.placementFail++;pending.attempts++;pending.reasons=verdict.reasons;
    for(const r of verdict.reasons)f.incidents[r]=(f.incidents[r]||0)+1;
    f.events.push({tick:f.tick,id:p.box.id,kind:'실행 중단·재관측',reasons:verdict.reasons});
    if(c.mode==='C'&&c.features.replan&&pending.attempts<=c.maxRetries){f.retries++;this.incoming.set(p.box.id,this.observer.capture({box:truth,position:{x:0,y:0,z:0},rotation:0},c,pending.attempts));f.observed=f.placed.map(v=>this.observer.capture(v,c,f.tick));}
    else{f.rejected.push({id:p.box.id,reasons:verdict.reasons});f.buffer=f.buffer.filter(v=>v.id!==p.box.id);}
   }
  }else{
   for(const pending of f.buffer){const seen=f.candidates.filter(v=>v.boxId===pending.id);pending.reasons=[...new Set(seen.flatMap(v=>v.reasons))];if(!seen.length)pending.reasons=[result.capped?'budget':'unavailable'];if(seen.length||pending===f.buffer[0]||(c.mode==='C'&&c.features.buffer&&!result.capped))pending.attempts++;}
   if(c.mode==='C'&&c.features.replan){f.retries++;f.observed=f.placed.map(v=>this.observer.capture(v,c,f.tick));for(const pending of f.buffer)this.incoming.set(pending.id,this.observer.capture({box:this.boxes.find(v=>v.id===pending.id)!,position:{x:0,y:0,z:0},rotation:0},c,pending.attempts));}
  }
  for(const p of f.buffer){p.wait++;f.waitTicks++;if((p.wait>=c.maxWait&&(c.mode==='C'&&c.features.buffer||p.attempts>0))||p.attempts>c.maxRetries){f.rejected.push({id:p.id,reasons:p.reasons.length?p.reasons:['waiting']});this.incoming.delete(p.id);}}
  f.buffer=f.buffer.filter(p=>!f.rejected.some(v=>v.id===p.id));
  f.done=f.arrived===this.boxes.length&&f.buffer.length===0;
  return structuredClone(f);
 }
 run(onFrame?:(frame:Frame)=>void):Frame {const cap=this.boxes.length*(this.config.maxWait+this.config.maxRetries+2)+1;while(!this.frame.done&&this.frame.tick<cap){const f=this.step();onFrame?.(f);}if(!this.frame.done)throw Error('상태기계 상한 초과');return structuredClone(this.frame);}
}
export function metrics(f:Frame,boxes:Box[],c:Config){
 const reasonCounts:Record<string,number>={};for(const p of f.rejected)for(const r of p.reasons)reasonCounts[r]=(reasonCounts[r]||0)+1;
 const v=f.placed.reduce((s,p)=>s+volumes(p.box,p.rotation).occupiedVolume,0),nominal=f.placed.reduce((s,p)=>s+volumes(p.box).nominalVolume,0),input=boxes.reduce((s,p)=>s+volumes(p).nominalVolume,0),check=assess(f.placed,c);
 return{mode:c.mode,seed:c.seed,input:boxes.length,placed:f.placed.length,completion:f.placed.length/boxes.length,unplaced:boxes.length-f.placed.length,reasonCounts,occupiedVolumeMm3:v,utilization:v/(c.pallet.width*c.pallet.depth*c.pallet.maxHeight),nominalFulfilled:nominal/input,heightMm:Math.max(0,...f.placed.map(p=>{const b=bounds(worldParts(p));return b.z+b.h;})),rejectedExecutionEvents:f.incidents,finalViolations:check.reasons,forceResidualKg:check.forceResidualKg,momentResidualKgMm:check.momentResidualKgMm,...f.attempts,retries:f.retries,waitTicks:f.waitTicks,planningMs:f.planningMs,modelExecutionSeconds:f.executionSeconds,unknownStrengthBoxes:f.placed.filter(p=>p.box.strength.topLoadKg===null).length,physicalPickSuccessRate:null,physicalSeal:'미검증',information:'도착한 버퍼만 공개; A/B는 선두만 선택; C는 제한 버퍼 선택',volumeDefinition:'복합 충돌체 외형 합집합 / 팔레트 허용 체적; 재료 부피 아님'};
}
