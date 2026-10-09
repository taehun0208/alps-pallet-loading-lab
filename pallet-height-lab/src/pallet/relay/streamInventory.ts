import {rng,shuffled} from '../rng';
import {scenario} from '../scenarios';
import {ALL_ORIENTATIONS} from '../orientations';
import {DEFAULT_STABILITY} from '../types';
import type {BoxType,Material} from '../types';

export function streamInventory(seed:number,count=96,maxHeight=1600){
 if(!Number.isInteger(seed)||!Number.isInteger(count)||count<8||count>120||!Number.isInteger(maxHeight)||maxHeight<600||maxHeight>2000)throw Error('박스 8–120개 · 높이 600–2000 mm · 정수 시드를 입력하세요.');
 const random=rng(seed),int=(a:number,b:number)=>Math.floor(a+random()*(b-a+1));
 const families=[{name:'넓은 평형',w:[480,760],d:[360,630],h:[90,210]},
  {name:'혼합 중형',w:[270,520],d:[210,450],h:[150,330]},
  {name:'소형',w:[150,330],d:[120,290],h:[75,240]},
  {name:'긴 포장',w:[520,760],d:[140,260],h:[95,230]},
  {name:'높은 포장',w:[250,390],d:[200,350],h:[340,550]},
  {name:'대형 용기',w:[410,640],d:[340,540],h:[220,420]}];
 const colors=['#a9c4b0','#d6b57a','#a5b9d5','#baa7cd','#c9928f','#91bec2','#c6c89b','#cfaa91'];
 const s=scenario('mixed',seed);s.id='continuous-mixed';s.name=`개별 혼합 ${count}개 · 시드 ${seed}`;s.events=[];s.supplyMode='arrival';s.arrival={seed,pattern:'ordered'};
 s.pallet={width:1800,depth:1500,maxHeight};
 s.constraints={...s.constraints,robotMode:'gripper',supportRatio:.92,horizontalGap:0,contactTolerance:1,
  heavyRule:'each',stability:{...DEFAULT_STABILITY,maxSlenderness:1.8,slendernessMode:'hard',minMarginRatio:.12,loadSafetyFactor:1.5},standingHeight:{enabled:true,maxRiseMm:100}};
 s.constraints.gripper={...s.constraints.gripper,payload:35,speed:850,pickSeconds:.65,placeSeconds:.7};
 const seen=new Set<string>();
 s.types=shuffled(Array.from({length:count},(_,i):BoxType=>{
  const f=families[Math.floor(random()*families.length)];let size={w:0,d:0,h:0},key='';
  do{size={w:int(f.w[0],f.w[1]),d:int(f.d[0],f.d[1]),h:int(f.h[0],f.h[1])};key=Object.values(size).join('/');}while(seen.has(key));seen.add(key);
  const material:Material=random()<.52?'paper':random()<.8?'plastic':'wood',fragile=random()<.07,upright=!fragile&&random()<.14;
  const weight=Math.round((size.w*size.d*size.h/1e9*int(35,145)+(material==='wood'?1.4:.25))*100)/100;
  return {id:`M${String(i+1).padStart(3,'0')}`,name:`${f.name} · ${material==='paper'?'골판지':material==='plastic'?'플라스틱':'목재'}`,size,weight,quantity:1,
   orientations:upright?[0,90]:[...ALL_ORIENTATIONS],material,color:colors[int(0,colors.length-1)],maxLoadKg:fragile?0:int(material==='paper'?22:55,material==='paper'?90:190),maxLoadSource:'synthetic',strengthFactor:.85,friction:.55,
   ...(fragile?{handling:'no-top-load' as const}:upright?{handling:'upright' as const}:{})};
 }),random);
 return s;
}
