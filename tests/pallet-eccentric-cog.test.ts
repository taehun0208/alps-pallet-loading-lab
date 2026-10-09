import { describe,expect,it } from 'vitest';
import { sampleSpecs,validateSpec } from '../src/pallet/packaging/spec';
import { evaluatePallet } from '../src/pallet/relay/evaluation';
import { equilibrium } from '../src/pallet/equilibrium';
import { contactsFor } from '../src/pallet/geometry';
import { scenario } from '../src/pallet/scenarios';
import { assessPalletCom } from '../src/pallet/comAssessment';
import type { Placement } from '../src/pallet/types';

describe('eccentric packaging mass in evaluation and local equilibrium',()=>{
 it('rotates an offset mass center with the actual 90-degree box pose',()=>{
  const spec=sampleSpecs()[5]; // 500×400×300; local CoG=(290,185,140), an explicitly simulated assumption.
  const p:Placement={id:spec.id,typeId:spec.id,position:{x:100,y:200,z:0},size:{w:400,d:500,h:300},weight:spec.grossWeight,orientation:90,packaging:spec,supports:[],supportRatio:1,loadAbove:0};
  const before=structuredClone(p),s=scenario(),e=evaluatePallet(s,[p]),solution=equilibrium([p]),moment=solution.moments.get(p.id)!;
  // Engine yaw maps (dx,dy) to (dy,-dx): local=(185,210,140), then add translation.
  expect(e.center).toEqual({x:285,y:410,z:140});
  expect(assessPalletCom(s.pallet,[p]).center).toEqual(e.center);
  expect({x:moment.mx/moment.mass,y:moment.my/moment.mass,z:moment.mz/moment.mass}).toEqual(e.center);
  expect(e.center).not.toEqual({x:300,y:450,z:150});expect(p).toEqual(before);
 });
 it('rejects eccentric upper loads outside local contacts even when their geometric centroid is on the support boundary',()=>{
  const s=scenario();s.constraints.supportRatio=.4;s.constraints.heavyRule='off';s.constraints.stability={maxSlenderness:10,minMarginRatio:0,lateralAccelerationG:0,loadSafetyFactor:1};
  const spec=validateSpec({...sampleSpecs()[0],id:'eccentric',length:400,width:400,height:100,grossWeight:10,centerOfGravity:{x:350,y:200,z:50},minSupportRatio:.4,maxTopLoad:100});
  const lower:Placement={id:'base',typeId:'base',position:{x:0,y:0,z:0},size:{w:200,d:400,h:100},weight:10,orientation:0,supports:[],supportRatio:1,loadAbove:0};
  const upper:Placement={id:spec.id,typeId:spec.id,position:{x:0,y:0,z:100},size:{w:400,d:400,h:100},weight:10,orientation:0,packaging:spec,supports:[],supportRatio:.5,loadAbove:0};upper.supports=contactsFor(upper,[lower],.01);
  const solution=equilibrium([lower,upper]),evaluation=evaluatePallet(s,[lower,upper]);
  expect(solution.violations.some(v=>v.includes('평형 불가'))).toBe(true);
  expect(evaluation.minSupportRatio).toBe(.5);expect(evaluation.violations.some(v=>v.kind==='support')).toBe(true);
  expect(evaluation.minMarginMm).toBe(-150);expect(evaluation.minTippingG).toBe(0);
 });
});
