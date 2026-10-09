import type { BoxType,Constraints,Orientation,Scenario,Vec3 } from '../types';
// Practical-cell assumptions (simulation only; not verified hardware data).
export interface PracticalSettings { rotation:'upright'|'xyz';tool:'vacuum'|'jaw'|'cradle';positionErrorMm:number;yawErrorDeg:number;jig:boolean;jigTravelMm:number;jigAngleDeg:number;weightPolicy:'capacity'|'legacy';assumeAxisLoads:boolean;sideLoadFactor:number }
export const DEFAULT_PRACTICAL:PracticalSettings={rotation:'xyz',tool:'vacuum',positionErrorMm:6,yawErrorDeg:1.5,jig:true,jigTravelMm:12,jigAngleDeg:3,weightPolicy:'capacity',assumeAxisLoads:true,sideLoadFactor:.6};
export const TOOL_NAMES:Record<PracticalSettings['tool'],string>={vacuum:'진공 흡착 그리퍼',jaw:'조(Jaw) 그리퍼',cradle:'크래들 그리퍼'};
export const PAYLOAD_LIMIT_KG=35;
// Scale factors are >= 1 so the envelope never shrinks below the existing gripper.
const TOOL_PROFILES:Record<PracticalSettings['tool'],{scale:Vec3;massFactor:number;payloadFactor:number}>={
  vacuum:{scale:{x:1,y:1,z:1},massFactor:1,payloadFactor:1},
  jaw:{scale:{x:1.15,y:1.15,z:1.1},massFactor:1.25,payloadFactor:.85},
  cradle:{scale:{x:1.3,y:1.3,z:1.2},massFactor:1.5,payloadFactor:1}};
