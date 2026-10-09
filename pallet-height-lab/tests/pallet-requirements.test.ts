import { it,expect } from 'vitest';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment,runScenario,advance,replay } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { inspectConstraints,gripperPath } from '../src/pallet/constraints';
import { withinReach,yawEnvelope } from '../src/pallet/robotReach';
import { observedEvent,replanFrame } from '../src/pallet/replanning';
import { evaluatePattern } from '../src/pallet/patternEvaluation';
import { ONLINE_SEARCH,emptyFrame } from '../src/pallet/types';
import type { BoxType,Placement,Observation } from '../src/pallet/types';
const type=(id:string,w:number,d:number,weight=2):BoxType=>({id,name:id,size:{w,d,h:100},weight,quantity:1,orientations:[0,90],material:'plastic',maxLoadKg:100,color:'#6bcab7'});
const box=(t:BoxType):Placement=>({...t,id:`${t.id}-01`,typeId:t.id,position:{x:0,y:0,z:0},orientation:0,supports:[],supportRatio:1,loadAbove:0});
const observation=(t:BoxType):Observation=>({...t,id:`${t.id}-01`,typeId:t.id,status:'normal',orientationAllowed:t.orientations});
function fixture(){const s=scenario('online-task');delete s.generation;s.arrival.pattern='ordered';s.pallet={width:200,depth:400,maxHeight:100};s.types=[{...type('A',200,400,5),orientations:[0]},{...type('B',300,400),orientations:[0]}];return s;}

