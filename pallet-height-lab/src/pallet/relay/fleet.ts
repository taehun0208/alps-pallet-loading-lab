import type {Pallet,RobotLayout,Vec3,Observation,Scenario} from '../types';
import {solveRobotArm} from '../robotArm';
export const DEFAULT_FLEET:RobotLayout={count:4,architecture:'floor',floorCount:4};
export const MAX_ROBOTS=8;
export const FLEET_LABELS={floor:'1안 · 바닥 고정형',ceiling:'2안 · 천장 레일형',mixed:'3안 · 바닥 + 천장 혼합'};
export function validateFleet(f:RobotLayout):RobotLayout {
 if(!Number.isInteger(f.count)||f.count<1||f.count>MAX_ROBOTS)throw Error('로봇 수는 1–8대 정수로 입력하세요.');
 if(!['floor','ceiling','mixed'].includes(f.architecture))throw Error('지원하지 않는 로봇 구성입니다.');
 if(f.architecture==='mixed'&&(!Number.isInteger(f.floorCount)||f.floorCount<1||f.floorCount>=f.count))throw Error('혼합형은 2대 이상이며 바닥형과 천장형이 각각 1대 이상 필요합니다.');
 return {...f,floorCount:f.architecture==='floor'?f.count:f.architecture==='ceiling'?0:f.floorCount};
}
export const fleet=(p:Pallet)=>p.robotLayout??DEFAULT_FLEET;
export const robotCount=(p:Pallet)=>fleet(p).count;
// Alternate kinds in a mixed fleet where possible, so consecutive stations differ.
export function robotKind(p:Pallet,index:number):'floor'|'ceiling'{
 const f=fleet(p);if(f.architecture!=='mixed')return f.architecture;
 return Math.floor((index+1)*f.floorCount/f.count)>Math.floor(index*f.floorCount/f.count)?'floor':'ceiling';
}
export function withFleet(s:Scenario,f:RobotLayout):Scenario {return {...s,pallet:{...s.pallet,robotLayout:validateFleet(f)}};}
export function gantryEnvelope(p:Pallet){return {xMin:p.palletsPerRobot===2?-p.width-650:p.width/2-1400,xMax:p.width/2+1400,yMin:-2100,yMax:p.depth+350,zMin:0,zMax:3400,railZ:3900};}
export function gantryReach(p:Pallet,t:Vec3,n:Vec3,toolHeight:number){const e=gantryEnvelope(p);return [t.x,t.y,t.z].every(Number.isFinite)&&Math.abs(n.x)<1e-6&&Math.abs(n.y)<1e-6&&n.z>1-1e-6&&t.x>=e.xMin&&t.x<=e.xMax&&t.y>=e.yMin&&t.y<=e.yMax&&t.z>=e.zMin&&t.z+toolHeight<=e.zMax;}
export function robotReach(p:Pallet,index:number,t:Vec3,n:Vec3,toolHeight:number){return robotKind(p,index)==='ceiling'?gantryReach(p,t,n,toolHeight):Math.abs(n.x)<1e-6&&Math.abs(n.y)<1e-6&&n.z>1-1e-6&&solveRobotArm(t,n,toolHeight).reachable;}
export function robotObservation(p:Pallet,index:number,b:Observation):Observation{// Both cell mechanisms have a vertical tool plus yaw, with no independent wrist pitch/roll.
 return {...b,orientationAllowed:b.orientationAllowed.filter(o=>o===0||o===90)};}
export function idleTCP(p:Pallet,index:number):Vec3|undefined {return robotKind(p,index)==='ceiling'?{x:p.width/2,y:-700,z:2100}:undefined;}
