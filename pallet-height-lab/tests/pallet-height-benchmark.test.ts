import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scenario } from '../src/pallet/scenarios';
import { runScenario } from '../src/pallet/environment';
import { ONLINE_SEARCH } from '../src/pallet/types';
import { inspectConstraints } from '../src/pallet/constraints';
import { stability } from '../src/pallet/stability';
import { heightSummary } from '../src/pallet/heightSummary';

it('measures high stacking and separates unknown arrival blockage from selectable stock',()=>{
 const high=scenario('high-stack'),base=scenario('online-task');
 expect(high.constraints).toEqual(base.constraints);
 const lower=structuredClone(high);lower.pallet.maxHeight=950;
 const inputs=[base,{...base,supplyMode:'stock-select' as const},high,{...high,supplyMode:'arrival' as const},lower];
 const results=inputs.map((s,i)=>{
  const result=runScenario(s,'greedy',ONLINE_SEARCH),a=result.frame.records.at(-1)?.analysis;
  expect(stability(result.frame.placements,s.constraints.stability).violations).toEqual([]);
  for(const record of result.frame.records)if(record.placement){
   expect(inspectConstraints(record.placement,record.observation,record.before,s.pallet,s.constraints).reasons).toEqual([]);
   expect(record.placement.supportRatio).toBeGreaterThanOrEqual(.95-1e-6);
   expect(record.placement.position.z+record.placement.size.h).toBeLessThanOrEqual(s.pallet.maxHeight);
  }
  expect(result.frame.placements.length+result.frame.excluded.length+result.frame.missing.length+Object.values(result.frame.records.at(-1)!.remaining).reduce((a,b)=>a+b,0)+(result.frame.blocked&&s.supplyMode!=='stock-select'?1:0)).toBe(s.types.reduce((n,t)=>n+t.quantity,0));
  const r={scenario:s,metrics:result.metrics,placements:result.frame.placements,heightAnalysis:heightSummary(result.frame,s),last:{observation:result.frame.records.at(-1)?.observation,rejections:a?.rejections,generated:a?.generated,checked:a?.candidates.length},validation:{allCommittedPlacementsRechecked:true,allFinalSupportMarginsPassed:true,inventoryConserved:true}};
  console.log(i,s.supplyMode,result.metrics.count,result.metrics.height,`${r.heightAnalysis.layers}단`,result.metrics.reason);
  return r;
 });
 expect(results[0].metrics.count).toBe(8);
 expect(results[0].heightAnalysis.headroom).toBe(970);
 expect(results[0].heightAnalysis.bestUpperSupport).toBeLessThan(.95);
 expect(results[1].scenario.types).toEqual(results[0].scenario.types);
 expect(results[1].scenario.constraints).toEqual(results[0].scenario.constraints);
 expect(results[1].metrics.height).toBe(1375);
 expect(results[1].metrics.count).toBe(14);
 expect(results[2].metrics.complete).toBe(true);
 expect(results[2].heightAnalysis.layers).toBe(6);
 expect(results[2].metrics.height).toBe(1472);
 expect(results[3].metrics.complete).toBe(false);
 expect(results[4].metrics.height).toBeLessThanOrEqual(950);
 expect(results[4].metrics.reason).toContain('최대 적재 높이 초과');
 writeFileSync('docs/pallet-height-measurements.json',JSON.stringify({measuredAt:new Date().toISOString(),settings:ONLINE_SEARCH,results},null,2));
},300000);
