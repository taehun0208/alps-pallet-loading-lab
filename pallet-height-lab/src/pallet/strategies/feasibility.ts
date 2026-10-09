import { candidateOrigins,slotKey } from '../candidates';
import { inspectConstraints } from '../constraints';
import { allowedOrientations } from '../orientations';
import { virtualObservation } from '../remainingSites';
import { intersects,top,volume } from '../geometry';
import type { BoxType,Placement,PlanningInput } from '../types';
import type { CriticalInfo,StrategyConfig } from './PackingStrategy';

export const causalInput=(input:PlanningInput):PlanningInput=>({...input,available:undefined,buffer:undefined,types:[],remaining:{},settings:{...input.settings,inventoryMode:'none',policy:'online',candidateMode:'frontier',stockPolicy:undefined,interiorPacking:false}});
export function approachVolume(slot:Placement,config:StrategyConfig){
  return {position:{x:slot.position.x-config.approachMargin,y:slot.position.y-config.approachMargin,z:top(slot)},size:{w:slot.size.w+2*config.approachMargin,d:slot.size.d+2*config.approachMargin,h:config.approachHeight}};
}
export function approachClear(slot:Placement,stack:Placement[],config:StrategyConfig){return !config.approach||!stack.some(b=>intersects(approachVolume(slot,config),b));}
export class Feasibility {
  nodes=0;
  private cache=new Map<string,Placement[]>();
  constructor(readonly input:PlanningInput,readonly config:StrategyConfig){}
  check(type:BoxType,slot:Placement,stack:Placement[]){
    this.nodes++;const observation=virtualObservation(type,`probe-${type.id}`),b={...slot,...observation,size:slot.size,position:slot.position};
    const checked=inspectConstraints(b,observation,stack,this.input.pallet,this.input.constraints);
    return !checked.reasons.length&&approachClear(checked.placement,stack,this.config)?checked.placement:null;
  }
  sites(type:BoxType,stack:Placement[],retain:Placement[]=[]):Placement[]{
    const key=type.id+'|'+stack.map(b=>b.id+':'+slotKey(b)).join(';')+'|'+retain.map(slotKey).join(';');
    const cached=this.cache.get(key);if(cached)return cached;
    const current=virtualObservation(type,`probe-${type.id}`),i={...causalInput(this.input),current,placements:stack,settings:{...causalInput(this.input).settings,maxCandidates:this.config.futureCandidates}};
    const raw=candidateOrigins(i,true).budget;
    const unique=new Map<string,Placement>();
    // Re-test all BEFORE sites, then add newly generated sites. A changed candidate budget/order
    // must not manufacture a 1 -> 0 loss by dropping a previously known feasible position.
    const proposals=[...retain,...raw.map(r=>({...current,...r,supports:[],supportRatio:0,loadAbove:0}))];
    const seen=new Set<string>();
    for(const slot of proposals){const key=slotKey(slot);if(seen.has(key))continue;seen.add(key);const valid=this.check(type,slot,stack);if(valid)unique.set(key,valid);}
    const result=[...unique.values()];this.cache.set(key,result);return result;
  }
}
export interface Critical extends CriticalInfo { type:BoxType; slots:Placement[]; lowerZ:number }
export function criticalBoxes(input:PlanningInput,config:StrategyConfig,probe:Feasibility):Critical[]{
  const pending=input.types.filter(t=>(input.remaining[t.id]||0)>0),maxVolume=Math.max(1,...input.types.map(t=>volume(t.size))),maxWeight=Math.max(.001,...input.types.map(t=>t.weight)),minWeight=Math.min(input.current.weight,...input.types.map(t=>t.weight));
  return pending.map(type=>{
    const slots=probe.sites(type,input.placements),sizes=Object.values(type.size),aspect=Math.max(...sizes)/Math.min(...sizes),orientations=allowedOrientations(type.size,type.orientations,type.handling,type.maxLoadByAxis).length;
    const factors={volume:volume(type.size)/maxVolume,aspect:Math.min(1,(aspect-1)/5),weight:type.weight/maxWeight,orientation:1-Math.max(0,orientations-1)/5,scarcity:1/(1+slots.length)};
    const weights=config.criticalWeights,den=Math.max(.000001,Object.values(weights).reduce((a,b)=>a+b,0)),criticality=Object.entries(factors).reduce((n,[k,v])=>n+v*weights[k as keyof typeof weights],0)/den;
    const lowerZ=Math.min(...slots.map(s=>s.position.z)),lowerBefore=slots.filter(s=>s.position.z<=lowerZ+.001).length;
    return {type,typeId:type.id,quantity:input.remaining[type.id],criticality,factors,shapeCritical:aspect>=3||factors.volume>=.6||slots.length<=2,
      weightCritical:type.weight>=maxWeight*.75&&type.weight>minWeight*1.25,slots,lowerZ,feasibleBefore:slots.length,feasibleAfter:slots.length,lowerBefore,lowerAfter:lowerBefore,lost:0,deadEnd:false};
  }).sort((a,b)=>b.criticality-a.criticality||a.typeId.localeCompare(b.typeId));
}
export function futureLoss(before:number,after:number,mode:StrategyConfig['lossMode']){return Math.max(0,before-after)/(mode==='normalized'?Math.max(1,before):1);}
export function assessCritical(critical:Critical,stack:Placement[],probe:Feasibility,config:StrategyConfig){
  const slots=probe.sites(critical.type,stack,critical.slots),after=slots.length;
  const {type:_,slots:__,lowerZ,...info}=critical;
  const result:CriticalInfo={...info,feasibleAfter:after,lowerAfter:slots.filter(s=>s.position.z<=lowerZ+.001).length,lost:futureLoss(info.feasibleBefore,after,config.lossMode),deadEnd:info.feasibleBefore>0&&after===0};
  return {info:result,slots};
}
