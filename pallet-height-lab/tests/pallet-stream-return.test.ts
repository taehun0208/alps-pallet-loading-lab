import {it,expect} from 'vitest';
import {directReturn} from '../src/pallet/relay/streamReturn';
import {streamInventory} from '../src/pallet/relay/streamInventory';
import {virtualObservation} from '../src/pallet/remainingSites';
import type {GripPath,PathPoint,Placement} from '../src/pallet/types';

function fixture(){
 const scenario=streamInventory(42,8),c=scenario.constraints;
 c.workspace={xMin:-5000,xMax:5000,yMin:-5000,yMax:5000,zMax:5000};
 const box=virtualObservation(scenario.types[0],'held');
 const point=(label:string,x:number,y:number,z:number,carrying=false):PathPoint=>({label,tcp:{x,y,z},carrying,hold:0,pose:0});
 const points=[point('접근 · 집기',-1800,-1000,900),point('목표 위로 이동',500,500,2000,true),point('내려놓기',500,500,700,true),point('안전 높이 복귀',500,500,2000),point('입고 위치로 복귀',-1800,-1000,2000)];
 const segmentSeconds=points.slice(1).map((p,i)=>Math.hypot(p.tcp.x-points[i].tcp.x,p.tcp.y-points[i].tcp.y,p.tcp.z-points[i].tcp.z)/c.gripper.speed);
 const path:GripPath={points,segmentSeconds,seconds:segmentSeconds.reduce((a,b)=>a+b,0),lengthMm:0};
 return {c,box,path,idle:{x:1100,y:-1000,z:800}};
}
it('shortens only the empty return, preserving pickup, carrying and release timing',()=>{
 const {c,box,path,idle}=fixture(),next=directReturn(path,idle,box,[],c);
 expect(next).not.toBe(path);expect(next.points.slice(0,4)).toEqual(path.points.slice(0,4));
 expect(next.segmentSeconds.slice(0,3)).toEqual(path.segmentSeconds.slice(0,3));
 const duration=(p:GripPath)=>p.seconds+Math.hypot(p.points.at(-1)!.tcp.x-idle.x,p.points.at(-1)!.tcp.y-idle.y,p.points.at(-1)!.tcp.z-idle.z)/c.gripper.speed;
 expect(duration(next)).toBeLessThan(duration(path));expect(next.segmentSeconds.length).toBe(next.points.length-1);
});
it('keeps the original route if the direct return or descent crosses a stack',()=>{
 const {c,box,path,idle}=fixture();
 const obstacle:Placement={id:'obstacle',typeId:'test',position:{x:1000,y:-1100,z:1100},size:{w:200,d:200,h:300},weight:1,orientation:0,supports:[],supportRatio:1,loadAbove:0};
 expect(directReturn(path,idle,box,[obstacle],c)).toBe(path);
});
it('keeps the original route when the new tool envelope leaves the workspace',()=>{
 const {c,box,path,idle}=fixture();c.workspace.xMax=1100;
 expect(directReturn(path,idle,box,[],c)).toBe(path);
});
