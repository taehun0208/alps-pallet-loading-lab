import { scenario,rng } from './scenarios';
import { heterogeneousInventory,DEFAULT_FIELD } from './inventoryGeneration';
import type { Scenario,DimensionRanges } from './types';
export interface RandomSetSettings { seed:number;arrivalSeed:number;typeCount:number;totalCount:number;gridMm?:number;densityKgM3?:number;model?:'heterogeneous'|'legacy-grid';assortment?:'individual'|'repeated';dimensions?:DimensionRanges;arrivalPattern?:'shuffle'|'random-draw' }
export const DEFAULT_RANDOM:RandomSetSettings={...DEFAULT_FIELD,model:'heterogeneous',arrivalSeed:42,arrivalPattern:'random-draw'};
export const LEGACY_RANDOM:RandomSetSettings={seed:20261003,arrivalSeed:42,typeCount:5,totalCount:30,gridMm:50,densityKgM3:120,model:'legacy-grid'};
// Separate streams: changing arrivalSeed never changes the generated box set.
export function randomScenario(options:RandomSetSettings=DEFAULT_RANDOM):Scenario{
 const {seed,arrivalSeed,typeCount,totalCount}=options,gridMm=options.gridMm??50,densityKgM3=options.densityKgM3??120;
 if(options.arrivalPattern!==undefined&&!['shuffle','random-draw'].includes(options.arrivalPattern))throw Error('입고 방식은 shuffle / random-draw 중 선택합니다.');
 if(options.model==='heterogeneous'||options.model===undefined&&options.gridMm===undefined){if(!Number.isInteger(arrivalSeed))throw Error('입고 시드는 정수여야 합니다.');const input=heterogeneousInventory(options),s=scenario();s.id='random';s.name=`서로 다른 혼합 박스 · ${seed}`;s.types=input.types;s.generation=input.generation;s.arrival={seed:arrivalSeed,pattern:options.arrivalPattern??'random-draw'};return s;}
 if(options.model!==undefined&&options.model!=='legacy-grid')throw Error('지원하지 않는 생성 모델입니다.');
 if(!Number.isInteger(seed)||!Number.isInteger(arrivalSeed)||!Number.isInteger(typeCount)||typeCount<1||typeCount>12||!Number.isInteger(totalCount)||totalCount<typeCount||totalCount>120||!Number.isFinite(gridMm)||gridMm<10||gridMm>100||!Number.isFinite(densityKgM3)||densityKgM3<10||densityKgM3>300)throw Error('랜덤 입력: 종류 1~12, 전체 수량 종류 수~120, 치수 단위 10~100 mm, 밀도 10~300 kg/m³, 시드는 정수입니다.');
 const random=rng(seed),integer=(a:number,b:number)=>a+Math.floor(random()*(b-a+1)),size=(a:number,b:number)=>integer(Math.ceil(a/gridMm),Math.floor(b/gridMm))*gridMm;
 const s=scenario();s.id='random';s.name=`랜덤 박스 세트 · ${seed}`;s.constraints.robotMode='ideal';s.arrival={seed:arrivalSeed,pattern:options.arrivalPattern??'shuffle'};s.generation={seed,typeCount,totalCount,model:'legacy-grid',gridMm,densityKgM3};
 const colors=['#6bcab7','#e8b86a','#80a9e8','#cc97df','#e69ca3','#93c788'];
 s.types=Array.from({length:typeCount},(_,i)=>{const w=size(200,600),d=size(200,500),h=size(150,350),material=i%3===0?'plastic' as const:'paper' as const;
  return {id:`R${i+1}`,name:`랜덤 ${i+1}`,size:{w,d,h},weight:Math.round(w*d*h/1e9*densityKgM3*100)/100,quantity:1,orientations:[0,90],color:colors[i%colors.length],material,strengthFactor:1};});
 for(let i=typeCount;i<totalCount;i++)s.types[integer(0,typeCount-1)].quantity++;
 return s;
}
