import type { Vec3,Dimensions,Pallet,Contact } from '../types';
export type Mode='A'|'B'|'C';
export type Damage='normal'|'corner'|'dent'|'bulge'|'bottom'|'tear';
export type Rect={x:number;y:number;w:number;d:number};
export type Solid=Rect&{z:number;h:number};
export type Strength={topLoadKg:number|null;residual:number;source:'measured'|'research-example'|'assumption'|'unknown';note:string};
export interface Box {
 id:string;nominal:Dimensions;parts:Solid[];mass:number;com:Vec3;rotations:(0|90)[];
 friction:number;strength:Strength;damage:Damage;shapeDamage?:{kind:Damage;region:Solid}[];masks:Rect[];arrival:number;color:string;
 suction:{seal:'unknown'|'assumed';maxMassKg:number;maxMomentNm:number};
}
export interface Pose {position:Vec3;rotation:0|90}
export interface Placed extends Pose {box:Box}
export interface Observed extends Placed {yawErrorDeg:number;revision:number}
export interface Config {
 mode:Mode;seed:number;count:number;pallet:Pallet;environment:'pallet'|'roll';
 walls:{left:boolean;right:boolean;back:boolean};frontFill:boolean;
 deformation:number;damageKinds:Damage[];materialResidual:number;
 noise:{dimensionMm:number;positionMm:number;surfaceMm:number;yawDeg:number};
 bufferSize:number;maxRetries:number;maxWait:number;maxCandidates:number;maxEms:number;timeBudgetMs:number;
 contactMm:number;penetrationMm:number;supportRatio:number;maxBridgeMm:number;edgeMarginMm:number;
 cup:{diameterMm:number;marginMm:number;flatnessMm:number;angleDeg:number};
 gripper:{width:number;depth:number;height:number;clearance:number;payloadKg:number;maxMomentNm:number;speedMmS:number};
 workspaceHeight:number;alignmentMm:number;alignmentTrials:number;
 features:{load:boolean;suction:boolean;path:boolean;buffer:boolean;replan:boolean;alignment:boolean};
 weights:{height:number;space:number;support:number;load:number;path:number;suction:number;waiting:number;retry:number;foundation:number};
}
export interface Assessment {
 reasons:string[];contacts:Contact[];supportRatio:number;
 loads:Record<string,{aboveKg:number;reactionKg:number;capacityKg:number|null;resultant:Vec3;contacts:Contact[]}>;
 floorReactionKg:number;forceResidualKg:number;momentResidualKgMm:number;
}
export interface Grasp {point:Vec3;quality:number;flatnessMm:number;leverMm:number;valid:boolean;reasons:string[]}
export interface Candidate extends Pose {
 id:string;boxId:string;score:number;terms:Record<string,number>;reasons:string[];
 assessment:Assessment;pickPoint?:{x:number;y:number;z:number};grasp:Grasp|null;grasps:Grasp[];path:Vec3[];seconds:number;
}
export interface Pending {id:string;wait:number;attempts:number;reasons:string[]}
export interface Frame {
 tick:number;arrived:number;placed:Placed[];observed:Observed[];buffer:Pending[];
 rejected:{id:string;reasons:string[]}[];candidates:Candidate[];selected:Candidate|null;
 retries:number;waitTicks:number;planningMs:number;executionSeconds:number;alignments:number;
 events:{tick:number;id:string;kind:string;reasons:string[]}[];
 attempts:{pickGeometricPass:number;pickGeometricFail:number;placementPass:number;placementFail:number};
 incidents:Record<string,number>;done:boolean;
}
export const labels:Record<string,string>={boundary:'적재 경계 초과',collision:'변형 형상 충돌',support:'지지 부족·공중 부양',bridge:'큰 무지지 구간',tipping:'합력 작용점 전도 위험',load:'누적 상부하중 초과',strength:'하부 강도 정보 없음',rotation:'허용하지 않는 회전',grasp:'흡착 기하 조건 불충족',path:'상자·그리퍼 경로 간섭',budget:'탐색 예산 소진',unavailable:'유효 후보 없음',waiting:'버퍼 대기 한도',invalid:'잘못된 입력'};
export const damageLabels:Record<Damage,string>={normal:'정상',corner:'모서리 눌림',dent:'윗면 함몰',bulge:'옆면 돌출',bottom:'불균일 바닥',tear:'구멍·찢김 마스크'};
export const DEFAULT_CONFIG:Config={
 mode:'C',seed:42,count:24,pallet:{width:1800,depth:1500,maxHeight:1600},environment:'pallet',
 walls:{left:true,right:true,back:true},frontFill:false,deformation:24,damageKinds:['normal','corner','dent','bulge','bottom','tear'],materialResidual:.8,
 noise:{dimensionMm:0,positionMm:0,surfaceMm:0,yawDeg:0},bufferSize:6,maxRetries:2,maxWait:8,
 maxCandidates:64,maxEms:80,timeBudgetMs:1500,contactMm:.5,penetrationMm:.05,supportRatio:.8,maxBridgeMm:180,edgeMarginMm:2,
 cup:{diameterMm:50,marginMm:8,flatnessMm:1.5,angleDeg:10},
 gripper:{width:100,depth:100,height:100,clearance:2,payloadKg:35,maxMomentNm:12,speedMmS:850},
 workspaceHeight:2600,alignmentMm:8,alignmentTrials:9,
 features:{load:true,suction:true,path:true,buffer:true,replan:true,alignment:false},
 weights:{height:3,space:2,support:2,load:1,path:1,suction:1,waiting:1,retry:.5,foundation:2},
};