type BaseType={sig:string;orientations:Orientation[];axes?:BoxType['maxLoadByAxis']};
export interface PracticalProfile { name:string;mass:number;payload:number;source:'simulation-assumption';baseGripper:Constraints['gripper'];baselineHeavyRule:Constraints['heavyRule'];baseTypes:Record<string,BaseType> }
export type PracticalConfig=PracticalSettings&{profile:PracticalProfile};
export type PracticalScenario=Scenario;
export interface PlacementResolution { planned:Vec3;actual:Vec3;offsetMm:number;yawDeg:number;rawOffsetMm:number;rawYawDeg:number;corrected:boolean;reasons:string[] }
const RANGES:[keyof PracticalSettings,number,number][]=[['positionErrorMm',0,50],['yawErrorDeg',0,15],['jigTravelMm',0,100],['jigAngleDeg',0,15]];
export function validatePractical(cfg:PracticalSettings):string[] {
  const bad:string[]=[];
  if(!['upright','xyz'].includes(cfg.rotation)) bad.push('rotation');
  if(!(cfg.tool in TOOL_NAMES)) bad.push('tool');
  if(!['capacity','legacy'].includes(cfg.weightPolicy)) bad.push('weightPolicy');
  if(typeof cfg.jig!=='boolean') bad.push('jig');
  if(typeof cfg.assumeAxisLoads!=='boolean'||!Number.isFinite(cfg.sideLoadFactor)||cfg.sideLoadFactor<0||cfg.sideLoadFactor>1)bad.push('축별 가정 하중은 0–1 범위입니다.');
  for(const [k,lo,hi] of RANGES){ const v=cfg[k] as number; if(!Number.isFinite(v)||v<lo||v>hi) bad.push(`${k} must be finite in ${lo}..${hi}`); }
  return bad;
}
export function applyPractical(s:Scenario,cfg:PracticalSettings=DEFAULT_PRACTICAL):PracticalScenario {
  const bad=validatePractical(cfg);
  if(bad.length) throw new Error(`invalid practical settings: ${bad.join(', ')}`);
  const out:PracticalScenario=structuredClone(s);
  const old=s.practical?.profile,baseGripper=structuredClone(old?.baseGripper??s.constraints.gripper),baselineHeavyRule=old?.baselineHeavyRule??s.constraints.heavyRule;
  const g=out.constraints.gripper={...baseGripper},p=TOOL_PROFILES[cfg.tool],base=Math.min(g.payload,PAYLOAD_LIMIT_KG),baseTypes:Record<string,BaseType>={};
  const profile:PracticalProfile={name:TOOL_NAMES[cfg.tool],mass:g.mass*p.massFactor,payload:base*p.payloadFactor,source:'simulation-assumption',baseGripper,baselineHeavyRule,baseTypes};
  g.width*=p.scale.x;g.depth*=p.scale.y;g.height*=p.scale.z;g.mass=profile.mass;g.payload=profile.payload;
  out.constraints.heavyRule=cfg.weightPolicy==='capacity'?'off':baselineHeavyRule;
  for(const t of out.types){
    const sig=[t.size.w,t.size.d,t.size.h,t.weight,t.maxLoadKg,t.maxLoadSource].join('/'),cached=old?.baseTypes[t.id];
    const original=cached?.sig===sig?cached:{sig,orientations:[...t.orientations],axes:structuredClone(t.maxLoadByAxis)};baseTypes[t.id]=original;
    t.maxLoadByAxis=structuredClone(original.axes);
    if(!t.maxLoadByAxis&&cfg.assumeAxisLoads&&t.maxLoadSource==='synthetic'&&t.maxLoadKg!=null)t.maxLoadByAxis={h:t.maxLoadKg,w:t.maxLoadKg*cfg.sideLoadFactor,d:t.maxLoadKg*cfg.sideLoadFactor};
    const axes=t.maxLoadByAxis,known=!!axes&&(['w','d','h'] as const).every(k=>Number.isFinite(axes[k]));
    t.orientations=original.orientations.filter(o=>cfg.rotation==='xyz'&&known&&t.handling!=='upright'||o===0||o===90);
  }
  out.practical={...cfg,profile};
  return out;
}
function hash(text:string):number { let h=2166136261; for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function rng(seed:number):()=>number { let a=seed; return ()=>{ a=(a+0x6d2b79f5)>>>0; let t=a; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
const r1=(v:number)=>Math.round(v*10)/10;
export function resolvePlacement(s:Scenario,boxId:string,planned:Vec3,cfg:PracticalSettings=DEFAULT_PRACTICAL):PlacementResolution {
  const bad=validatePractical(cfg);
  if(bad.length) throw new Error(`invalid practical settings: ${bad.join(', ')}`);
  const rand=rng(hash(`${s.id}|${s.arrival.seed}|${boxId}`));
  const dx=(rand()*2-1)*cfg.positionErrorMm,dy=(rand()*2-1)*cfg.positionErrorMm,yaw=(rand()*2-1)*cfg.yawErrorDeg;
  const posFix=cfg.jig&&Math.hypot(dx,dy)<=cfg.jigTravelMm,yawFix=cfg.jig&&Math.abs(yaw)<=cfg.jigAngleDeg;
  const actual:Vec3={x:posFix?planned.x:r1(planned.x+dx),y:posFix?planned.y:r1(planned.y+dy),z:planned.z};
  const yawDeg=yawFix?0:Math.round(yaw*100)/100;
  const reasons:string[]=[];
  if(Math.abs(yawDeg)>0) reasons.push('잔류 회전 오차 · 비직교 접촉 물리 미지원 · 재관측 후 대기');
  // Boundary/collision of the shifted position is left to the common validator.
  return {planned:{...planned},actual,rawOffsetMm:r1(Math.hypot(dx,dy)),rawYawDeg:Math.round(yaw*100)/100,offsetMm:r1(Math.hypot(actual.x-planned.x,actual.y-planned.y)),yawDeg,corrected:cfg.jig&&posFix&&yawFix,reasons};
}
