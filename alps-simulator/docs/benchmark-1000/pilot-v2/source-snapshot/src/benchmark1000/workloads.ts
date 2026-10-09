import {retailScenario} from '../engine/vendor/pallet/capacity/experiment';
import {ArrivalEnvironment} from '../engine/vendor/pallet/environment';
import type {AlgorithmId,Scenario} from '../engine/types';

export const BENCHMARK_ALGORITHMS:AlgorithmId[]=['blb','capacity-compact','strategy-greedy','lookahead','future-hybrid','floor-dense','cluster-layer'];
export const CONDITIONS=[
 {id:'h1200-n30-s6',height:1200,boxes:30,skus:6},
 {id:'h1200-n30-s8',height:1200,boxes:30,skus:8},
] as const;
export type Condition=typeof CONDITIONS[number];
export function workload(c:Condition):Scenario{
 const s=retailScenario(1);
 const added=[
  ['음료',380,260,230,7,50],['주방용품',450,300,210,5,40],
  ['위생용품',280,220,260,3,30],['소형식품',350,280,180,4,35],
 ] as const;
 for(const [i,[name,w,d,h,weight,maxLoadKg]] of added.entries())s.types.push({...structuredClone(s.types[0]),id:`S${7+i}`,name,size:{w,d,h},weight,maxLoadKg,color:'#798ba0'});
 s.types=s.types.slice(0,c.skus).map((t,i)=>({...t,quantity:Math.floor(c.boxes/c.skus)+(i<c.boxes%c.skus?1:0)}));
 s.id=c.id;s.name=`합성 입력 ${c.boxes}개 / ${c.skus} SKU`;s.pallet.maxHeight=c.height;
 s.supplyMode='arrival';s.arrival={seed:0,pattern:'random-draw'};s.events=[];
 return s;
}
export function arrivalSequence(scenario:Scenario,seed:number):string[]{
 const s=structuredClone(scenario);s.arrival={seed,pattern:'random-draw'};s.supplyMode='arrival';
 const env=new ArrivalEnvironment(s);return Array.from({length:env.total},(_,i)=>env.current(i)!.typeId);
}
export function uniqueOrders(scenario:Scenario,n:number,firstSeed:number){
 if(!Number.isInteger(n)||n<1||n>1000)throw Error('Order count must be 1..1000');
 const seen=new Set<string>(),orders:{seed:number;sequence:string[]}[]=[];let rejectedDuplicates=0;
 for(let seed=firstSeed;orders.length<n;seed++){
  if(seed>=firstSeed+100000)throw Error('Insufficient unique orders');
  const sequence=arrivalSequence(scenario,seed),key=sequence.join(',');
  if(seen.has(key)){rejectedDuplicates++;continue;}seen.add(key);orders.push({seed,sequence});
 }
 return {orders,rejectedDuplicates};
}
