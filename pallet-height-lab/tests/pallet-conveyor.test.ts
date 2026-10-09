import {describe,it,expect} from 'vitest';
import {advanceConveyor,beltPosition,beltRoute,beltSeconds,beltStation,beltProgress,CONVEYOR,hasBeltTransit,nextBeltArrival} from '../src/pallet/relay/conveyor';
import {createRelay,planRelay,commitRelay,assertRelayInventory,runRelay} from '../src/pallet/relay/engine';
import {relayDemo} from '../src/pallet/relay/demo';
import {nextRobot,toWorld} from '../src/pallet/relay/layout';
import {operationScenario,canRelease} from '../src/pallet/relay/operations';
import {gripperPath} from '../src/pallet/constraints';
import {tiltPath} from '../src/pallet/tiltRobot';

describe('single conveyor with four independent pickup zones',()=>{
 it('connects every zone on one loop, including the longer return from R4',()=>{
  const p=relayDemo().pallet;
  for(let i=0;i<4;i++){
   expect(beltPosition(i,p,0)).toEqual(beltStation(i,p));
   expect(beltPosition(i,p,1)).toEqual(beltStation(nextRobot(i),p));
   expect(beltPosition(i,p,-10)).toEqual(beltStation(i,p));
   const route=beltRoute(i,p);expect(route.every(v=>v.z===CONVEYOR.deck)).toBe(true);
  }
  expect(beltSeconds(3,p)).toBeGreaterThan(beltSeconds(0,p)*3);
 });
 it('does not pick or release a pallet before a box physically arrives',()=>{
  const s=relayDemo(),w=createRelay(s,42,false),send=planRelay(s,w,'bl').actions.find(a=>a.kind==='send')!;
  const sent=commitRelay(s,w,send),eta=nextBeltArrival(sent);
  expect(hasBeltTransit(sent)).toBe(true);expect(canRelease(sent,0,false,{actions:[]})).toBe(false);
  expect(advanceConveyor(sent,eta-.001)).toBe(sent);
  expect(planRelay(s,sent,'bl').actions.some(a=>a.boxId===send.boxId)).toBe(false);
  const arrived=advanceConveyor(sent,eta),receive=planRelay(s,arrived,'bl').actions.find(a=>a.boxId===send.boxId)!;
  expect(receive.kind).toBe('receive-place');
  expect(()=>commitRelay(s,arrived,receive,eta-.1)).toThrow('도착 전');
  expect(assertRelayInventory(commitRelay(s,arrived,receive,eta))).toBe(true);
 });
 it('holds one metre before an occupied pickup and resumes after the robot exits',()=>{
  const s=relayDemo(),w=createRelay(s,42,false),actions=planRelay(s,w,'bl').actions;
  const send=actions.find(a=>a.robot===0)!,receiver=actions.find(a=>a.robot===1)!;
  const sent=commitRelay(s,w,send,0,send.seconds),original=sent.pads[0].readyAt;
  const busy={action:receiver,started:original,elapsed:0,progress:0};
  const held=advanceConveyor(sent,send.seconds,[busy]);
  expect(held.pads[0].readyAt).toBeCloseTo(original+receiver.seconds+1000/CONVEYOR.speed);
  const beforeExit=original+receiver.seconds-.01;
  const position=beltPosition(0,s.pallet,beltProgress(held.pads[0],0,s.pallet,beforeExit));
  expect(beltStation(1,s.pallet).x-position.x).toBeCloseTo(1000);
  expect(advanceConveyor(held,beforeExit).pads[0].arrived).toBe(false);
  expect(advanceConveyor(held,held.pads[0].readyAt).pads[0].arrived).toBe(true);
 });
 it('uses the real belt deck for pickup and keeps four actions independent',()=>{
  const s=operationScenario(relayDemo(),'amr',160),w=createRelay(s,42,false),d=planRelay(s,w,'bl');
  expect(d.actions).toHaveLength(4);
  for(const a of d.actions){
   if(!a.pickup)continue;
   const box=w.boxes.find(b=>b.observation.id===a.boxId)!.observation;
   const center=toWorld({x:a.pickup.x+box.size.w/2,y:a.pickup.y+box.size.d/2,z:a.pickup.z},a.robot,s.pallet);
   expect(center).toEqual(beltStation(a.robot,s.pallet));
   expect(a.path!.points.find(v=>v.label==='접근 · 집기')!.tcp.z).toBe(CONVEYOR.deck+box.size.h);
  }
 });
 it('includes an elevated source in flat and tilting grip paths',()=>{
  const s=relayDemo(),w=createRelay(s,42,false),a=planRelay(s,w,'bl').actions.find(v=>v.kind==='place')!;
  const box={...w.boxes.find(b=>b.observation.id===a.boxId)!.observation,pickupPosition:a.pickup!},c=a.candidate!.placement;
  for(const path of [gripperPath(c,box,[],s.constraints),tiltPath({...c,orientation:'whd'},box,[],s.constraints,box.pickupPosition)]){
   expect(path.points.find(p=>p.label==='접근 · 집기')!.tcp.z).toBe(CONVEYOR.deck+box.size.h);
  }
 });
 it('conserves all boxes across concurrent completion and belt-only waiting',()=>{
  const s=operationScenario(relayDemo(),'amr',160),states:ReturnType<typeof createRelay>[]=[];
  const result=runRelay(s,'bl',{shuffle:false,progress:w=>{expect(assertRelayInventory(w)).toBe(true);states.push(w);}});
  expect(result.peakConcurrent).toBe(4);expect(result.world.boxes.filter(b=>b.status==='placed')).toHaveLength(8);
  expect(states.some(w=>hasBeltTransit(w))).toBe(true);
  for(const r of result.world.records.filter(r=>r.kind.startsWith('receive'))){
   const sent=result.world.records.find(s=>s.kind==='send'&&s.boxId===r.boxId)!;
   expect(r.started).toBeGreaterThanOrEqual(sent.finished+beltSeconds(sent.robot,s.pallet)-1e-7);
  }
 });
});

