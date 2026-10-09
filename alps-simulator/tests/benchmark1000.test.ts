import {describe,it,expect} from 'vitest';
import {CONDITIONS,workload,uniqueOrders,arrivalSequence} from '../src/benchmark1000/workloads';
import {runTrial} from '../src/engine/core';
import {DEFAULT_CONFIG} from '../src/engine/config';
import type {PlanningInput} from '../src/engine/types';

describe('1000-order paired benchmark workloads',()=>{
 it('keeps total box count fixed while adding actual SKU specifications',()=>{
  for(const c of CONDITIONS){const s=workload(c);expect(s.types).toHaveLength(c.skus);expect(s.types.reduce((n,t)=>n+t.quantity,0)).toBe(c.boxes);expect(s.pallet.maxHeight).toBe(1200);expect(s.constraints.heavyRule).toBe('off');}
  expect(workload(CONDITIONS[1]).types[7].size).toEqual({w:450,d:300,h:210});
 });
 it('generates 1000 genuinely different SKU orders and reproduces them exactly',()=>{
  const s=workload(CONDITIONS[0]),original=structuredClone(s),a=uniqueOrders(s,1000,460000000);
  expect(new Set(a.orders.map(o=>o.seed)).size).toBe(1000);
  expect(new Set(a.orders.map(o=>o.sequence.join(','))).size).toBe(1000);
  for(const o of a.orders)for(const t of s.types)expect(o.sequence.filter(x=>x===t.id)).toHaveLength(t.quantity);
  expect(a).toEqual(uniqueOrders(s,1000,460000000));expect(s).toEqual(original);
 });
 it('passes the custom workload to all policies without revealing the sequence or arrival seed',async()=>{
  const s=workload(CONDITIONS[1]),original=structuredClone(s),inputs:PlanningInput[]=[];
  const planDecision:Parameters<typeof runTrial>[3]['planDecision']=async request=>{
   inputs.push(request.input);return {candidate:null,planningMs:0,elapsedMs:0,fallback:false,fallbackReason:'no_valid_candidate',validDeadline:true,watchdog:false,simulations:0,completeScenarios:0,message:'No placement in test'};
  };
  const a=await runTrial(DEFAULT_CONFIG,'blb',460000001,{scenario:s,planDecision});
  const b=await runTrial(DEFAULT_CONFIG,'floor-dense',460000001,{scenario:s,planDecision});
  expect(a.arrivals).toHaveLength(30);expect(a.scenario.types).toHaveLength(8);
  expect(a.arrivals.map(o=>o.typeId)).toEqual(arrivalSequence(s,460000001));expect(a.inputFingerprint).toBe(b.inputFingerprint);
  expect(a.unplaced).toHaveLength(30);expect(a.violations).toEqual([]);expect(s).toEqual(original);
  for(const input of inputs){expect(input).not.toHaveProperty('arrival');expect(input).not.toHaveProperty('arrivals');expect(input).not.toHaveProperty('seed');}
  expect(Object.values(inputs[29].remaining).reduce((x,y)=>x+y,0)).toBe(0);
 });
});
