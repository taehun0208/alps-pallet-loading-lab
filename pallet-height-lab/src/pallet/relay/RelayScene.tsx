import {allPallets,palletToWorld,palletToRobot,palletOffset,robotStack} from './palletStations';
import {tailGeometry,tailPoint} from './conveyorTail';
import {usesBranches,pusherBoxPosition,mainY,BRANCH} from './branchedConveyor';
import {usesRoller,atRollerStop,ROLLER} from './rollerQueue';
import {isSingleStraight,onBeltDisplay,transportDisplay,exitDisplayCenter} from './straightBoxView';
import {rejectLayout,rejectStation,rejectCenter,rejectMotion} from './rejectPallet';
import {addEndEffector} from './EndEffectorView';
import {boxGeometry} from './DentedBoxView';
import {SCANNER_OFFSET,REJECT_SECONDS,type Dent} from './intake';
import {robotKind,robotCount} from './fleet';
import {createGantryView} from './GantryView';
import {TWIN_SCENE,TWIN_CONVEYOR,TWIN_ROBOT_PALETTE,TWIN_CELL_COLORS as RELAY_COLORS,displayBoxColor} from './twinSceneTheme';
import {createFactoryLighting} from './factoryLighting';
import {createConveyorView} from './ConveyorView';
import {streamPosition} from './streamGeometry';
import {beltBounds,beltPosition,beltProgress,beltStation,sourcePickup,CONVEYOR} from './conveyor';
import {createFactoryEnvironment,FACTORY} from './FactoryEnvironment';
import {CONTEXTS,TRAVEL_MM} from './operations';
import type {ProcessPhase,ContextId} from './operations';
import { useEffect,useRef,useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRobotArmView } from '../RobotArmView';
import { DEFAULT_ROBOT_ARM } from '../robotArm';
import { incomingPosition } from '../constraints';
import { engineToRender,renderSize,centerOf } from '../coordinates';
import { poseQuaternion,movingHeight,uprightToolQuaternion } from '../poseRendering';
import { pathPosition } from '../PalletScene';
import { cellPose,toWorld,toLocal,park,transferMotion,cellRadius } from './layout';
import type { Scenario,Vec3 } from '../types';
import type { RelayMotion,RelayWorld } from './types';
interface Props { scenario:Scenario;world:RelayWorld;motions:RelayMotion[];focus:number|null;cameraVersion:number;phase:ProcessPhase;processProgress:number;context:ContextId;clock:number;clockRate?:number;explain?:boolean }
const vector=(p:Vec3)=>new THREE.Vector3(p.x/1000,p.z/1000,p.y/1000);
function dispose(group:THREE.Object3D){group.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh instanceof THREE.InstancedMesh)mesh.dispose();mesh.geometry?.dispose();for(const mat of Array.isArray(mesh.material)?mesh.material:mesh.material?[mesh.material]:[]){(mat as THREE.MeshBasicMaterial).map?.dispose();mat.dispose();}});}
export function RelayScene(props:Props){
 const count=props.world.cells.length;
 const visualClock=useRef({time:props.clock,rate:props.clockRate??0,stamp:performance.now()});
 if(visualClock.current.time!==props.clock||visualClock.current.rate!==(props.clockRate??0))visualClock.current={time:props.clock,rate:props.clockRate??0,stamp:performance.now()};
 const host=useRef<HTMLDivElement>(null),latest=useRef(props),stage=useRef<any>(null),[fallback,setFallback]=useState(false),[factoryVisible,setFactoryVisible]=useState(true);latest.current=props;
 useEffect(()=>{const el=host.current!;let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch{setFallback(true);return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(TWIN_SCENE.background);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.domElement.setAttribute('aria-label',`컨베이어와 ${count}대 로봇 3D 시뮬레이터`);renderer.domElement.dataset.robots=String(count);renderer.domElement.dataset.conveyors=String(usesBranches(props.scenario.pallet)?count+1:1);el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.02,100),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=2;controls.maxDistance=90;
  const disposeLighting=createFactoryLighting(renderer,scene);
  const content=new THREE.Group(),moving=new THREE.Group(),movingBoxes=new Map<string,THREE.Group>(),roots=Array.from({length:count},()=>new THREE.Group()),arms=roots.map((root,i)=>{const arm=robotKind(props.scenario.pallet,i)==='ceiling'?createGantryView(props.scenario.pallet):createRobotArmView(TWIN_ROBOT_PALETTE,'hyundai');root.add(arm.group);arm.group.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(root);return arm;});
  const grips=roots.map(root=>{const grip=new THREE.Group();root.add(grip);return grip;});scene.add(content,moving);const grid=new THREE.GridHelper(22,110,FACTORY.steel,FACTORY.seam);grid.position.y=-.405;grid.visible=false;scene.add(grid);stage.current={renderer,scene,camera,controls,grid,environment:null,labels:[],factoryVisible:true,content,moving,movingBoxes,roots,arms,grips,cargos:[],platforms:[],empties:[],infeed:[],stock:[],belt:null,beltBoxes:new Map()};
  const resize=()=>{renderer.setSize(el.clientWidth,el.clientHeight,false);const before=Math.max(1,1.5/camera.aspect);camera.aspect=el.clientWidth/Math.max(1,el.clientHeight);const after=Math.max(1,1.5/camera.aspect);camera.position.sub(controls.target).multiplyScalar(after/before).add(controls.target);camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(el);resize();let raf=0;
  const tick=()=>{const p=latest.current,clock=p.clock+Math.min(.12,(performance.now()-visualClock.current.stamp)/1000)*visualClock.current.rate,g=p.scenario.constraints.gripper,targets=Array.from({length:count},(_,i)=>({tcp:toLocal(park(i,p.scenario.pallet),i,p.scenario.pallet),rotation:new THREE.Quaternion()}));
   const transport=safeTransport(p.phase,p.processProgress,p.context);
   for(const [i,{cell:station,state:current}] of allPallets(p.world).entries()){const cargo=stage.current.cargos[i],platform=stage.current.platforms[i],feed=stage.current.infeed[i],stock=stage.current.stock[i],empty=stage.current.empties[i],loaded=station.placements.length>0;
    const cell=current,local=cell?safeTransport(cell.phase==='loading'?'packing':cell.phase,Math.min(1,(clock-cell.since)/9),p.context):transport;
    if(cargo){cargo.position.set(0,0,local.cargo);cargo.visible=local.showCargo;}
    if(platform){platform.position.set(0,0,local.platform);platform.visible=p.context!=='fixed';}
    if(empty){empty.position.copy(platform.position);empty.visible=cell?cell.phase==='returning':loaded&&!local.showCargo;}
    if(feed)feed.visible=false;
    if(stock)stock.visible=p.phase!=='ready'&&p.phase!=='receiving';
   }
   const beltClock=p.phase==='receiving'?p.processProgress*p.world.boxes.length*.35:clock;
   const scanning=p.world.boxes.some(b=>b.status==='belt'&&b.flow&&clock<b.flow.measuredAt&&Math.abs((usesBranches(p.scenario.pallet)?b.flow.transport?.kind==='main'?b.flow.transport.arc:-10000:usesRoller(p.scenario.pallet)?b.flow.roller?.arc??0:(clock-b.flow.enteredAt)*(p.world.stream?.speed??210))-SCANNER_OFFSET)<b.observation.size.w/2+50);
   const rejected=p.world.boxes.some(b=>b.scan?.verdict==='damaged'&&clock-b.scan.completedAt<2);
   const pushing=p.world.boxes.find(b=>b.status==='rejecting'&&b.flow?.reject&&clock-b.flow.reject.startedAt<BRANCH.pushSeconds);
   stage.current.belt?.update(beltClock*(p.world.stream?p.world.stream.speed/600:1),scanning,rejected,pushing?(clock-pushing.flow!.reject!.startedAt)/BRANCH.pushSeconds:0);
   for(const [id,item] of stage.current.beltBoxes){
    if(p.world.stream){const b=p.world.boxes.find(b=>b.observation.id===id);if(!b?.flow){item.object.visible=false;continue;}if((isSingleStraight(p.scenario.pallet)||usesBranches(p.scenario.pallet))){item.object.visible=onBeltDisplay(b);if(!item.object.visible)continue;}const position=usesBranches(p.scenario.pallet)&&b.status==='rejecting'?b.flow.reject!.from:streamPosition(b,b.status==='rejecting'?b.flow.measuredAt:clock,p.world.stream.speed,p.scenario.pallet);const center={...position,z:position.z+item.height/2},target=stage.current.rejectTargets?.get(id);item.object.position.copy(vector(b.status==='rejecting'&&target?usesBranches(p.scenario.pallet)?pusherBoxPosition(center,target,clock-b.flow.reject!.startedAt):rejectMotion(center,target,(clock-b.flow.measuredAt)/REJECT_SECONDS):center));continue;}
    const pad=p.world.pads[item.from];if(pad.boxId!==id)continue;
    const position=beltPosition(item.from,p.scenario.pallet,beltProgress(pad,item.from,p.scenario.pallet,clock));
    item.object.position.copy(vector({...position,z:position.z+item.height/2}));
   }
   const intake=stage.current.intake;if(intake){intake.visible=p.phase==='receiving';const bounds=beltBounds(p.scenario.pallet);intake.position.set((bounds.left+300+(p.processProgress*p.world.boxes.length%1)*2000)/1000,CONVEYOR.deck/1000+.13,CONVEYOR.front/1000);}
   renderer.domElement.dataset.beltTransit=JSON.stringify(p.world.pads.filter(v=>v.boxId).map(v=>({box:v.boxId,arrived:v.arrived,readyAt:v.readyAt})));
   if(p.world.stream){renderer.domElement.dataset.flow=JSON.stringify({conveyor:p.scenario.pallet.conveyorMode??'loop',quarantined:p.world.boxes.filter(b=>b.status==='quarantined').length,outfeed:p.world.boxes.filter(b=>b.status==='outfeed').length,rejecting:p.world.boxes.filter(b=>b.status==='rejecting').length,subs:usesBranches(p.scenario.pallet)?Array.from({length:count},(_,i)=>p.world.boxes.filter(b=>b.status==='belt'&&b.flow?.transport?.kind==='branch'&&b.flow.transport.robot===i).length):null,roller:usesRoller(p.scenario.pallet)?{waiting:p.world.boxes.filter(b=>b.status==='belt'&&b.flow?.roller&&b.flow.roller.arc>=beltBounds(p.scenario.pallet).right-beltBounds(p.scenario.pallet).left).length,head:p.world.boxes.find(b=>b.status==='belt'&&atRollerStop(b,p.scenario.pallet))?.observation.id??null}:null,scanning,time:clock,entered:p.world.stream.entered,measured:p.world.stream.measured,passes:p.world.stream.passes,cells:allPallets(p.world).map(v=>v.state!.phase),dispatched:p.world.stream.dispatched.length});renderer.domElement.dataset.beltPositions=JSON.stringify(p.world.boxes.filter(b=>b.status==='belt').map(b=>({id:b.observation.id,...streamPosition(b,clock,p.world.stream!.speed,p.scenario.pallet)})));}
   renderer.domElement.dataset.processPhase=p.phase;renderer.domElement.dataset.processProgress=p.processProgress.toFixed(3);renderer.domElement.dataset.cargoVisible=String(transport.showCargo);
   moving.visible=!!p.motions.length;const labels:string[]=[],active=new Set<number>();
   if((isSingleStraight(p.scenario.pallet)||usesBranches(p.scenario.pallet)))for(const [id,obj] of movingBoxes)obj.visible=transportDisplay(p.world.boxes.find(b=>b.observation.id===id),p.motions);
   for(const motion of p.motions){const a=motion.action,box=p.world.boxes.find(b=>b.observation.id===a.boxId)!.observation,obj=movingBoxes.get(a.boxId);if(!obj)continue;if((isSingleStraight(p.scenario.pallet)||usesBranches(p.scenario.pallet))){obj.visible=p.world.boxes.find(b=>b.observation.id===a.boxId)?.status==='reserved';if(!obj.visible)continue;}active.add(a.robot);
    if(a.segments){const m=transferMotion(a.segments,motion.progress,a.initialCenter,box.size.h/2);labels.push(`R${a.robot+1}: ${m.label}`);obj.position.copy(vector(m.center));obj.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),-m.yaw);
     const target=m.targets[a.robot];if(target)targets[a.robot]={tcp:toLocal(target.tcp,a.robot,p.scenario.pallet),rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-(target.yaw-cellPose(a.robot,p.scenario.pallet).angle))};
    }else if(a.path&&a.candidate){const c=a.candidate,state=pathPosition(a.path,Math.min(1,Math.max(0,(clock-motion.started)/a.seconds))),rotation=poseQuaternion(state.fromPose).slerp(poseQuaternion(state.toPose),state.blend),release=a.path.points.findIndex(v=>v.label==='내려놓기'),released=!state.carrying&&release>=0&&state.index>release;labels.push(`R${a.robot+1}: ${state.label}`);targets[a.robot]={tcp:palletToRobot(state.tcp,p.scenario.pallet,a.pallet),rotation};
     const offset=new THREE.Vector3(0,-box.size.h/2,0).applyQuaternion(rotation),center=state.carrying?(a.path.fixedGrasp?{x:state.tcp.x+offset.x,y:state.tcp.y+offset.z,z:state.tcp.z+offset.y}:{x:state.tcp.x,y:state.tcp.y,z:state.tcp.z-movingHeight(box.size,rotation)/2}):released?centerOf(c.placement.position,c.placement.size):centerOf(a.pickup??incomingPosition(),box.size);
     obj.position.copy(vector(palletToWorld(center,a.robot,p.scenario.pallet,a.pallet)));obj.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),-cellPose(a.robot,p.scenario.pallet).angle).multiply(released?poseQuaternion(c.placement.orientation):state.carrying?rotation:new THREE.Quaternion());
     if(a.tracking&&clock<a.tracking.graspAt){const b=p.world.boxes.find(b=>b.observation.id===a.boxId)!,pt=streamPosition(b,clock,p.world.stream!.speed,p.scenario.pallet);obj.position.copy(vector({...pt,z:pt.z+box.size.h/2}));obj.quaternion.identity();}
    }
   }
   const robotState=targets.map((t,i)=>{const toolRotation=robotKind(p.scenario.pallet,i)==='floor'?uprightToolQuaternion(t.rotation):t.rotation;grips[i].position.fromArray(engineToRender(t.tcp,p.scenario.pallet));grips[i].quaternion.copy(toolRotation);const state=arms[i].update(t.tcp,toolRotation,g.height,DEFAULT_ROBOT_ARM,p.scenario.pallet,robotStack(p.world,i,p.scenario.pallet));return {id:i+1,kind:robotKind(p.scenario.pallet,i),active:active.has(i),tcp:t.tcp,toolNormal:new THREE.Vector3(0,1,0).applyQuaternion(toolRotation).toArray(),reachable:state.pose.reachable,interference:state.hits.filter(Boolean)};});
   if((isSingleStraight(p.scenario.pallet)||usesBranches(p.scenario.pallet)))renderer.domElement.dataset.boxActors=JSON.stringify({belt:[...stage.current.beltBoxes].filter(([,item])=>item.object.visible).map(([id])=>id),carried:[...movingBoxes].filter(([,obj])=>obj.visible&&moving.visible).map(([id])=>id)});renderer.domElement.dataset.robotState=JSON.stringify(robotState);renderer.domElement.dataset.phase=labels.join(' / ');renderer.domElement.dataset.activeRobots=JSON.stringify([...active]);renderer.domElement.dataset.activeCount=String(active.size);stage.current.environment?.update(camera);controls.update();renderer.render(scene,camera);renderer.domElement.dataset.drawCalls=String(renderer.info.render.calls);renderer.domElement.dataset.triangles=String(renderer.info.render.triangles);raf=requestAnimationFrame(tick);
  };tick();return()=>{cancelAnimationFrame(raf);observer.disconnect();controls.dispose();if(stage.current.environment)scene.remove(stage.current.environment.group);dispose(scene);disposeLighting();renderer.dispose();renderer.domElement.remove();stage.current=null;};
 },[]);
 useEffect(()=>{const s=stage.current;if(!s)return;const p=props.scenario.pallet,center=props.focus===null?{x:(beltBounds(p).left+(usesRoller(p)?ROLLER.length+beltBounds(p).right:beltBounds(p).right))/2,y:p.conveyorExtensionMm?-900:0,z:500}:{...cellPose(props.focus,p),x:cellPose(props.focus,p).x+(p.palletsPerRobot===2?palletOffset(p,1)/2:0),z:400},target=vector(center);s.controls.target.copy(target);const distance=props.focus===null?Math.max(cellRadius(p)/1000+(count===1?6:7),(beltBounds(p).right-beltBounds(p).left+(usesRoller(p)?ROLLER.length:0))/1000*.86):robotKind(p,props.focus)==='ceiling'?8:p.palletsPerRobot===2?7.5:5.7;s.camera.position.copy(target).add(new THREE.Vector3(distance*.48,distance*.83,distance*.96).multiplyScalar(Math.max(1,1.5/s.camera.aspect)));s.controls.update();},[props.scenario,props.focus,props.cameraVersion]);
 useEffect(()=>{const s=stage.current;if(!s)return;const environment=createFactoryEnvironment(props.scenario.pallet);s.environment=environment;environment.group.visible=s.factoryVisible;s.scene.add(environment.group);s.renderer.domElement.dataset.factoryInstances=String(environment.instances);return()=>{s.scene.remove(environment.group);environment.dispose();s.environment=null;};},[props.scenario.pallet.width,props.scenario.pallet.depth,props.scenario.pallet.robotLayout]);
 useEffect(()=>{const s=stage.current;if(!s)return;s.factoryVisible=factoryVisible;if(s.environment)s.environment.group.visible=factoryVisible;s.grid.visible=!factoryVisible;s.renderer.domElement.dataset.environment=factoryVisible?'factory':'analysis';for(const label of s.labels)label.visible=!factoryVisible||label.name==='cell-label';},[factoryVisible]);
 const rejectView=()=>{const s=stage.current;if(!s)return;const p=props.scenario.pallet,layout=rejectLayout(p,props.world.boxes.filter(b=>b.status==='quarantined'||b.status==='rejecting')),n=Math.max(1,layout.pallets.length),first=rejectStation(p),last=rejectStation(p,n-1),cols=Math.min(3,n),target=vector({x:first.x+(cols-1)*(p.width+350)/2,y:(first.y+last.y)/2,z:100}),distance=Math.max(3.2,(cols*p.width+(cols-1)*350)/1000,Math.abs(first.y-last.y)/1000+p.depth/1000);s.controls.target.copy(target);s.camera.position.copy(target).add(new THREE.Vector3(distance*.35,distance*.9,distance*.85).multiplyScalar(Math.max(1,1.5/s.camera.aspect)));s.controls.update();};
 const overview=(close:boolean)=>{const s=stage.current;if(!s)return;const p=props.scenario.pallet,b=beltBounds(p),d=Math.max(cellRadius(p)/1000+(close?3:7),close?0:(b.right-b.left+(usesRoller(p)?ROLLER.length:0))/1000*.86);s.controls.target.set(close?(cellPose(0,p).x+(p.palletsPerRobot===2?palletOffset(p,1)/2:0))/1000:(b.left+b.right+(usesRoller(p)?ROLLER.length:0))/2000,.5,close?.3:p.conveyorExtensionMm?-.9:0);s.camera.position.copy(s.controls.target).add(new THREE.Vector3(d*.48,d*.83,d*.96).multiplyScalar(Math.max(1,1.5/s.camera.aspect)));s.controls.update();};
 useEffect(()=>{const s=stage.current;if(!s)return;dispose(s.content);s.content.clear();dispose(s.moving);s.moving.clear();s.movingBoxes.clear();for(const grip of s.grips){dispose(grip);grip.clear();}
  s.belt?.dispose();s.beltBoxes.clear();s.labels=[];s.cargos=[];s.platforms=[];s.empties=[];s.infeed=[];s.stock=[];
  const p=props.scenario.pallet,g=props.scenario.constraints.gripper;s.renderer.domElement.dataset.beltLength=String(beltBounds(p).right-beltBounds(p).left);s.renderer.domElement.dataset.conveyorLayout=JSON.stringify(usesBranches(p)?{mode:'main-sub',main:1,subs:count,scanner:{x:beltBounds(p).left+SCANNER_OFFSET,y:mainY},pusher:{x:beltBounds(p).left+BRANCH.pusherOffset,y:mainY},forks:Array.from({length:count},(_,i)=>cellPose(i,p).x),tail:{robot:tailGeometry(p).robot+1,end:tailPoint(p,tailGeometry(p).length)}}:{mode:p.conveyorMode??'loop'});s.belt=createConveyorView(p);s.content.add(s.belt.group);
  const cube=(group:THREE.Group,size:number[],position:THREE.Vector3,color:string,opacity=1,dent?:Dent)=>{const geo=boxGeometry(size as [number,number,number],dent),mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.7,transparent:opacity<1,opacity}));mesh.position.copy(position);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:TWIN_SCENE.edge,transparent:true,opacity:.45}));edge.position.copy(position);group.add(edge);return mesh;};
  const label=(text:string,pos:Vec3,color:string,scale=1.4)=>{const canvas=document.createElement('canvas');canvas.width=768;canvas.height=96;const ctx=canvas.getContext('2d')!;ctx.fillStyle=TWIN_SCENE.label;ctx.fillRect(0,0,768,96);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.strokeRect(2,2,764,92);ctx.fillStyle=TWIN_SCENE.text;ctx.textAlign='center';ctx.font='bold 46px sans-serif';ctx.fillText(text,384,64);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.SpriteMaterial({map:texture,depthTest:false}),sprite=new THREE.Sprite(mat);sprite.scale.set(scale*1.2,scale*.15,1);sprite.position.copy(vector(pos));sprite.name=text.startsWith('P0')||text.startsWith('PICK')||text.startsWith('INFEED')||text.startsWith('REJECT')?'cell-label':'detail-label';sprite.visible=!s.factoryVisible||sprite.name==='cell-label';s.labels.push(sprite);s.content.add(sprite);};
  const woodPallet=(parent:THREE.Group)=>{const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:FACTORY.timber,roughness:.88}),parts:Array<{x:number;y:number;z:number;w:number;h:number;d:number}>=[];for(let k=0;k<7;k++)parts.push({x:0,y:-.018,z:(k/6-.5)*(p.depth/1000-.1),w:p.width/1000,h:.035,d:.09});for(const x of [-.36,0,.36])parts.push({x:x*p.width/1000,y:-.075,z:0,w:.075,h:.08,d:p.depth/1000});const mesh=new THREE.InstancedMesh(geometry,material,parts.length),o=new THREE.Object3D();parts.forEach((b,i)=>{o.position.set(b.x,b.y,b.z);o.scale.set(b.w,b.h,b.d);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);};
  allPallets(props.world).forEach(({cell,robot:i,pallet})=>{const pose={...cellPose(i,p),x:cellPose(i,p).x+palletOffset(p,pallet)},group=new THREE.Group();group.position.copy(vector({...pose,z:0}));group.rotation.y=-pose.angle;s.content.add(group);s.roots[i].position.copy(vector({...cellPose(i,p),z:0}));s.roots[i].rotation.y=group.rotation.y;
   const cargo=new THREE.Group(),platform=new THREE.Group(),empty=new THREE.Group(),feed=new THREE.Group(),stock=new THREE.Group();group.add(cargo,platform,empty,feed,stock);s.empties.push(empty);s.cargos.push(cargo);s.platforms.push(platform);s.infeed.push(feed);s.stock.push(stock);
   woodPallet(cargo);
   if(props.scenario.practical?.jig){
    // Outer guide frame only: no wall reactions are used by the static support model.
    cube(group,[.04,.08,p.depth/1000+.08],new THREE.Vector3(-p.width/2000-.025,.04,0),TWIN_SCENE.tool);
    cube(group,[p.width/1000+.08,.08,.04],new THREE.Vector3(0,.04,-p.depth/2000-.025),TWIN_SCENE.tool);
   }
   const boundary=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(p.width/1000,p.maxHeight/1000,p.depth/1000)),new THREE.LineBasicMaterial({color:RELAY_COLORS[i],transparent:true,opacity:.3}));boundary.position.y=p.maxHeight/2000;group.add(boundary);
   const input=incomingPosition();if(!props.world.stream)cube(group,[.8,.06,.65],new THREE.Vector3(...engineToRender({x:input.x+400,y:input.y+325,z:-30},p)),TWIN_SCENE.source);
   label(`P0${i* (props.world.secondaryCells?2:1)+pallet+1} · R${i+1}/P${pallet+1} · ${cell.placements.length} BOXES`,palletToWorld({x:p.width/2,y:p.depth+250,z:30},i,p,pallet),RELAY_COLORS[i],1.4);
   if(!pallet)label(`PICK 0${i+1}`,{...beltStation(i,p),y:CONVEYOR.front-600,z:CONVEYOR.deck+160},RELAY_COLORS[i],1.25);
   if(!props.world.stream)label(`R${i+1} 재고 ${cell.queue.length}개`,toWorld({x:input.x+400,y:input.y+400,z:630},i,p),RELAY_COLORS[i]);
   for(const b of cell.placements){const type=props.scenario.types.find(t=>t.id===b.typeId);cube(cargo,renderSize(b.size),new THREE.Vector3(...engineToRender(centerOf(b.position,b.size),p)),displayBoxColor(type?.color||RELAY_COLORS[i]));}
   // The queue is an inventory diagram; only one representative box is full scale.
   const first=props.world.boxes.find(b=>b.observation.id===cell.queue[0]);if(first&&!props.world.pads[(i+count-1)%count]?.boxId&&!props.motions.some(m=>m.action.robot===i)){const b=first.observation,type=props.scenario.types.find(t=>t.id===b.typeId);cube(stock,renderSize(b.size),new THREE.Vector3(...engineToRender(centerOf(sourcePickup(props.world,b,i,p),b.size),p)),displayBoxColor(type?.color||RELAY_COLORS[i]),.7);}
   cell.queue.slice(0,5).forEach((id,j)=>{const b=props.world.boxes.find(b=>b.observation.id===id)!.observation,type=props.scenario.types.find(t=>t.id===b.typeId);cube(stock,[.11,.1,.11],new THREE.Vector3(...engineToRender({x:input.x+80+j*145,y:input.y+720,z:50},p)),displayBoxColor(type?.color||RELAY_COLORS[i]));});
   // Tool envelope is the same width/depth/height+margin used by path inspection.
   const envelope=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry((g.width+2*g.margin)/1000,g.height/1000,(g.depth+2*g.margin)/1000)),new THREE.LineBasicMaterial({color:RELAY_COLORS[i]}));envelope.position.y=g.height/2000;if(!pallet)s.grips[i].add(envelope);else dispose(envelope);
   woodPallet(empty);
   cube(platform,[p.width/1000*.88,.18,p.depth/1000*.88],new THREE.Vector3(0,-.24,0),TWIN_SCENE.platform);
   for(const x of [-.35,.35])for(const z of [-.25,.25])cube(platform,[.14,.16,.18],new THREE.Vector3(x,-.32,z),TWIN_SCENE.wheel);
   const laneEnd=palletToWorld({x:p.width/2,y:p.depth/2+TRAVEL_MM,z:-100},i,p,pallet),laneStart=palletToWorld({x:p.width/2,y:p.depth/2,z:-100},i,p,pallet);
   const route=new THREE.Line(new THREE.BufferGeometry().setFromPoints([vector(laneStart),vector(laneEnd)]),new THREE.LineDashedMaterial({color:RELAY_COLORS[i],dashSize:.14,gapSize:.12}));route.computeLineDistances();s.content.add(route);label(props.context==='fixed'?'OUT · 컨베이어':'OUT · 3 m 전용 통로',{...laneEnd,z:60},RELAY_COLORS[i],1.4);
   if(!pallet)addEndEffector(s.grips[i],g,props.scenario.practical?.tool??'vacuum');


  });
  const intake=new THREE.Group();cube(intake,[.36,.26,.3],new THREE.Vector3(),FACTORY.carton);s.content.add(intake);s.intake=intake;
  label('INFEED / SCAN',{x:beltBounds(p).left+650,y:usesBranches(p)?mainY:CONVEYOR.front,z:1700},RELAY_COLORS[0],1.4);
  if(usesBranches(p)){label('MAIN · 공용 입고 벨트',{x:(beltBounds(p).left+beltBounds(p).right)/2,y:mainY-650,z:500},TWIN_CONVEYOR.main,2.2);label('REJECT · 분기 전 측면 푸셔',{x:beltBounds(p).left+BRANCH.pusherOffset,y:mainY-1000,z:650},TWIN_CONVEYOR.main,1.8);for(let i=0;i<count;i++)label(`SUB 0${i+1} → R${i+1}`,{x:cellPose(i,p).x,y:mainY+900,z:700},TWIN_CONVEYOR.sub,1.4);}
  props.world.pads.forEach((pad,i)=>{if(!pad.boxId||props.motions.some(m=>m.action.boxId===pad.boxId))return;const b=props.world.boxes.find(b=>b.observation.id===pad.boxId)!.observation,type=props.scenario.types.find(t=>t.id===b.typeId),object=new THREE.Group();cube(object,renderSize(b.size),new THREE.Vector3(),displayBoxColor(type?.color||FACTORY.carton));s.content.add(object);s.beltBoxes.set(pad.boxId,{object,from:i,height:b.size.h});});
  if(props.world.stream)for(const b of props.world.boxes.filter(b=>b.status==='belt'||b.status==='rejecting')){const object=new THREE.Group(),type=props.scenario.types.find(t=>t.id===b.observation.typeId);cube(object,renderSize(b.observation.size),new THREE.Vector3(),displayBoxColor(type?.color||FACTORY.carton),1,b.deformation);s.content.add(object);s.beltBoxes.set(b.observation.id,{object,height:b.observation.size.h});}
  s.rejectTargets=new Map();
  if(props.world.stream){
   const rejects=props.world.boxes.filter(b=>b.status==='quarantined'||b.status==='rejecting'),layout=rejectLayout(p,rejects),pallets=layout.pallets.length?layout.pallets:[{index:0,placements:[]}];
   const first=rejectStation(p),last=rejectStation(p,Math.max(0,pallets.length-1));
   const cols=Math.min(3,pallets.length),yardWidth=cols*p.width+(cols-1)*350+400,yardDepth=first.y-last.y+p.depth+400;
   cube(s.content,[yardWidth/1000,.08,yardDepth/1000],vector({x:first.x+(cols-1)*(p.width+350)/2,y:(first.y+last.y)/2,z:-445}),FACTORY.floor);
   for(const pallet of pallets){
    const station=rejectStation(p,pallet.index),root=new THREE.Group();root.position.copy(vector(station));woodPallet(root);s.content.add(root);
    const placed=pallet.placements.filter(q=>props.world.boxes.find(b=>b.observation.id===q.boxId)?.status==='quarantined');
    label(`REJECT Q${pallet.index+1} · 불량 전용 · ${placed.length}개`,{...station,y:station.y-p.depth/2-180,z:200},TWIN_ROBOT_PALETTE.warning,1.75);
    for(const q of pallet.placements){const b=rejects.find(b=>b.observation.id===q.boxId)!,center=rejectCenter(p,pallet.index,q);s.rejectTargets.set(q.boxId,center);if(b.status!=='quarantined')continue;const type=props.scenario.types.find(t=>t.id===b.observation.typeId),mesh=cube(s.content,renderSize(b.observation.size),vector(center),displayBoxColor(type?.color||FACTORY.carton),1,b.deformation);mesh.name=`quarantine-${q.boxId}`;}
   }
   s.renderer.domElement.dataset.rejectPallets=JSON.stringify({count:pallets.length,boxes:layout.pallets.flatMap(pal=>pal.placements.map(q=>({id:q.boxId,pallet:pal.index,position:q.position,size:q.size,status:rejects.find(b=>b.observation.id===q.boxId)!.status}))),overflow:layout.overflow});
   if(layout.overflow.length)label(`REJECT 대형물 대기 ${layout.overflow.length}개 · 규격 초과`,{...first,y:first.y-p.depth-400,z:200},TWIN_ROBOT_PALETTE.warning,2);
   if(usesRoller(p))label('PICK · 롤러 순차 대기', {x:-950,y:CONVEYOR.front+700,z:550},'#be682c',1.9);
   const out=props.world.boxes.filter(b=>b.status==='outfeed'),b=out.at(-1),exit=b&&isSingleStraight(p)?exitDisplayCenter(p,b.observation.size,props.world.boxes):{x:beltBounds(p).right+550,y:CONVEYOR.front},x=exit.x,y=exit.y;
   if(b){cube(s.content,[1.05,.08,.95],vector({x,y,z:CONVEYOR.deck-40}),TWIN_SCENE.platform);const t=props.scenario.types.find(t=>t.id===b.observation.typeId);cube(s.content,renderSize(b.observation.size),vector({x,y,z:CONVEYOR.deck+b.observation.size.h/2}),displayBoxColor(t?.color||FACTORY.carton),1,b.deformation);label(`INFEED 출구 대기 ${out.length}개 · 대표 1개`,{x,y:y-600,z:CONVEYOR.deck+650},TWIN_ROBOT_PALETTE.warning,1.7);}
  }
  for(const motion of props.motions){const a=motion.action,b=props.world.boxes.find(b=>b.observation.id===a.boxId)!.observation,type=props.scenario.types.find(t=>t.id===b.typeId),obj=new THREE.Group();cube(obj,renderSize(b.size),new THREE.Vector3(),displayBoxColor(type?.color||FACTORY.carton));s.moving.add(obj);s.movingBoxes.set(a.boxId,obj);}
  if(props.explain){const a=props.motions[0]?.action,c=a?.candidate;if(a?.path&&c){
   const points=a.path.points.map(v=>vector(palletToWorld(v.tcp,a.robot,p,a.pallet)));
   const path=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:RELAY_COLORS[a.robot]}));s.content.add(path);
   const place=c.placement,ghost=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...renderSize(place.size))),new THREE.LineDashedMaterial({color:RELAY_COLORS[a.robot],dashSize:.05,gapSize:.035}));ghost.position.copy(vector(palletToWorld(centerOf(place.position,place.size),a.robot,p,a.pallet)));ghost.computeLineDistances();s.content.add(ghost);
   for(const contact of place.supports){const r=contact.rect;cube(s.content,[r.w/1000,.004,r.d/1000],vector(palletToWorld({x:r.x+r.w/2,y:r.y+r.d/2,z:place.position.z+2},a.robot,p,a.pallet)),RELAY_COLORS[a.robot],.4);}
  }}
  s.renderer.domElement.dataset.tool=props.scenario.practical?.tool??'vacuum';s.renderer.domElement.dataset.jig=String(!!props.scenario.practical?.jig);
  s.renderer.domElement.dataset.layout=JSON.stringify(Array.from({length:robotCount(p)},(_,i)=>robotKind(p,i)));
  s.renderer.domElement.dataset.pads=JSON.stringify(props.world.pads.map(p=>p.boxId));
  s.renderer.domElement.dataset.queues=JSON.stringify(props.world.cells.map(c=>c.queue));s.renderer.domElement.dataset.pallets=JSON.stringify(allPallets(props.world).map(v=>({robot:v.robot+1,pallet:v.pallet+1,count:v.cell.placements.length,phase:v.state?.phase,position:palletToWorld({x:p.width/2,y:p.depth/2,z:0},v.robot,p,v.pallet)})));s.renderer.domElement.dataset.placed=JSON.stringify(allPallets(props.world).map(v=>v.cell.placements.map(p=>p.id)));s.renderer.domElement.dataset.revision=String(props.world.revision);
 },[props.scenario,props.world.stream?`${props.world.runId}:${props.world.revision}`:props.world,props.context,props.motions.map(m=>`${m.action.robot}:${m.action.boxId}:${m.action.kind}`).join('|')]);
 return <div className="relay-scene" ref={host} data-testid="relay-scene">{fallback&&<p>WebGL을 사용할 수 없습니다. 아래 재고와 전달 기록으로 결과를 확인하세요.</p>}<div className="relay-scene-note">{usesBranches(props.scenario.pallet)?'MAIN → SUB / PRE-BRANCH REJECT':props.scenario.pallet.conveyorMode==='straight'?'BELT → ROLLER FIFO':'LOOP CONVEYOR'} / {count} PICK ZONES<br/>{props.world.stream?usesBranches(props.scenario.pallet)?`입구 스캔 · 불량 측면 배출 · ${count}개 서브 선두 집기`:usesRoller(props.scenario.pallet)?`롤러 ${ROLLER.speed} mm/s · 100 mm 간격 · 정지 후 순차 집기`:`연속 이송 ${props.world.stream.speed} mm/s · 이동 중 추적 집기`:'공용 벨트 600 mm/s · 빈 구역에 도착 후 집기'}</div><div className="factory-view-controls" aria-label="공장 시점 설정"><button onClick={()=>overview(false)}>공장 전경</button><button onClick={()=>overview(true)}>작업셀 확대</button>{props.world.stream&&<button onClick={rejectView}>불량 팔레트 보기</button>}<button aria-pressed={factoryVisible} onClick={()=>setFactoryVisible(v=>!v)}>{factoryVisible?'시설 숨기기':'시설 표시'}</button></div><span className="relay-scene-help">드래그 회전 · 휠 확대 · 우클릭 이동</span></div>;
}

function safeTransport(phase:ProcessPhase,progress:number,context:ContextId){
 const c=CONTEXTS[context],travel=TRAVEL_MM/c.transportSpeed,total=travel+c.dock;
 const move=Math.max(0,Math.min(1,(progress*total-c.dock)/travel))*TRAVEL_MM/1000;
 return {cargo:phase==='outbound'?move:0,platform:phase==='outbound'?move:phase==='returning'?TRAVEL_MM/1000-move:0,showCargo:!['returning','complete'].includes(phase)};
}
