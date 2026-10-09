import {DEFAULT_ORDERING,type Config} from './types';
/** Each run receives the exact same actual boxes, arrival order and planning budget. */
export function orderingJobs(base:Config){
 const parameters={dependencyWeight:base.ordering?.dependencyWeight??DEFAULT_ORDERING.dependencyWeight,removalChecks:base.ordering?.removalChecks??DEFAULT_ORDERING.removalChecks};
 const off={...DEFAULT_ORDERING,enabled:true,dependencyWeight:0,cdg:false,prior:false,equivalence:false,spaceCache:false};
 const job=(label:string,options:Partial<typeof off>,k?:number)=>{const config=structuredClone(base);config.mode='C';config.ordering={...off,removalChecks:parameters.removalChecks,...options};if(k!==undefined){config.features.buffer=true;config.bufferSize=k+1;}return{label,config};};
 return[job('기존 C', {enabled:false}),job('의존성 비용', {dependencyWeight:parameters.dependencyWeight}),job('CDG 제거 검사', {dependencyWeight:parameters.dependencyWeight,cdg:true}),job('이전 위치 재사용',{prior:true}),job('동일 물품 그룹',{equivalence:true}),job('EMS 증분 계산',{spaceCache:true}),job('전체 결합',{...DEFAULT_ORDERING,...parameters,enabled:true}),...[0,1,2,3].map(k=>job('기존 C · 임시 버퍼 '+k,{enabled:false},k))];
}
