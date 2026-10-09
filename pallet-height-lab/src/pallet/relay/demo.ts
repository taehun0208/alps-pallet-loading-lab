import { ROBOT_COUNT } from './layout';
import { rng } from '../rng';
import { ALL_ORIENTATIONS } from '../orientations';
import { scenario } from '../scenarios';
import type { BoxType } from '../types';
export function relayDemo(){
 const s=scenario('buffer-demo');s.id='relay-demo';s.name='4대 협업 · 방해 박스 인접 전달';s.pallet={width:800,depth:600,maxHeight:900};
 const cap=(id:string):BoxType=>({id,name:'지금 놓으면 큰 받침을 막는 박스',size:{w:400,d:400,h:100},weight:1,quantity:1,orientations:[0],handling:'no-top-load',material:'paper',maxLoadKg:0,color:'#ce9be1'});
 const small=(id:string):BoxType=>({id,name:'옆 로봇의 소형 재고',size:{w:180,d:190,h:110},weight:1,quantity:1,orientations:[0,90],material:'plastic',maxLoadKg:50,color:'#84aef0'});
 const base=(id:string):BoxType=>({id,name:'넓은 받침 · 먼저 배치 필요',size:{w:760,d:550,h:200},weight:10,quantity:1,orientations:[0],material:'plastic',maxLoadKg:100,color:'#73cdb8'});
 s.types=[...Array.from({length:ROBOT_COUNT},(_,i)=>i%2===0?cap(`A${i+1}`):small(`B${i+1}`)),...Array.from({length:ROBOT_COUNT},(_,i)=>i%2===0?base(`F${i+1}`):small(`C${i+1}`))];return s;
}
export function relayStorageDemo(){
 const s=relayDemo(),cap=s.types[0],base=s.types[ROBOT_COUNT];s.id='relay-storage-demo';s.name='4대 동시 전달 · 받는 팔의 자기 재고 보관';
 s.types=[...Array.from({length:ROBOT_COUNT},(_,i)=>({...structuredClone(cap),id:`A${i+1}`})),...Array.from({length:ROBOT_COUNT},(_,i)=>({...structuredClone(base),id:`F${i+1}`}))];return s;
}

export function relayHeightDemo(seed=42,maxHeight=1600){
 const s=scenario('mixed',seed),random=rng(seed);s.id='relay-height';s.name=`4대 높이 채우기 · 혼합 16종 192개 · 시드 ${seed}`;s.supplyMode='stock-select';
 s.pallet={width:1000,depth:800,maxHeight};s.constraints.stability!.slendernessMode='score';s.constraints.gripper.payload=35;
 s.constraints.standingHeight={enabled:true,maxRiseMm:100};
 s.types=Array.from({length:16},(_,i)=>{
  const material=i%3===0?'paper':'plastic';
  return {id:`H${i+1}`,name:`${material==='paper'?'강화 골판지':'플라스틱'} 혼합 ${i+1}`,size:{w:Math.round(380+random()*330),d:Math.round(300+random()*230),h:Math.round(150+random()*190)},weight:Math.round((3+random()*4)*100)/100,quantity:12,orientations:[...ALL_ORIENTATIONS],material,maxLoadKg:material==='paper'?80:160,maxLoadSource:'synthetic' as const,color:['#73cdb8','#e7b968','#84aef0','#cf9be1','#f39b83','#92d37e','#79d4e4','#e19cbd'][i%8]};
 });
 return s;
}
