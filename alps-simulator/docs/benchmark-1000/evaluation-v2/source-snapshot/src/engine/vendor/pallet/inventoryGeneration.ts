import { rng } from './rng';
import type { BoxType,DimensionRanges,SetGeneration,Material } from './types';
export const DEFAULT_DIMENSIONS:DimensionRanges={w:{min:150,max:760},d:{min:120,max:560},h:{min:90,max:460}};
export const DEFAULT_FIELD={seed:20261004,typeCount:8,totalCount:30,assortment:'individual' as const,dimensions:DEFAULT_DIMENSIONS};
const profiles:{name:string;material:Material;load:[number,number];friction:[number,number];tare:[number,number]}[]=[
 {name:'얇은 골판지',material:'paper',load:[8,28],friction:[.28,.55],tare:[.08,.5]},
 {name:'강화 골판지',material:'paper',load:[24,65],friction:[.3,.6],tare:[.15,.8]},
 {name:'얇은 플라스틱',material:'plastic',load:[12,45],friction:[.2,.5],tare:[.3,1.5]},
 {name:'플라스틱 토트',material:'plastic',load:[38,110],friction:[.25,.65],tare:[.8,3]},
 {name:'목재 포장',material:'wood',load:[40,150],friction:[.35,.7],tare:[1,4]},
];
export function heterogeneousInventory(options:{seed:number;typeCount:number;totalCount:number;assortment?:'individual'|'repeated';dimensions?:DimensionRanges}){
 const {seed,totalCount,typeCount}=options,assortment=options.assortment??'individual',dimensions=structuredClone(options.dimensions??DEFAULT_DIMENSIONS),individual=assortment==='individual',n=individual?totalCount:typeCount;
 if(!Number.isInteger(seed)||!Number.isInteger(totalCount)||totalCount<1||totalCount>120||!['individual','repeated'].includes(assortment)||!Number.isInteger(n)||n<1||n>totalCount)throw Error('랜덤 입력: 전체 수량 1~120, 반복 규격 수는 전체 수량 이하, 시드는 정수여야 합니다.');
 for(const [axis,r] of Object.entries(dimensions))if(!r||!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<50||r.max>2000||r.min>r.max)throw Error(`${axis} 치수 범위는 50~2000 mm 정수이며 최소 ≤ 최대여야 합니다.`);
 if(!dimensions.w||!dimensions.d||!dimensions.h)throw Error('가로·깊이·높이 범위가 모두 필요합니다.');
 const random=rng(seed),integer=(a:number,b:number)=>a+Math.floor(random()*(b-a+1)),between=([a,b]:[number,number])=>a+random()*(b-a),round=(n:number)=>Math.round(n*100)/100,seen=new Set<string>();
 const colors=['#6bcab7','#e8b86a','#80a9e8','#cc97df','#e69ca3','#93c788'];
 const types:BoxType[]=Array.from({length:n},(_,i)=>{
  const profile=profiles[integer(0,profiles.length-1)];let size={w:0,d:0,h:0};
  for(let attempt=0;attempt<100;attempt++){size={w:integer(dimensions.w.min,dimensions.w.max),d:integer(dimensions.d.min,dimensions.d.max),h:integer(dimensions.h.min,dimensions.h.max)};const key=`${size.w}/${size.d}/${size.h}`;if(!seen.has(key)){seen.add(key);break;}if(attempt===99)throw Error('치수 범위가 너무 좁아 서로 다른 박스를 만들 수 없습니다. 범위를 넓히세요.');}
  // Synthetic contents density varies independently per item; packaging material is not the contents density.
  const density=between([35,320]),weight=round(size.w*size.d*size.h/1e9*density+between(profile.tare)),fragile=random()<.08;
  return {id:`B${i+1}`,name:`${profile.name} · ${individual?'개별':'규격'} ${i+1}`,size,weight,quantity:1,orientations:[0,90],color:colors[i%colors.length],material:profile.material,maxLoadKg:fragile?0:round(between(profile.load)),maxLoadSource:'synthetic',strengthFactor:round(between([.55,1])),friction:round(between(profile.friction)),...(fragile?{handling:'no-top-load' as const}:{})};
 });
 if(!individual)for(let i=n;i<totalCount;i++)types[integer(0,n-1)].quantity++;
 const generation:SetGeneration={seed,typeCount:n,totalCount,model:'heterogeneous',assortment,dimensions};return {types,generation};
}
