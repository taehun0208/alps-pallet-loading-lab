import { it,expect } from 'vitest';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment,runScenario,replay } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { planOnline } from '../src/pallet/onlinePlanner';
import { remainingSites } from '../src/pallet/remainingSites';
import { contactsFor } from '../src/pallet/geometry';
import { inspectConstraints } from '../src/pallet/constraints';
import { stability } from '../src/pallet/stability';
import { ONLINE_SEARCH,emptyFrame } from '../src/pallet/types';
import type { BoxType,Placement,Observation,Scenario } from '../src/pallet/types';
const type=(id:string,w:number,d:number,h:number,weight:number,quantity=1):BoxType=>({id,name:id,size:{w,d,h},weight,quantity,orientations:[0],material:'plastic',maxLoadKg:200,color:'#6bcab7'});
const box=(t:BoxType,x=0,y=0,z=0):Placement=>({...t,id:t.id,typeId:t.id,position:{x,y,z},orientation:0,supports:[],supportRatio:1,loadAbove:0});
const observation=(p:Placement):Observation=>({...p,status:'normal',orientationAllowed:[0]});
function fixture():Scenario{const s=scenario('online-task');delete s.generation;s.id='online-fixture';s.pallet={width:600,depth:400,maxHeight:100};s.arrival.pattern='ordered';s.types=[type('light',100,400,100,2),type('large',300,400,100,10)];return s;}

it('task defaults are online unknown arrivals with mandatory heavy order and robot proxy enabled',()=>{const s=scenario('online-task');expect(s.supplyMode).toBe('arrival');expect(s.arrival.pattern).toBe('random-draw');expect(s.constraints.heavyRule).toBe('each');expect(s.constraints.robotMode).toBe('gripper');expect(parseScenario(JSON.stringify(s))).toEqual(s);});

it('uses contact-resultant margins as hard stability and keeps aspect ratio as a quality indicator',()=>{
 const cfg=scenario('online-task').constraints.stability!,tall=box(type('tall',177,211,417,7));expect(stability([tall],cfg).violations).toEqual([]);expect(stability([tall],{...cfg,slendernessMode:'hard'}).violations.join()).toContain('기둥');const excessive=box(type('excessive',100,100,2000,7));expect(stability([excessive],cfg).violations.join()).toContain('누적 무게중심');
});