it('models 90-degree grip rotation above the stack, resets empty tool yaw, and includes rotation time',()=>{
 const s=scenario('online-task'),t=type('turn',200,300),b={...box(t),orientation:90 as const,size:{w:300,d:200,h:100}},p=gripperPath(b,observation(t),[],s.constraints);
 const turn=p.points.findIndex(p=>p.label==='안전 높이 · 파지 방향 회전');expect(turn).toBeGreaterThan(1);expect(p.points[turn].tcp.z).toBeGreaterThan(b.size.h);expect(p.points[turn].yaw).toBe(90);expect(p.segmentSeconds[turn-1]).toBe(.5);expect(p.points.at(-1)!.yaw).toBe(0);expect(p.seconds).toBeGreaterThan(p.lengthMm/s.constraints.gripper.speed+2);
});
it('checks the swept yaw envelope instead of only its 0 and 90 degree endpoints',()=>{
 expect(yawEnvelope(200,300,0,90).w).toBeCloseTo(Math.hypot(200,300));const s=scenario('online-task'),t=type('turn',200,300),b={...box(t),orientation:90 as const,size:{w:300,d:200,h:100}};s.constraints.gripper={...s.constraints.gripper,width:200,depth:300,margin:0};s.constraints.workspace.xMin=-960;
 expect(inspectConstraints(box(t),observation(t),[],s.pallet,s.constraints).reasons).toEqual([]);expect(inspectConstraints(b,observation(t),[],s.pallet,s.constraints).reasons.join()).toContain('작업공간 밖');
});
it('requires an entire TCP segment to stay in the annulus, including the interior minimum distance',()=>{
 const r={baseX:0,baseY:0,minRadius:100,maxRadius:1500};expect(withinReach({x:-1000,y:0,z:300},{x:1000,y:0,z:300},r)).toBe(false);expect(withinReach({x:-1000,y:200,z:300},{x:1000,y:200,z:300},r)).toBe(true);
});
it('rejects unreachable paths even when the box fits and payload passes',()=>{
 const s=scenario('online-task'),t=type('reach',100,100);s.constraints.reach={baseX:-700,baseY:500,minRadius:0,maxRadius:600};expect(inspectConstraints(box(t),observation(t),[],s.pallet,s.constraints).reasons.join()).toContain('도달 반경');expect(inspectConstraints(box(t),observation(t),[],s.pallet,{...s.constraints,robotMode:'ideal'}).reasons).toEqual([]);
});
it('validates reach and rotation parameters and retains backward compatible scenarios without them',()=>{
 const s=scenario('online-task');s.constraints.reach!.minRadius=2500;expect(()=>parseScenario(JSON.stringify(s))).toThrow('반경');s.constraints.reach!.minRadius=0;s.constraints.gripper.rotationSpeed=0;expect(()=>parseScenario(JSON.stringify(s))).toThrow('회전 속도');delete s.constraints.reach;delete s.constraints.gripper.rotationSpeed;expect(parseScenario(JSON.stringify(s)).constraints.reach).toBeUndefined();
});
it('replans a blocked suffix on a larger pallet without moving or reconsuming confirmed boxes',()=>{
 const s=fixture(),old=runScenario(s,'greedy',ONLINE_SEARCH),snapshot=structuredClone(old.frame),next=structuredClone(s);expect(old.frame.blocked).toBe(true);next.pallet.width=600;
 const f=replanFrame(old.frame,s,next),env=new ArrivalEnvironment(next),input=env.input(f,'greedy',ONLINE_SEARCH,'replanned')!,out=advance(f,input,plan(input));expect(f.processed).toBe(1);expect(f.records).toHaveLength(1);expect(f.placements[0].position).toEqual(snapshot.placements[0].position);expect(input.current.id).toBe('B-01');expect(out.placements).toHaveLength(2);expect(out.records[0].context!.pallet.width).toBe(200);expect(out.records[1].context!.pallet.width).toBe(600);expect(old.frame).toEqual(snapshot);
});
it('rejects conditions that invalidate confirmed geometry and rejects changes to past observations or the arrival process',()=>{
 const s=fixture(),r=runScenario(s,'greedy',ONLINE_SEARCH),next=structuredClone(s);next.pallet.maxHeight=50;expect(()=>replanFrame(r.frame,s,next)).toThrow('확정 적재');next.pallet.maxHeight=100;next.arrival.seed++;expect(()=>replanFrame(r.frame,s,next)).toThrow('시드');next.arrival.seed=s.arrival.seed;next.events=[{step:1,kind:'missing'}];expect(()=>replanFrame(r.frame,s,next)).toThrow('이미 처리');
});
it('uses a corrected current observation for a suffix while preserving its ID and quantities',()=>{
 const s=fixture(),r=runScenario(s,'greedy',ONLINE_SEARCH),next=observedEvent(s,r.frame,{kind:'resize',size:{w:180,d:377,h:80}});next.pallet.width=600;const f=replanFrame(r.frame,s,next),env=new ArrivalEnvironment(next),i=env.input(f,'greedy',ONLINE_SEARCH,'resize')!;
 expect(i.current.id).toBe('B-01');expect(i.current.size).toEqual({w:180,d:377,h:80});expect(i.current.status).toBe('resized');const out=advance(f,i,plan(i));expect(out.records.map(r=>r.observation.id)).toEqual(['A-01','B-01']);expect(out.placements).toHaveLength(2);expect(out.placements[0].size).toEqual(r.frame.placements[0].size);expect(Object.values(env.remaining(out)).reduce((a,b)=>a+b,0)+out.placements.length).toBe(2);
});
it('records live damaged and missing observations without deleting or double counting other stock',()=>{
 const s=fixture(),r=runScenario(s,'greedy',ONLINE_SEARCH);
 for(const kind of ['damaged','missing'] as const){const next=observedEvent(s,r.frame,{kind}),f=replanFrame(r.frame,s,next),env=new ArrivalEnvironment(next),i=env.input(f,'greedy',ONLINE_SEARCH,kind)!,out=advance(f,i,null);expect(out.processed).toBe(2);expect(out.placements).toHaveLength(1);expect(out.excluded.length+out.missing.length).toBe(1);expect(replay(out.records,2)).toEqual(out);expect(Object.values(env.remaining(out)).reduce((a,b)=>a+b,0)+out.placements.length+out.excluded.length+out.missing.length).toBe(2);}
});
it('scores packing, balance, stability and times while coverage bounds an incomplete pattern',()=>{
 const s=fixture();s.pallet.width=600;const r=runScenario(s,'greedy',ONLINE_SEARCH),full=evaluatePattern(r.frame,s),part=evaluatePattern(replay(r.frame.records,1),s);expect(full.valid).toBe(true);expect(full.coverage).toBe(1);expect(full.score).toBeGreaterThan(0);expect(full.score).toBeLessThanOrEqual(100);expect(part.coverage).toBe(.5);expect(part.score).toBeLessThanOrEqual(50);expect(full.dimensions.robotTime).not.toBeNull();
 const bad=structuredClone(r.frame);bad.records[0].placement!.position.x=9999;expect(evaluatePattern(bad,s).valid).toBe(false);expect(evaluatePattern(bad,s).score).toBeNull();const moved=structuredClone(r.frame);moved.placements[0].position.x=9999;expect(evaluatePattern(moved,s).score).toBeNull();
});
it('does not give a verified pattern score for unknown strength or pretend an ideal run has robot timing',()=>{
 const s=fixture();s.pallet.width=600;s.constraints.robotMode='ideal';const r=runScenario(s,'greedy',ONLINE_SEARCH);expect(evaluatePattern(r.frame,s).dimensions.robotTime).toBeNull();s.types.forEach(t=>{t.material='unknown';delete t.maxLoadKg;});const unknown=runScenario(s,'greedy',ONLINE_SEARCH);expect(evaluatePattern(unknown.frame,s).capacityVerified).toBe(false);expect(evaluatePattern(unknown.frame,s).score).toBeNull();
});
