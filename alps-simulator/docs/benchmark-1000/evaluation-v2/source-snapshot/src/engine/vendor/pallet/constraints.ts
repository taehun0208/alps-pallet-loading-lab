import { permittedOrientations } from './packaging/spec';
import { packagingRobot } from './packaging/robot';
import { EPS, calculateLoads, centerSupported, contactsFor, intersects, overlapRect, footprint, top,oriented } from './geometry';
import type { Constraints, GripPath, Observation, Pallet, PathPoint, Placement, Vec3 } from './types';
import { DEFAULT_STABILITY } from './types';
import { materialInfo } from './materials';
import { equilibrium } from './equilibrium';
import { stability } from './stability';
import { withinReach,yawEnvelope } from './robotReach';
import { isStanding,orientationYaw } from './orientations';
import { tiltPath,tiltSweeps } from './tiltRobot';
import { standingHeight } from './standingHeight';
export const incomingPosition=()=>({x:-900,y:200,z:0});
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// Display motion only: no gripper width, mass, payload, workspace or robot timing is evaluated.
export function idealPath(box:Placement,current:Observation,placed:Placement[]):GripPath{
 const source=current.pickupPosition??incomingPosition(),safe=Math.max(top(box),current.size.h,...placed.map(top))+current.size.h+200;
 const start={x:source.x+current.size.w/2,y:source.y+current.size.d/2,z:safe};
 const target={x:box.position.x+box.size.w/2,y:box.position.y+box.size.d/2,z:top(box)};
 return {model:'ideal',points:[{label:'이상적 배치 · 시각 재생',tcp:start,carrying:true,hold:0,pose:0},{label:'자세 선택 · 목표 위',tcp:{...target,z:safe},carrying:true,hold:0,pose:box.orientation},{label:'배치 확정',tcp:target,carrying:true,hold:0,pose:box.orientation}],lengthMm:0,seconds:1,segmentSeconds:[.5,.5]};
}
export function gripperPath(box:Placement,current:Observation,placed:Placement[],c:Constraints):GripPath{
  if(isStanding(box.orientation))return tiltPath(box,current,placed,c,current.pickupPosition??incomingPosition());
  const incoming=current.pickupPosition??incomingPosition(),pickup={x:incoming.x+current.size.w/2,y:incoming.y+current.size.d/2,z:incoming.z+current.size.h};
  const target={x:box.position.x+box.size.w/2,y:box.position.y+box.size.d/2,z:top(box)};
  const safe=Math.max(target.z,...placed.map(top),pickup.z)+Math.max(current.size.h,box.size.h)+c.gripper.lift;
  const yaw=orientationYaw(box.orientation);
  const points:PathPoint[]=[
    {label:current.pickupPosition?'임시 대기대 · 회수 대기':'입고 위치 · 대기',tcp:{...pickup,z:safe},carrying:false,hold:0,yaw:0},
    {label:'접근 · 집기',tcp:pickup,carrying:false,hold:c.gripper.pickSeconds,yaw:0},
    {label:'안전 높이로 이동',tcp:{...pickup,z:safe},carrying:true,hold:0,yaw:0},
    ...(yaw?[{label:'안전 높이 · 파지 방향 회전',tcp:{...pickup,z:safe},carrying:true,hold:0,yaw}]:[]),
    {label:'목표 위로 이동',tcp:{...target,z:safe},carrying:true,hold:0,yaw},
    {label:'내려놓기',tcp:target,carrying:true,hold:c.gripper.placeSeconds,yaw},
    {label:'그리퍼 이탈',tcp:{...target,z:safe},carrying:false,hold:0,yaw},
    {label:current.pickupPosition?'임시 대기대로 복귀':'입고 위치로 복귀',tcp:{...pickup,z:safe},carrying:false,hold:0,yaw},
    ...(yaw?[{label:'빈 그리퍼 방향 복원',tcp:{...pickup,z:safe},carrying:false,hold:0,yaw:0}]:[]),
  ];
  const lengths=points.slice(1).map((p,i)=>distance(points[i].tcp,p.tcp));
  const segmentSeconds=lengths.map((l,i)=>Math.max(l/c.gripper.speed,Math.abs((points[i+1].yaw||0)-(points[i].yaw||0))/(c.gripper.rotationSpeed??180))+points[i+1].hold);
  return {model:'gripper',points,lengthMm:lengths.reduce((a,b)=>a+b,0),seconds:segmentSeconds.reduce((a,b)=>a+b,0),segmentSeconds};
}
function swept(a:Vec3,b:Vec3,w:number,d:number,zBelow:number,zAbove:number,margin:number){
  return {position:{x:Math.min(a.x,b.x)-w/2-margin,y:Math.min(a.y,b.y)-d/2-margin,z:Math.min(a.z,b.z)-zBelow},size:{w:Math.abs(a.x-b.x)+w+2*margin,d:Math.abs(a.y-b.y)+d+2*margin,h:Math.abs(a.z-b.z)+zBelow+zAbove}};
}
export function inspectConstraints(box:Placement,current:Observation,placed:Placement[],pallet:Pallet,c:Constraints,robot?:RobotValidator):{placement:Placement;reasons:string[];path:GripPath;stack:Placement[]}{
  box={...box,packaging:current.packaging};
  const reasons:string[]=[],p=box.position,s=box.size;
  if(p.z<0)reasons.push('팔레트 바닥 아래');
  if(current.packaging&&!permittedOrientations(current.packaging).includes(box.orientation))reasons.push('Orientation prohibited · BoxSpec / keepUpright');
  const observed=oriented(current.size,box.orientation);
  if(['w','d','h'].some(k=>Math.abs(s[k as keyof typeof s]-observed[k as keyof typeof s])>EPS))reasons.push('관측 치수와 배치 치수 불일치');
  if(Math.abs(box.weight-current.weight)>EPS)reasons.push('관측 무게와 배치 무게 불일치');
  if(p.x<-EPS||p.y<-EPS||p.x+s.w>pallet.width+EPS||p.y+s.d>pallet.depth+EPS)reasons.push('팔레트 경계 밖');
  if(p.z+s.h>pallet.maxHeight+EPS)reasons.push('최대 적재 높이 초과');
  if(!current.orientationAllowed.includes(box.orientation))reasons.push('허용되지 않은 회전');
  if(current.handling==='upright'&&isStanding(box.orientation))reasons.push('취급 제한 · 위아래 방향 유지');
  const collided=placed.find(b=>intersects(box,b,c.horizontalGap));if(collided)reasons.push(`박스 ${collided.id}와 겹침 / 작업 여유 미달`);
  const skyline=standingHeight(box,placed,c);if(!skyline.valid)reasons.push(skyline.reason);
  const supports=contactsFor(box,placed,c.contactTolerance),supportArea=supports.reduce((a,b)=>a+b.area,0),supportRatio=p.z===0?1:supportArea/(s.w*s.d);
  if(current.packaging){
   if(supportRatio+EPS<current.packaging.minSupportRatio||!centerSupported(box,supports))reasons.push(`SUPPORT: 지지 조건 미달 ${(supportRatio*100).toFixed(1)}% / 필요 ${(current.packaging.minSupportRatio*100).toFixed(1)}% · CoG 지지 검사`);
   if(reasons.length){const failed={...box,supports,supportRatio};return {placement:failed,reasons:[...new Set(reasons)],path:idealPath(failed,current,placed),stack:[...placed,failed]};}
  }
  let updated={...box,supports,supportRatio};const solved=equilibrium([...placed,updated]);updated=solved.placements.at(-1)!;const stack=solved.placements;reasons.push(...solved.violations);
  if(supportRatio+EPS<(current.packaging?.minSupportRatio??c.supportRatio)||!centerSupported(updated,supports))reasons.push(`SUPPORT: 지지 조건 미달 ${(supportRatio*100).toFixed(1)}% / 필요 ${((current.packaging?.minSupportRatio??c.supportRatio)*100).toFixed(1)}% · CoG 지지 검사`);
  // Reactions can change in older interfaces after a new upper load, so recheck every edge.
  for(const child of stack)for(const support of child.supports){const lower=stack.find(b=>b.id===support.id)!;
    if(lower.handling==='no-top-load'||lower.packaging?.stackable===false)reasons.push(`취급 제한 · ${lower.id} 위 적재 금지`);
    const transmitted=c.heavyRule==='share'?child.weight*support.share:child.weight;
    if(!current.packaging&&c.heavyRule!=='off'&&transmitted>lower.weight+EPS){reasons.push(`무게 규칙 위반 · ${lower.id} (${lower.weight} kg)`);break;}
  }
  const layers=new Map<string,number>();
  for(const b of [...stack].sort((a,b)=>b.position.z-a.position.z)){const count=layers.get(b.id)??1;if(b.packaging?.maxStackLayers&&count>b.packaging.maxStackLayers)reasons.push(`LOAD: ${b.id} 적층 ${count} / 최대 ${b.packaging.maxStackLayers}`);for(const support of b.supports)layers.set(support.id,Math.max(layers.get(support.id)??1,count+1));}
  const loads=calculateLoads(stack);
  stack.forEach(b=>b.loadAbove=loads[b.id]);
  const cfg=c.stability||DEFAULT_STABILITY;
  const overloaded=stack.find(b=>{const capacity=materialInfo(b,cfg).capacity;return capacity!==null&&loads[b.id]>capacity+EPS;});
  if(overloaded){const material=materialInfo(overloaded,cfg);reasons.push(`재질 허용 지지하중 초과 · ${overloaded.id} (${loads[overloaded.id].toFixed(2)} / ${material.capacity!.toFixed(2)} kg · ${material.name} ${material.source})`);}
  if(!reasons.length)reasons.push(...stability(stack,cfg,solved).violations);
  if(current.packaging){const r=packagingRobot(updated,current,placed,c);if(box.weight+c.gripper.mass>c.gripper.payload+EPS)reasons.push(`ROBOT: 가반 ${box.weight+c.gripper.mass} / 최대 ${c.gripper.payload} kg`);return {placement:updated,reasons:[...new Set([...reasons,...r.reasons])],path:r.path??idealPath(updated,current,placed),stack};}
  if(c.robotMode==='ideal')return {placement:{...updated,loadAbove:0},reasons:[...new Set(reasons)],path:idealPath(updated,current,placed),stack};
  if(box.weight+c.gripper.mass>c.gripper.payload+EPS)reasons.push('설정된 가반하중 초과');
  const path=gripperPath(updated,current,placed,c),workspace=c.workspace;
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1].tcp,b=path.points[i].tcp;
    const from=path.points[i-1].yaw||0,to=path.points[i].yaw||0,gripSize=yawEnvelope(c.gripper.width,c.gripper.depth,from,to),heldSize=yawEnvelope(current.size.w,current.size.d,from,to);
    const grip=swept(a,b,gripSize.w,gripSize.d,0,c.gripper.height,c.gripper.margin);
    const carrying=path.points[i].carrying,held=swept(a,b,heldSize.w,heldSize.d,s.h,0,0);
    if(c.reach&&!withinReach(a,b,c.reach)){reasons.push('로봇 TCP 도달 반경 밖 · 경로 포함');break;}
    const bounds=path.fixedGrasp?tiltSweeps(path.points[i-1],path.points[i],current,c):[grip,...(carrying?[held]:[])];
    if(bounds.some(v=>v.position.x<workspace.xMin-EPS||v.position.x+v.size.w>workspace.xMax+EPS||v.position.y<workspace.yMin-EPS||v.position.y+v.size.d>workspace.yMax+EPS||v.position.z< -EPS||v.position.z+v.size.h>workspace.zMax+EPS)){
      reasons.push('설정된 작업공간 밖');break;
    }
    const conflict=placed.find(other=>bounds.some(v=>intersects(v,other)));
    if(conflict){reasons.push(`그리퍼 / 운반 접근 경로 간섭 · ${conflict.id}`);break;}
  }
  if(robot){const result=robot.inspect(path,placed);if(!result.valid)reasons.push(...result.reasons);}
  return {placement:{...updated,loadAbove:0},reasons:[...new Set(reasons)],path,stack};
}
// Replaceable extension point; an actual robot implementation must supply joint/IK/full-link checks.
export interface RobotValidator { inspect(path:GripPath,placements:Placement[]):{valid:boolean;reasons:string[];level:'approximate'|'joint-ik'} }
export function supportRectangles(box:Placement){return box.supports.map(s=>s.rect);}

