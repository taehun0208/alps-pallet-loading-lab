import {describe,it,expect} from 'vitest';
import {executePlanning} from '../src/engine/planner';
import {validateCandidate} from '../src/engine/validation';
import {defaultCapacityConfig} from '../src/engine/vendor/pallet/capacity/experiment';
import type {AlgorithmId,PlanningInput,Placement} from '../src/engine/types';
const base=defaultCapacityConfig();
function block(id:string,typeId:string,x:number):Placement{return {id,typeId,position:{x,y:0,z:0},size:{w:200,d:200,h:200},weight:2,orientation:0,supports:[],supportRatio:1,loadAbove:0,material:'paper',maxLoadKg:100,maxLoadSource:'synthetic',handling:'upright',friction:.45};}
function fixture():PlanningInput{return {runId:'fixture',stepId:1,pallet:{width:800,depth:200,maxHeight:800},constraints:structuredClone(base.scenario.constraints),types:[],placements:[block('neighbor','S1',0)],current:{id:'current',typeId:'S1',size:{w:200,d:200,h:200},weight:2,status:'normal',orientationAllowed:[0],material:'paper',maxLoadKg:100,maxLoadSource:'synthetic',handling:'upright',friction:.45},remaining:{S1:0},algorithm:'greedy',settings:{...structuredClone(base.settings),maxCandidates:16}};}
const plan=(algorithm:AlgorithmId,input=fixture())=>executePlanning({id:'test',algorithm,input,availableMs:9000,searchBudgetMs:9000,mcts:{depth:1,scenarios:1,maxIterations:1}});
describe('new cluster policies use common feasibility and current observations',()=>{
 it.each(['cluster-floor','cluster-layer','dispersed'] as const)('%s fills a valid floor before stacking and preserves input',algorithm=>{
  const input=fixture(),copy=structuredClone(input),result=plan(algorithm,input);
  expect(result.candidate).not.toBeNull();expect(result.candidate!.placement.position.z).toBe(0);
  expect(validateCandidate(input,result.candidate!).reasons).toEqual([]);expect(input).toEqual(copy);
 });
 it('connects identical SKUs while deliberate dispersal avoids them on the same usable floor',()=>{
  expect(plan('cluster-floor').candidate!.placement.position.x).toBe(200);
  expect(plan('dispersed').candidate!.placement.position.x).toBeGreaterThan(200);
 });
 it.each(['cluster-floor','cluster-layer','dispersed'] as const)('%s cannot bypass payload limits',algorithm=>{
  const input=fixture();input.constraints.gripper.payload=input.constraints.gripper.mass;
  expect(plan(algorithm,input).candidate).toBeNull();
 });
 it('ignores a changed future order outside the public observation contract',()=>{
  const a=fixture(),b=fixture();Object.assign(a,{actualFutureOrder:['S1'],actualArrivalSeed:1});Object.assign(b,{actualFutureOrder:['S6'],actualArrivalSeed:9});
  expect(plan('cluster-layer',a).candidate!.placement).toEqual(plan('cluster-layer',b).candidate!.placement);
 });
});
