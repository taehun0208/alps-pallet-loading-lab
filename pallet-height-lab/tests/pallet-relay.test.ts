import { advanceConveyor,nextBeltArrival } from '../src/pallet/relay/conveyor';
import { it,expect } from 'vitest';
import { createRelay,planRelay,commitRelay,assertRelayInventory,runRelay,canForward } from '../src/pallet/relay/engine';
import { relayDemo,relayStorageDemo } from '../src/pallet/relay/demo';
import { ROBOT_COUNT,nextRobot,toWorld,toLocal,worldBox } from '../src/pallet/relay/layout';
import { motionsConflict } from '../src/pallet/relay/motion';
it('starts independent arms together and completes receivers directly from the shared pad',()=>{
 const s=relayDemo(),w=createRelay(s,42,false),d=planRelay(s,w,'bl');
 expect(d.actions).toHaveLength(4);
 for(const a of d.actions)for(const b of d.actions)if(a!==b)expect(motionsConflict(s,w,a,b)).toBe(false);
 const result=runRelay(s,'bl',{shuffle:false});
 expect(result.peakConcurrent).toBe(4);expect(result.world.boxes.filter(b=>b.status==='placed')).toHaveLength(8);
 expect(result.world.records.filter(r=>r.kind==='receive-place')).toHaveLength(2);expect(result.world.cells[1].placements.map(p=>p.id)).toContain('A1-01');expect(assertRelayInventory(result.world)).toBe(true);
 expect(result.elapsed).toBeLessThan(result.world.records.reduce((n,r)=>n+r.finished-r.started,0));
});
it('commits disjoint actions even after another cell revision changes; never duplicates stale actions',()=>{
 const s=relayDemo(),w=createRelay(s,42,false),actions=planRelay(s,w,'bl').actions,first=actions[0];let next=w;
 for(const a of actions){next=commitRelay(s,next,a,0,a.seconds);expect(assertRelayInventory(next)).toBe(true);}
 expect(()=>commitRelay(s,next,first)).toThrow('지난');expect(()=>commitRelay(s,w,{...first,runId:'old'})).toThrow('지난');
 expect(next.pads[0].boxId).toBe('A1-01');expect(next.boxes.find(b=>b.observation.id==='A1-01')?.status).toBe('staged');
});
it('the receiving arm stores a box if direct packing would obstruct its own larger foundation',()=>{
 const s=relayDemo(),w=createRelay(s,42,false),send=planRelay(s,w,'bl').actions.find(a=>a.kind==='send')!;let next=commitRelay(s,w,send);next=advanceConveyor(next,nextBeltArrival(next));
 // The receiver still needs a wide foundation; the cap cannot be placed without blocking it.
 const f=next.boxes.find(b=>b.observation.id==='F1-01')!;next.cells[0].queue=next.cells[0].queue.filter(id=>id!==f.observation.id);next.cells[1].queue.push(f.observation.id);f.owner=1;f.visited=[1];
 expect(assertRelayInventory(next)).toBe(true);const receive=planRelay(s,next,'bl').actions.find(a=>a.robot===1)!;
 expect(receive.kind).toBe('receive-queue');next=commitRelay(s,next,receive);expect(next.pads[0].boxId).toBe(null);expect(next.cells[1].queue).toContain(send.boxId);expect(next.boxes.find(b=>b.observation.id===send.boxId)?.visited).toEqual([0,1]);
});
it('keeps a staged box while the receiver is busy, and only locks the conflicting resources',()=>{
 const s=relayDemo(),w=createRelay(s,42,false),d=planRelay(s,w,'bl'),send=d.actions.find(a=>a.robot===0)!,receiver=d.actions.find(a=>a.robot===1)!;
 const staged=commitRelay(s,w,send),decision=planRelay(s,staged,'bl',undefined,true,[receiver]);
 expect(staged.pads[0].boxId).toBe(send.boxId);expect(decision.actions.some(a=>a.robot===1)).toBe(false);expect(decision.actions.some(a=>a.robot===0&&a.kind==='place')).toBe(true);
 expect(motionsConflict(s,w,send,{...send,robot:1})).toBe(true);
});
it('rejects revisits, nonadjacent ownership and invalid payload while retaining every box',()=>{
 const s=relayDemo(),w=createRelay(s,42,false),a=planRelay(s,w,'bl').actions.find(a=>a.kind==='send')!;
 expect(()=>commitRelay(s,w,{...a,to:2})).toThrow('인접');w.boxes.find(b=>b.observation.id===a.boxId)!.forwardedAt[0]=0;expect(()=>commitRelay(s,w,a)).toThrow('재순환');
 const bad=relayDemo();bad.constraints.gripper.payload=0.1;const r=runRelay(bad,'bl',{shuffle:false});expect(r.world.records).toHaveLength(0);expect(assertRelayInventory(r.world)).toBe(true);
});
it('handles R4 to R1 with reversible cell coordinates',()=>{
 const s=relayDemo(),w=createRelay(s,42,false),old=w.cells;w.cells=[...old.slice(1),old[0]];w.boxes.forEach(b=>{b.owner=(b.owner+ROBOT_COUNT-1)%ROBOT_COUNT;b.visited=[b.owner];});w.cursor=ROBOT_COUNT-1;
 const send=planRelay(s,w,'bl').actions.find(a=>a.robot===ROBOT_COUNT-1)!;expect(send).toMatchObject({kind:'send',to:0});let next=commitRelay(s,w,send);next=advanceConveyor(next,nextBeltArrival(next));const receive=planRelay(s,next,'bl').actions.find(a=>a.robot===0)!;expect(receive.kind).toBe('receive-place');next=commitRelay(s,next,receive);expect(next.boxes.find(b=>b.observation.id===send.boxId)?.visited).toEqual([ROBOT_COUNT-1,0]);
 for(let i=0;i<ROBOT_COUNT;i++){const p={x:213,y:471,z:348},r=toLocal(toWorld(p,i,s.pallet),i,s.pallet);expect(r.x).toBeCloseTo(p.x);expect(r.y).toBeCloseTo(p.y);expect(nextRobot(i)).toBe((i+1)%ROBOT_COUNT);}
});

