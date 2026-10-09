import { it,expect } from 'vitest';
import { ALL_ORIENTATIONS,allowedOrientations,orientedSize,originalSize,poseVector,isStanding } from '../src/pallet/orientations';
import { poseQuaternion,movingHeight } from '../src/pallet/poseRendering';
import { Vector3 } from 'three';
import { scenario,parseScenario } from '../src/pallet/scenarios';
import { ArrivalEnvironment,runScenario } from '../src/pallet/environment';
import { plan } from '../src/pallet/planner';
import { inspectConstraints } from '../src/pallet/constraints';
import { materialInfo } from '../src/pallet/materials';
import { interiorSpace } from '../src/pallet/interior';
import { COMPACT_SEARCH,emptyFrame } from '../src/pallet/types';
import type { BoxType,Placement,Observation } from '../src/pallet/types';
const type=(id:string,w:number,d:number,h:number):BoxType=>({id,name:id,size:{w,d,h},weight:2,quantity:1,orientations:[...ALL_ORIENTATIONS],material:'plastic',maxLoadKg:100,color:'#6bcab7'});
const box=(id:string,x:number,y:number,w:number,d:number,h:number):Placement=>({id,typeId:id,size:{w,d,h},weight:10,position:{x,y,z:0},orientation:0,supports:[],supportRatio:1,loadAbove:0,material:'plastic',maxLoadKg:200});
const obs=(t:BoxType):Observation=>({...t,typeId:t.id,status:'normal',orientationAllowed:t.orientations});

it('maps all six dimensions bijectively, removes equivalent cube poses, and rendering agrees with geometry',()=>{
 const size={w:373,d:211,h:97};expect(new Set(ALL_ORIENTATIONS.map(o=>JSON.stringify(orientedSize(size,o)))).size).toBe(6);
 for(const o of ALL_ORIENTATIONS){const v=orientedSize(size,o);expect(v.w*v.d*v.h).toBe(size.w*size.d*size.h);expect(originalSize(v,o)).toEqual(size);expect(movingHeight(size,poseQuaternion(o))).toBeCloseTo(v.h);
  const vector={x:11,y:23,z:37},rot=poseVector(vector,o),render=new Vector3(vector.x,vector.z,vector.y).applyQuaternion(poseQuaternion(o));expect(render.x).toBeCloseTo(rot.x);expect(render.y).toBeCloseTo(rot.z);expect(render.z).toBeCloseTo(rot.y);
 }
 expect(allowedOrientations({w:100,d:100,h:100},ALL_ORIENTATIONS)).toEqual([0]);expect(allowedOrientations(size,ALL_ORIENTATIONS,'upright')).toEqual([0,90]);
 expect(allowedOrientations({w:100,d:100,h:100},ALL_ORIENTATIONS,undefined,{h:2,d:20,w:10})).toEqual([0,'whd','hdw']);
});

for(const algorithm of ['bl','greedy','rollout'] as const)it(`${algorithm} stands a box in the central well instead of building around it`,()=>{
 const s=scenario('online-task');s.supplyMode='stock-select';s.constraints.robotMode='ideal';s.pallet={width:600,depth:600,maxHeight:900};s.types=[type('fill',400,190,90)];
 const before=[box('west',0,0,250,600,300),box('east',350,0,250,600,300),box('front',250,0,100,200,300),box('back',250,400,100,200,300)];
 const i=new ArrivalEnvironment(s).input(emptyFrame(),algorithm,COMPACT_SEARCH,'well')!;i.placements=before;const a=plan(i),c=a.candidates.find(c=>c.id===a.selectedId)!;
 expect(c.valid).toBe(true);expect(isStanding(c.placement.orientation)).toBe(true);expect(c.placement.position.z).toBe(0);expect(c.placement.position.x).toBeGreaterThanOrEqual(250);expect(c.placement.position.x+c.placement.size.w).toBeLessThanOrEqual(350);expect(interiorSpace([...before,c.placement]).voidVolume).toBeLessThan(interiorSpace(before).voidVolume);
});