for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} keeps room for an unseen large heavy box and never changes arrival order`,()=>{
 const s=fixture(),env=new ArrivalEnvironment(s),input=env.input(emptyFrame(),algorithm,ONLINE_SEARCH,'online')!,a=plan(input),chosen=a.candidates.find(c=>c.id===a.selectedId)!;
 expect(input.available).toBeUndefined();expect(a.stockSelection).toBeUndefined();expect(a.online!.currentOnly).toBe(true);expect(chosen.placement.id).toBe('light-01');expect(chosen.remainingCheck).toBe('checked');expect(chosen.reservation!.lostFraction).toBe(0);const r=runScenario(s,algorithm,ONLINE_SEARCH);expect(r.metrics.complete).toBe(true);expect(r.frame.records.map(r=>r.observation.id)).toEqual(['light-01','large-01']);expect(r.frame.placements.every(b=>b.position.z===0)).toBe(true);
 if(algorithm!=='bl'){const centered=a.candidates.find(c=>c.placement.position.x===250&&c.valid);expect(centered).toBeDefined();expect(centered!.reservation!.lostFraction).toBe(1);expect(chosen.placement.position.x).not.toBe(250);}
});

it('rejects full-stock access, and identical public input under different hidden queue seeds gives the same decision',()=>{
 const s=fixture();s.pallet.maxHeight=500;s.types.push(type('third',80,100,60,1,3));s.arrival.pattern='random-draw';const inputs=[];
 for(let seed=1;seed<100&&inputs.length<2;seed++){s.arrival.seed=seed;const env=new ArrivalEnvironment(s),i=env.input(emptyFrame(),'rollout',ONLINE_SEARCH,'r')!;if(i.current.typeId==='light')inputs.push(i);}
 expect(inputs).toHaveLength(2);expect(inputs[0]).toEqual(inputs[1]);const a=plan(inputs[0]),b=plan(inputs[1]);expect(a.selectedId).toBe(b.selectedId);expect(a.virtualSequences).toEqual(b.virtualSequences);expect(Object.keys(inputs[0])).not.toContain('arrival');expect(Object.keys(inputs[0])).not.toContain('events');expect(()=>planOnline({...inputs[0],available:[inputs[0].current]})).toThrow('현재 도착');
});

it('stops at an unplaceable normal arrival rather than selecting the unseen stronger box or overriding the heavy rule',()=>{
 const s=fixture();s.pallet.maxHeight=500;s.types=[type('light',600,400,100,2),type('heavy',600,400,100,10)];const r=runScenario(s,'rollout',ONLINE_SEARCH);expect(r.metrics.count).toBe(1);expect(r.frame.records.map(r=>r.observation.id)).toEqual(['light-01','heavy-01']);expect(r.frame.blocked).toBe(true);expect(r.metrics.reason).toContain('무게 규칙 위반');expect(r.frame.records.at(-1)!.disposition).toBe('blocked');expect(r.frame.excluded).toHaveLength(0);
});

it('one-box reserve probes include ancestor strength and do not treat only the immediate parent as sufficient',()=>{
 const s=fixture();s.pallet={width:400,depth:400,maxHeight:500};s.constraints.robotMode='ideal';s.constraints.heavyRule='off';const base=box({...type('base',400,400,100,10),maxLoadKg:10}),middle=box(type('middle',400,400,100,3),0,0,100);middle.supports=contactsFor(middle,[base],.5);s.types=[type('future',400,400,100,6)];const i=new ArrivalEnvironment(s).input(emptyFrame(),'greedy',ONLINE_SEARCH,'reserve')!;i.remaining={future:1};const sites=remainingSites(i,[base,middle]);expect(sites.fitFraction).toBe(0);expect(sites.types[0].reasons.join()).toContain('재질 허용 지지하중');
});

it('geometry-valid placements fail when the gripper cannot descend, and reserve probes use the same path check',()=>{
 const s=fixture();s.pallet={width:800,depth:400,maxHeight:900};const neighbor=box(type('neighbor',300,300,500,10),300),t=type('current',100,200,100,2),current=box(t,200),o=observation(current);expect(inspectConstraints(current,o,[neighbor],s.pallet,{...s.constraints,robotMode:'ideal'}).reasons).toEqual([]);expect(inspectConstraints(current,o,[neighbor],s.pallet,s.constraints).reasons.join()).toContain('접근 경로 간섭');
});

it('payload includes tool mass and no positive score can rescue an invalid candidate',()=>{
 const s=fixture();s.types=[type('overweight',100,100,100,33)];const i=new ArrivalEnvironment(s).input(emptyFrame(),'rollout',ONLINE_SEARCH,'payload')!,a=plan(i);expect(a.selectedId).toBeNull();expect(a.rejections['설정된 가반하중 초과']).toBeGreaterThan(0);expect(a.candidates.every(c=>!c.valid)).toBe(true);
});

it('rechecks older weight-sharing interfaces when a new load changes reaction fractions',()=>{
 const s=fixture();s.pallet={width:400,depth:300,maxHeight:500};s.constraints.robotMode='ideal';s.constraints.heavyRule='share';const left=box(type('left',200,300,50,6)),right=box(type('right',200,300,50,6),200),beam=box(type('beam',400,300,50,10),0,0,50);beam.supports=contactsFor(beam,[left,right],.5);expect(inspectConstraints(beam,observation(beam),[left,right],s.pallet,s.constraints).reasons).toEqual([]);const upper=box(type('upper',100,300,50,4),0,0,100),check=inspectConstraints(upper,observation(upper),[left,right,beam],s.pallet,s.constraints);expect(check.reasons.join()).toContain('무게 규칙 위반');
});

it('replans actual resized observations, rejects stale dimensions, and records damaged/missing stock conservatively',()=>{
 const s=fixture();s.pallet.maxHeight=500;s.types=[type('A',100,100,100,2,4)];s.events=[{step:1,kind:'resize',size:{w:180,d:147,h:131}},{step:2,kind:'damaged'},{step:3,kind:'missing'}];const r=runScenario(s,'greedy',ONLINE_SEARCH),env=new ArrivalEnvironment(s);expect(r.metrics.complete).toBe(false);expect(r.metrics.missing).toBe(1);expect(r.metrics.excluded).toBe(1);expect(r.frame.records.map(r=>r.disposition)).toEqual(['placed','excluded','missing','placed']);expect(r.frame.placements[0].size).toEqual(s.events[0].size);expect(r.frame.records[0].analysis!.explanation.join()).toContain('규격 수정 관측');
 const stale={...r.frame.placements[0],size:s.types[0].size};expect(inspectConstraints(stale,r.frame.records[0].observation,[],s.pallet,s.constraints).reasons).toContain('관측 치수와 배치 치수 불일치');for(let n=0;n<=r.frame.records.length;n++){const f=replay(r.frame.records,n),current=env.current(f.processed);expect(Object.values(env.remaining(f)).reduce((a,b)=>a+b,0)+(current?1:0)+f.placements.length+f.excluded.length+f.missing.length).toBe(4);}
});

it('uses shared virtual sequences without replacement and a single causal continuation policy',()=>{
 const s=fixture();s.pallet.maxHeight=800;s.types[1].quantity=3;const i=new ArrivalEnvironment(s).input(emptyFrame(),'rollout',ONLINE_SEARCH,'sequences')!,a=plan(i),evaluated=a.candidates.filter(c=>c.future);expect(evaluated.length).toBeGreaterThan(1);for(const c of evaluated){expect(c.future!.sequences).toEqual(a.virtualSequences);expect(c.future!.policies).toEqual(['현재 관측만 쓰는 고정 Greedy']);for(const seq of c.future!.sequences)for(const t of s.types)expect(seq.filter(id=>id===t.id).length).toBeLessThanOrEqual(i.remaining[t.id]);}
});