it('stores staged boxes, builds foundations and then uses the held stock without returning to a visited robot',()=>{
 const r=runRelay(relayStorageDemo(),'bl',{shuffle:false});
 expect(r.peakConcurrent).toBe(4);expect(r.world.records.filter(r=>r.kind==='receive-queue').length).toBeGreaterThan(0);expect(r.world.records.filter(r=>r.kind==='send')).toHaveLength(4);expect(r.world.boxes.filter(b=>b.status==='placed')).toHaveLength(8);expect(assertRelayInventory(r.world)).toBe(true);
 for(const b of r.world.boxes)expect(new Set(b.visited).size).toBe(b.visited.length);
});

it('preserves box dimensions across the four parallel work cells',()=>{
 const p=relayDemo().pallet,b={position:{x:0,y:0,z:20},size:{w:400,d:200,h:100}} as any;
 const transformed=worldBox(b,1,p);expect(transformed.size.w).toBeCloseTo(400);expect(transformed.size.d).toBeCloseTo(200);
});
it('circulates through R4 back to R1 once, then stops if no pallet changes',()=>{
 const s=relayDemo();s.types=[{...s.types[0],handling:undefined,size:{w:180,d:180,h:100},maxLoadKg:50}];s.pallet={width:100,depth:100,maxHeight:500};
 const r=runRelay(s,'bl',{shuffle:false});expect(r.world.records.filter(v=>v.kind==='send')).toHaveLength(4);
 expect(r.world.boxes[0].visited).toEqual([0,1,2,3,0]);expect(r.world.boxes[0].status).toBe('queued');expect(assertRelayInventory(r.world)).toBe(true);
});
it('allows another circuit only after committed packing progress',()=>{
 const s=relayDemo(),w=createRelay(s,42,false),id=w.cells[0].queue[0];w.boxes.find(b=>b.observation.id===id)!.forwardedAt[0]=0;expect(canForward(w,id,0)).toBe(false);
 const a=planRelay(s,w,'bl').actions.find(a=>a.kind==='place')!;const next=commitRelay(s,w,a);expect(canForward(next,id,0)).toBe(true);
});
