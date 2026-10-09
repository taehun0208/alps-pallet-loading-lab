import type { BoxType, Orientation, Scenario, Vec3 } from '../types';
import { poseVector, orientedSize } from '../orientations';

export const ORIENTATIONS = { XYZ:0, XZY:'whd', YXZ:90, YZX:'dhw', ZXY:'hwd', ZYX:'hdw' } as const;
export type PackageType = 'CARTON'|'REINFORCED_CARTON'|'PLASTIC_TOTE'|'WOODEN_CASE'|'CRATE';
export type GraspFace = 'TOP'|'FRONT'|'BACK'|'LEFT'|'RIGHT';
export interface BoxSpec {
 id:string; name:string; length:number; width:number; height:number; grossWeight:number; quantity:number;
 packageType:PackageType; keepUpright:boolean; allowedOrientations:(keyof typeof ORIENTATIONS)[];
 stackable:boolean; maxTopLoad:number; maxStackLayers?:number; minSupportRatio:number;
 fragility:'LOW'|'MEDIUM'|'HIGH'; shockSensitive:boolean; centerOfGravity:Vec3;
 graspableFaces:GraspFace[]; preferredGraspFace?:GraspFace;
 dataSource:'VERIFIED'|'REFERENCE_CASE'|'SIMULATED_ASSUMPTION'; description?:string; sourceUrl?:string;
}
export const PACKAGE_PRESETS:Record<PackageType,Pick<BoxSpec,'keepUpright'|'allowedOrientations'|'stackable'|'maxTopLoad'|'minSupportRatio'|'fragility'|'shockSensitive'|'graspableFaces'>>={
 CARTON:{keepUpright:false,allowedOrientations:['XYZ','YXZ'],stackable:true,maxTopLoad:20,minSupportRatio:.75,fragility:'LOW',shockSensitive:false,graspableFaces:['TOP','LEFT','RIGHT']},
 REINFORCED_CARTON:{keepUpright:true,allowedOrientations:['XYZ','YXZ'],stackable:true,maxTopLoad:50,minSupportRatio:.85,fragility:'MEDIUM',shockSensitive:false,graspableFaces:['TOP']},
 PLASTIC_TOTE:{keepUpright:true,allowedOrientations:['XYZ','YXZ'],stackable:true,maxTopLoad:100,minSupportRatio:.8,fragility:'LOW',shockSensitive:false,graspableFaces:['TOP']},
 WOODEN_CASE:{keepUpright:true,allowedOrientations:['XYZ','YXZ'],stackable:true,maxTopLoad:80,minSupportRatio:.70,fragility:'MEDIUM',shockSensitive:false,graspableFaces:['TOP']},
 CRATE:{keepUpright:true,allowedOrientations:['XYZ','YXZ'],stackable:false,maxTopLoad:0,minSupportRatio:.85,fragility:'MEDIUM',shockSensitive:true,graspableFaces:['TOP']},
};
export function validateSpec(s:BoxSpec){
 const assert=(ok:boolean,msg:string)=>{if(!ok)throw Error(`${s?.id||'BoxSpec'}: ${msg}`);};
 assert(!!s&&!!s.id&&!!s.name,'ID와 이름 필요');
 assert([s.length,s.width,s.height,s.grossWeight].every(v=>Number.isFinite(v)&&v>0),'치수·무게는 양수');
 assert(Number.isInteger(s.quantity)&&s.quantity>=0&&s.quantity<=120,'수량 0~120');
 assert(s.packageType in PACKAGE_PRESETS,'포장 종류 오류');
 assert(typeof s.keepUpright==='boolean'&&typeof s.stackable==='boolean'&&typeof s.shockSensitive==='boolean','boolean 조건 오류');
 assert(Array.isArray(s.allowedOrientations)&&s.allowedOrientations.length>0&&s.allowedOrientations.every(o=>o in ORIENTATIONS),'허용 회전 오류');
 assert(!s.keepUpright||s.allowedOrientations.some(o=>o==='XYZ'||o==='YXZ'),'upright에서 가능한 회전 없음');
 assert(Number.isFinite(s.maxTopLoad)&&s.maxTopLoad>=0,'상부 허용하중은 0 이상');
 assert(s.maxStackLayers===undefined||Number.isInteger(s.maxStackLayers)&&s.maxStackLayers>=1,'최대 적층 수는 1 이상 정수');
 assert(s.minSupportRatio>0&&s.minSupportRatio<=1,'지지 비율 0 초과 1 이하');
 assert(['LOW','MEDIUM','HIGH'].includes(s.fragility),'파손 민감도 오류');
 assert(!!s.centerOfGravity&&[s.centerOfGravity.x,s.centerOfGravity.y,s.centerOfGravity.z].every((v,i)=>Number.isFinite(v)&&v>=0&&v<=[s.length,s.width,s.height][i]),'무게중심은 원래 박스 내부 mm 좌표');
 assert(Array.isArray(s.graspableFaces)&&s.graspableFaces.length>0&&s.graspableFaces.every(f=>['TOP','FRONT','BACK','LEFT','RIGHT'].includes(f)),'파지 면 오류');
 assert(!s.preferredGraspFace||s.graspableFaces.includes(s.preferredGraspFace),'선호 면은 허용 면 중 선택');
 assert(['VERIFIED','REFERENCE_CASE','SIMULATED_ASSUMPTION'].includes(s.dataSource),'출처 구분 오류');
 return s;
}
export function permittedOrientations(s:BoxSpec):Orientation[]{return [...new Set(s.allowedOrientations.filter(o=>!s.keepUpright||o==='XYZ'||o==='YXZ').map(o=>ORIENTATIONS[o]))];}
export function localMassCenter(s:BoxSpec,o:Orientation):Vec3{
 const offset=poseVector({x:s.centerOfGravity.x-s.length/2,y:s.centerOfGravity.y-s.width/2,z:s.centerOfGravity.z-s.height/2},o),size=orientedSize({w:s.length,d:s.width,h:s.height},o);
 return {x:size.w/2+offset.x,y:size.d/2+offset.y,z:size.h/2+offset.z};
}
export function massCenter(b:{position:Vec3;size:{w:number;d:number;h:number};orientation?:Orientation;packaging?:BoxSpec}):Vec3{
 const c=b.packaging?localMassCenter(b.packaging,b.orientation??0):{x:b.size.w/2,y:b.size.d/2,z:b.size.h/2};return {x:b.position.x+c.x,y:b.position.y+c.y,z:b.position.z+c.z};
}
const COLORS=['#a7b5e8','#91c5b6','#e4ba77','#d99791','#b4a0d6','#c2b28b','#8bbcca','#aeafba'];
export function boxType(s:BoxSpec,index=0):BoxType{
 validateSpec(s);return {id:s.id,name:s.name,size:{w:s.length,d:s.width,h:s.height},weight:s.grossWeight,quantity:s.quantity,orientations:permittedOrientations(s),color:COLORS[index%COLORS.length],material:s.packageType==='PLASTIC_TOTE'?'plastic':s.packageType==='WOODEN_CASE'||s.packageType==='CRATE'?'wood':'paper',maxLoadKg:s.maxTopLoad,packaging:structuredClone(s)};
}
export function sampleSpecs():BoxSpec[]{
 const make=(id:string,name:string,length:number,width:number,height:number,grossWeight:number,quantity:number,packageType:PackageType,extra:Partial<BoxSpec>={}):BoxSpec=>({id,name,length,width,height,grossWeight,quantity,packageType,...structuredClone(PACKAGE_PRESETS[packageType]),centerOfGravity:{x:length/2,y:width/2,z:height/2},dataSource:'SIMULATED_ASSUMPTION',description:'Simulation Assumption · 치수·질량·포장 강도·로봇 취급 조건 모두 실험용 가정입니다.',...extra});
 return [
 make('A','Marine Backup Ring Carton',400,300,200,1,4,'CARTON',{dataSource:'REFERENCE_CASE',sourceUrl:'https://www.scribd.com/document/1023542427/CIPL-MK-24-K-123-IMKBS007891K02',description:'Reference Case · 공개 재게시 Packing List의 한 carton: 400×300×200 mm / 총 1 kg. 포장 내부 36개 링을 36박스로 해석하지 않습니다. 본 실험 수량 4개 및 회전·강도·지지·파지 조건은 Simulation Assumption. 제조사 공식 제품 규격 아님.'}),
 make('B','Small Electrical Carton · Relay / Contactor',250,180,150,2.5,5,'CARTON',{keepUpright:true,maxTopLoad:20,minSupportRatio:.8,fragility:'MEDIUM',graspableFaces:['TOP']}),
 make('C','MCCB Medium Carton',350,280,220,6,4,'CARTON',{keepUpright:true,maxTopLoad:35,minSupportRatio:.8,fragility:'MEDIUM',graspableFaces:['TOP']}),
 make('D','MCCB Large Carton',500,400,350,15,3,'REINFORCED_CARTON'),
 make('E','Heavy Electrical Package',600,450,450,28,2,'REINFORCED_CARTON',{maxTopLoad:30,fragility:'HIGH',shockSensitive:true}),
 make('F','Marine Bearing Case',500,400,300,25,2,'WOODEN_CASE',{centerOfGravity:{x:290,y:185,z:140}}),
 make('G','Marine Valve Component',650,450,400,40,1,'WOODEN_CASE',{stackable:false,maxTopLoad:0,fragility:'MEDIUM'}),
 make('H','Marine Heavy Crate',800,600,500,70,1,'CRATE'),
 ];
}
export function packagingScenario(specs=sampleSpecs(),seed=42):Scenario{
 return {version:1,units:{length:'mm',weight:'kg',time:'s'},id:'packaging-aware',name:'포장 제약 · Marine / Electrical 가정 혼합 22개',supplyMode:'arrival',types:specs.map(boxType),pallet:{width:1200,depth:1000,maxHeight:1600},arrival:{seed,pattern:'random-draw'},events:[],constraints:{robotMode:'gripper',supportRatio:.75,contactTolerance:.01,horizontalGap:0,heavyRule:'off',standingHeight:{enabled:true,maxRiseMm:150},stability:{maxSlenderness:3,minMarginRatio:.04,lateralAccelerationG:.05,loadSafetyFactor:1,slendernessMode:'score'},gripper:{width:140,depth:140,height:100,mass:3,payload:100,margin:5,lift:160,speed:650,pickSeconds:1,placeSeconds:1,rotationSpeed:90},workspace:{xMin:-2000,xMax:3000,yMin:-2000,yMax:3000,zMax:4500},packagingRobot:{base:{x:-700,y:500,z:650},minReach:0,maxReach:3500,approach:180}}};
}