it('allows a perpendicular box on a horizontal base and enforces upright and orientation-dependent strength',()=>{
 // Isolate pose/strength mechanics; skyline policy is tested in pallet-standing-height.test.ts.
 const s=scenario('online-task');s.constraints.standingHeight!.enabled=false;s.constraints.robotMode='ideal';const base=box('base',0,0,500,500,150),t=type('upper',400,200,100),o=obs(t),p:Placement={...base,...t,id:'upper',typeId:'upper',size:orientedSize(t.size,'whd'),orientation:'whd',position:{x:50,y:200,z:150},supports:[]};
 expect(inspectConstraints(p,o,[base],s.pallet,s.constraints).reasons).toEqual([]);
 expect(inspectConstraints({...p,size:orientedSize(t.size,90),orientation:90,position:{x:150,y:50,z:150}},o,[base],s.pallet,s.constraints).reasons).toEqual([]);
 expect(inspectConstraints(p,{...o,handling:'upright'},[base],s.pallet,s.constraints).reasons.join()).toContain('위아래');
 expect(materialInfo({...p,maxLoadByAxis:{d:5}}).capacity).toBe(4);
 const placed=inspectConstraints({...p,maxLoadByAxis:{d:1}},o,[base],s.pallet,s.constraints).placement,upper=box('heavy',60,210,100,50,70);upper.position.z=placed.position.z+placed.size.h;upper.weight=2;
 expect(inspectConstraints(upper,{...upper,status:'normal',orientationAllowed:[0]},[base,placed],s.pallet,s.constraints).reasons.join()).toContain('지지하중 초과');
});

it('rejects a standing pose that exceeds height, and a gripper side exit that hits a neighbour',()=>{
 // This fixture intentionally isolates a free-standing tool rotation.
 const s=scenario('online-task');s.constraints.standingHeight!.enabled=false;const t=type('turn',300,200,100),o=obs(t),p={...box('turn',400,400,100,200,300),weight:2,orientation:'hdw' as const};
 const free=inspectConstraints(p,o,[],s.pallet,s.constraints);expect(free.reasons).toEqual([]);expect(free.path.fixedGrasp).toBe(true);expect(free.path.points.some(p=>p.label.includes('세우기'))).toBe(true);
 expect(inspectConstraints(p,o,[],{...s.pallet,maxHeight:250},s.constraints).reasons.join()).toContain('높이');
 const neighbour=box('neighbour',180,400,215,200,500);expect(inspectConstraints(p,o,[neighbour],s.pallet,s.constraints).reasons.join()).toContain('경로 간섭');
});

it('measures a central void without treating an outside notch or cavity as a support',()=>{
 const ring=[box('l',0,0,100,300,100),box('r',200,0,100,300,100),box('f',100,0,100,100,100),box('b',100,200,100,100,100)];expect(interiorSpace(ring).voidVolume).toBe(1000000);expect(interiorSpace([...ring,box('fill',100,100,100,100,100)]).voidVolume).toBe(0);
});

it('round-trips allowed poses and per-axis loads without changing legacy orientation permissions',()=>{
 const s=scenario('online-task');s.types=[{...type('a',300,200,100),maxLoadByAxis:{w:5,d:10,h:20}}];delete s.generation;expect(parseScenario(JSON.stringify(s))).toEqual(s);s.types[0].orientations=[0];expect(parseScenario(JSON.stringify(s)).types[0].orientations).toEqual([0]);
 s.types[0].maxLoadByAxis={w:-1};expect(()=>parseScenario(JSON.stringify(s))).toThrow('방향별');
 for(const value of [null,0,false,'',[]]){const raw=JSON.parse(JSON.stringify(s));raw.types[0].maxLoadByAxis=value;expect(()=>parseScenario(JSON.stringify(raw))).toThrow('방향별');}
});

it('uses per-box permissions during actual planning, without adding forbidden poses',()=>{
 const s=scenario('online-task');s.supplyMode='stock-select';s.constraints.robotMode='ideal';s.constraints.standingHeight!.enabled=false;s.types=[type('a',300,200,100)];s.pallet={width:200,depth:120,maxHeight:500};delete s.generation;
 expect(runScenario(s,'greedy',COMPACT_SEARCH).metrics.count).toBe(1);s.types[0].handling='upright';expect(runScenario(s,'greedy',COMPACT_SEARCH).metrics.count).toBe(0);
});
