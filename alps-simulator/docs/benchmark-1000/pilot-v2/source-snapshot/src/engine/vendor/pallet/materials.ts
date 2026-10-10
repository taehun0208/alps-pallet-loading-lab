import { verticalAxis } from './orientations';
import { DEFAULT_STABILITY } from './types';
import type { Material,MaterialData,StabilitySettings,Orientation } from './types';
// Explicit synthetic demo presets; these are not manufacturer ratings or universal material constants.
export const MATERIALS:Record<Material,{name:string;referenceLoadKg:number|null;friction:number}>={
 paper:{name:'종이 / 골판지',referenceLoadKg:20,friction:.45},
 plastic:{name:'플라스틱',referenceLoadKg:80,friction:.35},
 wood:{name:'목재',referenceLoadKg:150,friction:.5},
 unknown:{name:'미지정',referenceLoadKg:null,friction:.6},
};
export function materialInfo(box:MaterialData&{orientation?:Orientation},settings:StabilitySettings=DEFAULT_STABILITY){
 if(box.packaging)return {name:box.packaging.packageType,reference:box.packaging.maxTopLoad,capacity:box.packaging.stackable?box.packaging.maxTopLoad:0,source:'BoxSpec 입력 허용하중',friction:box.friction??.45};
 const profile=MATERIALS[box.material||'unknown'];
 const axis=verticalAxis(box.orientation??0),directional=box.maxLoadByAxis?.[axis],reference=directional??box.maxLoadKg??profile.referenceLoadKg;
 return {name:profile.name,reference,capacity:reference===null?null:reference*(box.strengthFactor??1)/settings.loadSafetyFactor,source:directional!==undefined?'방향별 입력값':box.maxLoadKg!==undefined?(box.maxLoadSource==='synthetic'?'생성 예제값':'입력값'):reference===null?'미검증':'예제값',friction:box.friction??profile.friction};
}
