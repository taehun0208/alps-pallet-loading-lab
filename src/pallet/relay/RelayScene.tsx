import './scene-inspector.css';
import {TWIN_SCENE,TWIN_ROBOT_PALETTE,TWIN_CELL_COLORS as RELAY_COLORS,displayBoxColor} from './twinSceneTheme';
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
import { poseQuaternion,movingHeight } from '../poseRendering';
import { pathPosition } from '../PalletScene';
import { cellPose,toWorld,toLocal,park,transferMotion,ROBOT_COUNT,cellRadius } from './layout';
import type { Scenario,Vec3 } from '../types';
import type { RelayMotion,RelayWorld } from './types';
interface Props { scenario:Scenario;world:RelayWorld;motions:RelayMotion[];focus:number|null;cameraVersion:number;phase:ProcessPhase;processProgress:number;context:ContextId;clock:number;clockRate?:number;selectedBoxId?:string|null;onSelectBox?:(id:string,robot:number|null)=>void }
const vector=(p:Vec3)=>new THREE.Vector3(p.x/1000,p.z/1000,p.y/1000);
function dispose(group:THREE.Object3D){group.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh instanceof THREE.InstancedMesh)mesh.dispose();mesh.geometry?.dispose();for(const mat of Array.isArray(mesh.material)?mesh.material:mesh.material?[mesh.material]:[]){(mat as THREE.MeshBasicMaterial).map?.dispose();mat.dispose();}});}
export function RelayScene(props:Props){
 const visualClock=useRef({time:props.clock,rate:props.clockRate??0,stamp:performance.now()});
 if(visualClock.current.time!==props.clock||visualClock.current.rate!==(props.clockRate??0))visualClock.current={time:props.clock,rate:props.clockRate??0,stamp:performance.now()};
 const host=useRef<HTMLDivElement>(null),latest=useRef(props),stage=useRef<any>(null),[fallback,setFallback]=useState(false),[factoryVisible,setFactoryVisible]=useState(!props.world.stream),[cameraMode,setCameraMode]=useState<'perspective'|'top'>('perspective');latest.current=props;
 useEffect(()=>{const el=host.current!;let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch{setFallback(true);return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(TWIN_SCENE.background);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.domElement.setAttribute('aria-label','하나의 순환 컨베이어와 네 로봇팔 3D 시뮬레이터');renderer.domElement.dataset.robots=String(ROBOT_COUNT);renderer.domElement.dataset.conveyors='1';el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.02,100),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=2;controls.maxDistance=40;
  const disposeLighting=createFactoryLighting(renderer,scene);
  const content=new THREE.Group(),moving=new THREE.Group(),movingBoxes=new Map<string,THREE.Group>(),roots=Array.from({length:ROBOT_COUNT},()=>new THREE.Group()),arms=roots.map(root=>{const arm=createRobotArmView(TWIN_ROBOT_PALETTE,'hyundai');root.add(arm.group);arm.group.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(root);return arm;});
  const grips=roots.map(root=>{const grip=new THREE.Group();root.add(grip);return grip;});scene.add(content,moving);const grid=new THREE.GridHelper(22,22,FACTORY.steel,FACTORY.seam);grid.position.y=-.405;grid.scale.z=.4;for(const material of Array.isArray(grid.material)?grid.material:[grid.material]){material.transparent=true;material.opacity=.18;}grid.visible=false;scene.add(grid);stage.current={renderer,scene,camera,controls,grid,environment:null,labels:[],factoryVisible:!props.world.stream,content,moving,movingBoxes,roots,arms,grips,cargos:[],platforms:[],empties:[],infeed:[],stock:[],belt:null,beltBoxes:new Map()};
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerStart:{x:number;y:number}|null=null;
  const pointerDown=(event:PointerEvent)=>{pointerStart=event.button===0?{x:event.clientX,y:event.clientY}:null;};
  const pointerUp=(event:PointerEvent)=>{const start=pointerStart;pointerStart=null;if(!start||Math.hypot(start.x-event.clientX,start.y-event.clientY)>5||!latest.current.onSelectBox)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects([content,moving],true).find(hit=>{let o:THREE.Object3D|null=hit.object;while(o){if(!o.visible)return false;o=o.parent;}return !!hit.object.userData.boxId;});if(hit)latest.current.onSelectBox(String(hit.object.userData.boxId),hit.object.userData.robot??null);};
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
  const resize=()=>{renderer.setSize(el.clientWidth,el.clientHeight,false);const before=Math.max(1,1.5/camera.aspect);camera.aspect=el.clientWidth/Math.max(1,el.clientHeight);const after=Math.max(1,1.5/camera.aspect);camera.position.sub(controls.target).multiplyScalar(after/before).add(controls.target);camera.updateProjectionMatrix();if(latest.current.world.stream)stage.current?.fitCamera?.();};const observer=new ResizeObserver(resize);observer.observe(el);resize();let raf=0;
  const tick=()=>{const p=latest.current,clock=p.clock+Math.min(.12,(performance.now()-visualClock.current.stamp)/1000)*visualClock.current.rate,g=p.scenario.constraints.gripper,targets=Array.from({length:ROBOT_COUNT},(_,i)=>({tcp:toLocal(park(i,p.scenario.pallet),i,p.scenario.pallet),rotation:new THREE.Quaternion()}));
   const transport=safeTransport(p.phase,p.processProgress,p.context);
   for(let i=0;i<ROBOT_COUNT;i++){const cargo=stage.current.cargos[i],platform=stage.current.platforms[i],feed=stage.current.infeed[i],stock=stage.current.stock[i],empty=stage.current.empties[i],loaded=p.world.cells[i].placements.length>0;
    const cell=p.world.stream?.cells[i],local=cell?safeTransport(cell.phase==='loading'?'packing':cell.phase,Math.min(1,(clock-cell.since)/9),p.context):transport;
    if(cargo){cargo.position.set(0,0,local.cargo);cargo.visible=local.showCargo;}
    if(platform){platform.position.set(0,0,local.platform);platform.visible=p.context!=='fixed';}
    if(empty){empty.position.copy(platform.position);empty.visible=cell?cell.phase==='returning':loaded&&!local.showCargo;}
    if(feed)feed.visible=false;
    if(stock)stock.visible=p.phase!=='ready'&&p.phase!=='receiving';
   }
   const beltClock=p.phase==='receiving'?p.processProgress*p.world.boxes.length*.35:clock;
   stage.current.belt?.update(beltClock*(p.world.stream?p.world.stream.speed/600:1));
   for(const [id,item] of stage.current.beltBoxes){
    if(p.world.stream){const b=p.world.boxes.find(b=>b.observation.id===id);if(!b?.flow){item.object.visible=false;continue;}const position=streamPosition(b,clock,p.world.stream.speed,p.scenario.pallet);item.object.position.copy(vector({...position,z:position.z+item.height/2}));continue;}
    const pad=p.world.pads[item.from];if(pad.boxId!==id)continue;
    const position=beltPosition(item.from,p.scenario.pallet,beltProgress(pad,item.from,p.scenario.pallet,clock));
    item.object.position.copy(vector({...position,z:position.z+item.height/2}));
   }
   const intake=stage.current.intake;if(intake){intake.visible=p.phase==='receiving';const bounds=beltBounds(p.scenario.pallet);intake.position.set((bounds.left+300+(p.processProgress*p.world.boxes.length%1)*2000)/1000,CONVEYOR.deck/1000+.13,CONVEYOR.front/1000);}
   renderer.domElement.dataset.beltTransit=JSON.stringify(p.world.pads.filter(v=>v.boxId).map(v=>({box:v.boxId,arrived:v.arrived,readyAt:v.readyAt})));
   if(p.world.stream){renderer.domElement.dataset.flow=JSON.stringify({time:clock,entered:p.world.stream.entered,measured:p.world.stream.measured,passes:p.world.stream.passes,cells:p.world.stream.cells.map(c=>c.phase),dispatched:p.world.stream.dispatched.length});renderer.domElement.dataset.beltPositions=JSON.stringify(p.world.boxes.filter(b=>b.status==='belt').map(b=>({id:b.observation.id,...streamPosition(b,clock,p.world.stream!.speed,p.scenario.pallet)})));}
   renderer.domElement.dataset.processPhase=p.phase;renderer.domElement.dataset.processProgress=p.processProgress.toFixed(3);renderer.domElement.dataset.cargoVisible=String(transport.showCargo);
   moving.visible=!!p.motions.length;const labels:string[]=[],active=new Set<number>();
   for(const motion of p.motions){const a=motion.action,box=p.world.boxes.find(b=>b.observation.id===a.boxId)!.observation,obj=movingBoxes.get(a.boxId);if(!obj)continue;active.add(a.robot);
    if(a.segments){const m=transferMotion(a.segments,motion.progress,a.initialCenter,box.size.h/2);labels.push(`R${a.robot+1}: ${m.label}`);obj.position.copy(vector(m.center));obj.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),-m.yaw);
     const target=m.targets[a.robot];if(target)targets[a.robot]={tcp:toLocal(target.tcp,a.robot,p.scenario.pallet),rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-(target.yaw-cellPose(a.robot,p.scenario.pallet).angle))};
    }else if(a.path&&a.candidate){const c=a.candidate,state=pathPosition(a.path,Math.min(1,Math.max(0,(clock-motion.started)/a.seconds))),rotation=poseQuaternion(state.fromPose).slerp(poseQuaternion(state.toPose),state.blend),release=a.path.points.findIndex(v=>v.label==='내려놓기'),released=!state.carrying&&release>=0&&state.index>release;labels.push(`R${a.robot+1}: ${state.label}`);targets[a.robot]={tcp:state.tcp,rotation};
     const offset=new THREE.Vector3(0,-box.size.h/2,0).applyQuaternion(rotation),center=state.carrying?(a.path.fixedGrasp?{x:state.tcp.x+offset.x,y:state.tcp.y+offset.z,z:state.tcp.z+offset.y}:{x:state.tcp.x,y:state.tcp.y,z:state.tcp.z-movingHeight(box.size,rotation)/2}):released?centerOf(c.placement.position,c.placement.size):centerOf(a.pickup??incomingPosition(),box.size);
     obj.position.copy(vector(toWorld(center,a.robot,p.scenario.pallet)));obj.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),-cellPose(a.robot,p.scenario.pallet).angle).multiply(released?poseQuaternion(c.placement.orientation):state.carrying?rotation:new THREE.Quaternion());
     if(a.tracking&&clock<a.tracking.graspAt){const b=p.world.boxes.find(b=>b.observation.id===a.boxId)!,pt=streamPosition(b,clock,p.world.stream!.speed,p.scenario.pallet);obj.position.copy(vector({...pt,z:pt.z+box.size.h/2}));obj.quaternion.identity();}
    }
   }
   const robotState=targets.map((t,i)=>{grips[i].position.fromArray(engineToRender(t.tcp,p.scenario.pallet));grips[i].quaternion.copy(t.rotation);const state=arms[i].update(t.tcp,t.rotation,g.height,DEFAULT_ROBOT_ARM,p.scenario.pallet,p.world.cells[i].placements);return {id:i+1,active:active.has(i),tcp:t.tcp,reachable:state.pose.reachable,interference:state.hits.filter(Boolean)};});
   renderer.domElement.dataset.robotState=JSON.stringify(robotState);renderer.domElement.dataset.phase=labels.join(' / ');renderer.domElement.dataset.activeRobots=JSON.stringify([...active]);renderer.domElement.dataset.activeCount=String(active.size);stage.current.environment?.update(camera);controls.update();renderer.render(scene,camera);renderer.domElement.dataset.drawCalls=String(renderer.info.render.calls);renderer.domElement.dataset.triangles=String(renderer.info.render.triangles);raf=requestAnimationFrame(tick);
  };tick();return()=>{cancelAnimationFrame(raf);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);controls.dispose();if(stage.current.environment)scene.remove(stage.current.environment.group);dispose(scene);disposeLighting();renderer.dispose();renderer.domElement.remove();stage.current=null;};
 },[]);
 const frameCamera=(mode:'perspective'|'top',whole=false)=>{
  const s=stage.current;if(!s)return;const p=props.scenario.pallet,focus=whole?null:props.focus;
  if(!props.world.stream){const center=focus===null?{x:-350,y:0,z:500}:{...cellPose(focus,p),z:400},target=vector(center),distance=focus===null?cellRadius(p)/1000+7:4;s.controls.target.copy(target);s.camera.position.copy(target).add((mode==='top'?new THREE.Vector3(0,distance*1.45,.001):new THREE.Vector3(distance*.48,distance*.83,distance*.96)).multiplyScalar(Math.max(1,1.5/s.camera.aspect)));s.controls.update();return;}
  const belt=beltBounds(p),cell=focus===null?null:cellPose(focus,p);
  const min=new THREE.Vector3((cell?cell.x-p.width/2-1200:Math.min(belt.left-450,cellPose(0,p).x-p.width/2-1200))/1000,-.4,(cell?-1100:CONVEYOR.back-450)/1000);
  const max=new THREE.Vector3((cell?cell.x+p.width/2+300:belt.right+450)/1000,Math.max(2.9,p.maxHeight/1000+.35),(p.depth+1400)/1000);
  const target=min.clone().add(max).multiplyScalar(.5),direction=(mode==='top'?new THREE.Vector3(0,1,.001):new THREE.Vector3(.035,.62,1)).normalize();
  // Fit all eight work-area corners in both FOV axes, including perspective depth.
  // This avoids the old aspect multiplier shrinking wide dashboard viewports.
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize(),tanV=Math.tan(THREE.MathUtils.degToRad(s.camera.fov/2)),tanH=tanV*s.camera.aspect;
  let distance=0;for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z]){const corner=new THREE.Vector3(x,y,z).sub(target),depth=corner.dot(direction);distance=Math.max(distance,depth+Math.abs(corner.dot(right))*1.1/tanH,depth+Math.abs(corner.dot(up))*1.1/tanV);}
  s.controls.maxDistance=Math.max(40,distance*1.8);s.controls.target.copy(target);s.camera.position.copy(target).addScaledVector(direction,distance);s.controls.update();
 };
 useEffect(()=>{const s=stage.current;if(s)s.fitCamera=()=>frameCamera(cameraMode);frameCamera(cameraMode);},[props.scenario,props.focus,props.cameraVersion,cameraMode]);
 useEffect(()=>{const s=stage.current;if(!s)return;const environment=createFactoryEnvironment(props.scenario.pallet);s.environment=environment;environment.group.visible=s.factoryVisible;s.scene.add(environment.group);s.renderer.domElement.dataset.factoryInstances=String(environment.instances);return()=>{s.scene.remove(environment.group);environment.dispose();s.environment=null;};},[props.scenario.pallet.width,props.scenario.pallet.depth]);
 useEffect(()=>{const s=stage.current;if(!s)return;s.factoryVisible=factoryVisible;if(s.environment)s.environment.group.visible=factoryVisible;s.grid.visible=!factoryVisible;s.renderer.domElement.dataset.environment=factoryVisible?'factory':'analysis';for(const label of s.labels)label.visible=!factoryVisible||label.name==='cell-label';},[factoryVisible]);
 useEffect(()=>{const s=stage.current;if(!s)return;dispose(s.content);s.content.clear();dispose(s.moving);s.moving.clear();s.movingBoxes.clear();for(const grip of s.grips){dispose(grip);grip.clear();}
  s.belt?.dispose();s.beltBoxes.clear();s.labels=[];s.cargos=[];s.platforms=[];s.empties=[];s.infeed=[];s.stock=[];
  const p=props.scenario.pallet,g=props.scenario.constraints.gripper;s.belt=createConveyorView(p);s.content.add(s.belt.group);
  const markBox=(mesh:THREE.Mesh,id:string,robot:number|null)=>{mesh.userData.boxId=id;mesh.userData.robot=robot;};
  const highlight=(group:THREE.Group,size:number[],position:THREE.Vector3,id:string)=>{if(id!==props.selectedBoxId)return;const geo=new THREE.BoxGeometry(...size.map(n=>n+.018) as [number,number,number]);const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:'#fffaf0',depthTest:false}));geo.dispose();edge.position.copy(position);edge.renderOrder=101;group.add(edge);const outerGeo=new THREE.BoxGeometry(...size.map(n=>n+.035) as [number,number,number]);const outer=new THREE.LineSegments(new THREE.EdgesGeometry(outerGeo),new THREE.LineBasicMaterial({color:'#322d2a',depthTest:false}));outerGeo.dispose();outer.position.copy(position);outer.renderOrder=100;group.add(outer);};
  const cube=(group:THREE.Group,size:number[],position:THREE.Vector3,color:string,opacity=1)=>{const geo=new THREE.BoxGeometry(...size as [number,number,number]),mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.7,transparent:opacity<1,opacity}));mesh.position.copy(position);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:TWIN_SCENE.edge,transparent:true,opacity:.45}));edge.position.copy(position);group.add(edge);return mesh;};
  const label=(text:string,pos:Vec3,color:string,scale=1.4)=>{const canvas=document.createElement('canvas');canvas.width=768;canvas.height=96;const ctx=canvas.getContext('2d')!;ctx.fillStyle=TWIN_SCENE.label;ctx.fillRect(0,0,768,96);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.strokeRect(2,2,764,92);ctx.fillStyle=TWIN_SCENE.text;ctx.textAlign='center';ctx.font='bold 46px sans-serif';ctx.fillText(text,384,64);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.SpriteMaterial({map:texture,depthTest:false}),sprite=new THREE.Sprite(mat);sprite.scale.set(scale*1.2,scale*.15,1);sprite.position.copy(vector(pos));sprite.name=text.startsWith('로봇')||text.startsWith('P0')||text.startsWith('PICK')||text.startsWith('INFEED')?'cell-label':'detail-label';sprite.visible=!s.factoryVisible||sprite.name==='cell-label';s.labels.push(sprite);s.content.add(sprite);};
  const woodPallet=(parent:THREE.Group)=>{const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:FACTORY.timber,roughness:.88}),parts:Array<{x:number;y:number;z:number;w:number;h:number;d:number}>=[];for(let k=0;k<7;k++)parts.push({x:0,y:-.018,z:(k/6-.5)*(p.depth/1000-.1),w:p.width/1000,h:.035,d:.09});for(const x of [-.36,0,.36])parts.push({x:x*p.width/1000,y:-.075,z:0,w:.075,h:.08,d:p.depth/1000});const mesh=new THREE.InstancedMesh(geometry,material,parts.length),o=new THREE.Object3D();parts.forEach((b,i)=>{o.position.set(b.x,b.y,b.z);o.scale.set(b.w,b.h,b.d);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);};
  props.world.cells.forEach((cell,i)=>{const pose=cellPose(i,p),group=new THREE.Group();group.position.copy(vector({...pose,z:0}));group.rotation.y=-pose.angle;s.content.add(group);s.roots[i].position.copy(group.position);s.roots[i].rotation.y=group.rotation.y;
   const cargo=new THREE.Group(),platform=new THREE.Group(),empty=new THREE.Group(),feed=new THREE.Group(),stock=new THREE.Group();group.add(cargo,platform,empty,feed,stock);s.empties.push(empty);s.cargos.push(cargo);s.platforms.push(platform);s.infeed.push(feed);s.stock.push(stock);
   woodPallet(cargo);
   const boundary=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(p.width/1000,p.maxHeight/1000,p.depth/1000)),new THREE.LineBasicMaterial({color:RELAY_COLORS[i],transparent:true,opacity:.3}));boundary.position.y=p.maxHeight/2000;group.add(boundary);
   const input=incomingPosition();if(!props.world.stream)cube(group,[.8,.06,.65],new THREE.Vector3(...engineToRender({x:input.x+400,y:input.y+325,z:-30},p)),TWIN_SCENE.source);
   label(props.world.stream?`로봇 ${i+1}  /  ${cell.placements.length}개`:`P0${i+1} · ${cell.placements.length} BOXES`,toWorld({x:p.width/2,y:p.depth+250,z:30},i,p),RELAY_COLORS[i],1.4);
   if(!props.world.stream)label(`PICK 0${i+1}`,{...beltStation(i,p),y:CONVEYOR.front-600,z:CONVEYOR.deck+160},RELAY_COLORS[i],1.25);
   if(!props.world.stream)label(`R${i+1} 재고 ${cell.queue.length}개`,toWorld({x:input.x+400,y:input.y+400,z:630},i,p),RELAY_COLORS[i]);
   for(const b of cell.placements){const type=props.scenario.types.find(t=>t.id===b.typeId);const mesh=cube(cargo,renderSize(b.size),new THREE.Vector3(...engineToRender(centerOf(b.position,b.size),p)),displayBoxColor(type?.color||RELAY_COLORS[i]),props.selectedBoxId&&props.selectedBoxId!==b.id? .55:1);markBox(mesh,b.id,i);highlight(cargo,renderSize(b.size),new THREE.Vector3(...engineToRender(centerOf(b.position,b.size),p)),b.id);}
   // The queue is an inventory diagram; only one representative box is full scale.
   const first=props.world.boxes.find(b=>b.observation.id===cell.queue[0]);if(first&&!props.world.pads[(i+ROBOT_COUNT-1)%ROBOT_COUNT].boxId&&!props.motions.some(m=>m.action.robot===i)){const b=first.observation,type=props.scenario.types.find(t=>t.id===b.typeId);cube(stock,renderSize(b.size),new THREE.Vector3(...engineToRender(centerOf(sourcePickup(props.world,b,i,p),b.size),p)),displayBoxColor(type?.color||RELAY_COLORS[i]),.7);}
   cell.queue.slice(0,5).forEach((id,j)=>{const b=props.world.boxes.find(b=>b.observation.id===id)!.observation,type=props.scenario.types.find(t=>t.id===b.typeId);cube(stock,[.11,.1,.11],new THREE.Vector3(...engineToRender({x:input.x+80+j*145,y:input.y+720,z:50},p)),displayBoxColor(type?.color||RELAY_COLORS[i]));});
   // Tool envelope is the same width/depth/height+margin used by path inspection.
   const envelope=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry((g.width+2*g.margin)/1000,g.height/1000,(g.depth+2*g.margin)/1000)),new THREE.LineBasicMaterial({color:RELAY_COLORS[i]}));envelope.position.y=g.height/2000;s.grips[i].add(envelope);
   woodPallet(empty);
   cube(platform,[p.width/1000*.88,.18,p.depth/1000*.88],new THREE.Vector3(0,-.24,0),TWIN_SCENE.platform);
   for(const x of [-.35,.35])for(const z of [-.25,.25])cube(platform,[.14,.16,.18],new THREE.Vector3(x,-.32,z),TWIN_SCENE.wheel);
   const laneEnd=toWorld({x:p.width/2,y:p.depth/2+TRAVEL_MM,z:-100},i,p),laneStart=toWorld({x:p.width/2,y:p.depth/2,z:-100},i,p);
   const route=new THREE.Line(new THREE.BufferGeometry().setFromPoints([vector(laneStart),vector(laneEnd)]),new THREE.LineDashedMaterial({color:RELAY_COLORS[i],dashSize:.14,gapSize:.12}));route.computeLineDistances();if(!props.world.stream)s.content.add(route);else dispose(route);if(!props.world.stream)label(props.context==='fixed'?'OUT · 컨베이어':'OUT · 3 m 전용 통로',{...laneEnd,z:60},RELAY_COLORS[i],1.4);
   cube(s.grips[i],[g.width/1000,g.height/1000,g.depth/1000],new THREE.Vector3(0,g.height/2000,0),TWIN_SCENE.tool);

  });
  const intake=new THREE.Group();cube(intake,[.36,.26,.3],new THREE.Vector3(),FACTORY.carton);s.content.add(intake);s.intake=intake;
  if(!props.world.stream)label('INFEED / SCAN',{x:beltBounds(p).left+650,y:CONVEYOR.front,z:1700},RELAY_COLORS[0],1.4);
  props.world.pads.forEach((pad,i)=>{if(!pad.boxId||props.motions.some(m=>m.action.boxId===pad.boxId))return;const b=props.world.boxes.find(b=>b.observation.id===pad.boxId)!.observation,type=props.scenario.types.find(t=>t.id===b.typeId),object=new THREE.Group();cube(object,renderSize(b.size),new THREE.Vector3(),displayBoxColor(type?.color||FACTORY.carton));s.content.add(object);s.beltBoxes.set(pad.boxId,{object,from:i,height:b.size.h});});
  if(props.world.stream)for(const b of props.world.boxes.filter(b=>b.status==='belt')){const object=new THREE.Group(),type=props.scenario.types.find(t=>t.id===b.observation.typeId);const mesh=cube(object,renderSize(b.observation.size),new THREE.Vector3(),displayBoxColor(type?.color||FACTORY.carton));markBox(mesh,b.observation.id,null);highlight(object,renderSize(b.observation.size),new THREE.Vector3(),b.observation.id);s.content.add(object);s.beltBoxes.set(b.observation.id,{object,height:b.observation.size.h});}
  for(const motion of props.motions){const a=motion.action,b=props.world.boxes.find(b=>b.observation.id===a.boxId)!.observation,type=props.scenario.types.find(t=>t.id===b.typeId),obj=new THREE.Group();const mesh=cube(obj,renderSize(b.size),new THREE.Vector3(),displayBoxColor(type?.color||FACTORY.carton));markBox(mesh,a.boxId,a.robot);highlight(obj,renderSize(b.size),new THREE.Vector3(),a.boxId);s.moving.add(obj);s.movingBoxes.set(a.boxId,obj);}
  s.renderer.domElement.dataset.selectedBox=props.selectedBoxId??'';
  s.renderer.domElement.dataset.pads=JSON.stringify(props.world.pads.map(p=>p.boxId));
  s.renderer.domElement.dataset.queues=JSON.stringify(props.world.cells.map(c=>c.queue));s.renderer.domElement.dataset.placed=JSON.stringify(props.world.cells.map(c=>c.placements.map(p=>p.id)));s.renderer.domElement.dataset.revision=String(props.world.revision);
 },[props.selectedBoxId,props.scenario,props.world.stream?`${props.world.runId}:${props.world.revision}`:props.world,props.context,props.motions.map(m=>`${m.action.robot}:${m.action.boxId}:${m.action.kind}`).join('|')]);
 return <div className={`relay-scene${props.world.stream?' scene-inspector':''}`} ref={host} data-testid="relay-scene">{fallback&&<p>WebGL을 사용할 수 없습니다. 박스 목록과 진단 패널에서 결과를 확인하세요.</p>}{!props.world.stream&&<div className="relay-scene-note">공용 컨베이어 / {ROBOT_COUNT}개 작업 구역<br/>공용 벨트 600 mm/s · 빈 구역에 도착 후 집기</div>}<div className="scene-camera-tools" aria-label="3D 시점 설정"><div role="group" aria-label="카메라 방향"><button aria-pressed={cameraMode==='perspective'} onClick={()=>{setCameraMode('perspective');frameCamera('perspective');}}>입체</button><button aria-pressed={cameraMode==='top'} onClick={()=>{setCameraMode('top');frameCamera('top');}}>평면</button></div><button onClick={()=>frameCamera(cameraMode,true)}>전체 보기</button><button aria-pressed={factoryVisible} onClick={()=>setFactoryVisible(v=>!v)}>공장 시설</button></div><span className="scene-interaction-hint">{props.onSelectBox?'박스 클릭으로 분석 · ':''}드래그 회전 · 휠 확대</span></div>;
}

function safeTransport(phase:ProcessPhase,progress:number,context:ContextId){
 const c=CONTEXTS[context],travel=TRAVEL_MM/c.transportSpeed,total=travel+c.dock;
 const move=Math.max(0,Math.min(1,(progress*total-c.dock)/travel))*TRAVEL_MM/1000;
 return {cargo:phase==='outbound'?move:0,platform:phase==='outbound'?move:phase==='returning'?TRAVEL_MM/1000-move:0,showCargo:!['returning','complete'].includes(phase)};
}
