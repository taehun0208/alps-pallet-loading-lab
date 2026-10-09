import {useEffect,useRef} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {Box,Candidate,Config,Frame,Placed,Solid} from './types';
import {bounds,transformPoint,wallSolids,worldParts} from './shape';
import {assess} from './mechanics';
import {suctionCandidates} from './grasp';
export interface Layers {transparent:boolean;nominal:boolean;observed:boolean;contacts:boolean;suction:boolean;path:boolean;candidates:boolean}
const coord=(v:{x:number;y:number;z:number})=>new T.Vector3(v.x/1000,v.z/1000,-v.y/1000);
export default function AdaptiveScene({config,frame,boxes,selected,candidate,layers,onSelect}:{config:Config;frame:Frame;boxes:Box[];selected:string;candidate:Candidate|null;layers:Layers;onSelect:(id:string)=>void}){
 const host=useRef<HTMLDivElement>(null),api=useRef<{scene:T.Scene;root:T.Group;camera:T.PerspectiveCamera;renderer:T.WebGLRenderer;controls:OrbitControls}|null>(null),pick=useRef(onSelect);pick.current=onSelect;
 useEffect(()=>{const el=host.current!,scene=new T.Scene();scene.background=new T.Color('#d2d7da');const camera=new T.PerspectiveCamera(38,1,.02,50);camera.position.set(3.8,3.5,4.3);
  const renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(2,devicePixelRatio));el.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','변형 박스 3D 뷰포트');renderer.domElement.setAttribute('role','img');
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(.8,.55,-.65);controls.enableDamping=true;controls.minDistance=1;controls.maxDistance=14;
  scene.add(new T.HemisphereLight('#ffffff','#65727e',2.4));const light=new T.DirectionalLight('#ffffff',2);light.position.set(2,6,4);scene.add(light);const root=new T.Group();scene.add(root);api.current={scene,root,camera,renderer,controls};
  const resize=new ResizeObserver(()=>{camera.aspect=el.clientWidth/Math.max(1,el.clientHeight);camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);});resize.observe(el);
  let raf=0;const animate=()=>{controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(animate);};animate();
  let down={x:0,y:0};const pd=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};const pu=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height),camera);const hit=ray.intersectObjects(root.children,true).find(v=>v.object.userData.boxId);if(hit)pick.current(hit.object.userData.boxId);};
  renderer.domElement.addEventListener('pointerdown',pd);renderer.domElement.addEventListener('pointerup',pu);
  return()=>{cancelAnimationFrame(raf);resize.disconnect();controls.dispose();renderer.dispose();el.replaceChildren();api.current=null;};
 },[]);
 useEffect(()=>{const a=api.current;if(!a)return;const p=config.pallet,s=Math.max(p.width,p.depth,p.maxHeight)/1000;a.controls.target.set(p.width/2000,p.maxHeight/2200,-p.depth/2000);a.camera.position.copy(a.controls.target).add(new T.Vector3(s*1.3,s*1.05,s*1.4));a.controls.update();},[config.pallet.width,config.pallet.depth,config.pallet.maxHeight]);
 useEffect(()=>{const a=api.current;if(!a)return;const {root}=a;root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments||o instanceof T.Line){o.geometry.dispose();const m=Array.isArray(o.material)?o.material:[o.material];m.forEach(v=>v.dispose());}});root.clear();
  const cuboid=(s:Solid,color:string,opacity=1,wire=false,id?:string)=>{const geo=new T.BoxGeometry(s.w/1000,s.h/1000,s.d/1000),obj=wire?new T.LineSegments(new T.EdgesGeometry(geo),new T.LineBasicMaterial({color,transparent:opacity<1,opacity})):new T.Mesh(geo,new T.MeshStandardMaterial({color,roughness:.9,transparent:opacity<1,opacity,depthWrite:opacity===1}));if(wire)geo.dispose();obj.position.copy(coord({x:s.x+s.w/2,y:s.y+s.d/2,z:s.z+s.h/2}));if(id)obj.userData.boxId=id;root.add(obj);return obj;};
  const dot=(v:{x:number;y:number;z:number},color:string,r=.012)=>{const mesh=new T.Mesh(new T.SphereGeometry(r,10,8),new T.MeshBasicMaterial({color}));mesh.position.copy(coord(v));root.add(mesh);};
  const grid=new T.GridHelper(7,35,'#929fa8','#b6c0c7');grid.position.set(.9,-.09,-.7);root.add(grid);
  cuboid({x:0,y:0,z:-100,w:config.pallet.width,d:config.pallet.depth,h:100},'#7a8790');
  cuboid({x:0,y:0,z:0,w:config.pallet.width,d:config.pallet.depth,h:config.pallet.maxHeight},'#86949e',.65,true);
  for(const wall of wallSolids(config))cuboid(wall,'#7c8c98',.22);
  for(const p of frame.placed){
   for(const s of worldParts(p))cuboid(s,p.box.id===selected?'#ead9a5':p.box.color,layers.transparent?.55:1,false,p.box.id);
   if(layers.nominal){const nominal:Placed={...p,box:{...p.box,parts:[{x:0,y:0,z:0,...p.box.nominal}]}};cuboid(bounds(worldParts(nominal)),'#3b4a56',.65,true);}
   for(const mask of p.box.masks){const pos=transformPoint({x:mask.x+mask.w/2,y:mask.y+mask.d/2,z:p.box.nominal.h+1},p.box,p);cuboid({x:pos.x-(p.rotation?mask.d:mask.w)/2,y:pos.y-(p.rotation?mask.w:mask.d)/2,z:pos.z,w:p.rotation?mask.d:mask.w,d:p.rotation?mask.w:mask.d,h:1},'#884b47',.65);}
  }
  if(layers.observed)for(const p of frame.observed)for(const s of worldParts(p))cuboid(s,'#a24d49',.5,true);
  const current=frame.placed.find(p=>p.box.id===selected)||frame.placed.at(-1);
  if(current){const analysis=assess(frame.placed,config,current.box.id),g=suctionCandidates(current.box,config);
   if(layers.contacts)for(const contact of analysis.loads[current.box.id]?.contacts||[]){const r=contact.rect;const z=worldParts(current).find(s=>r.x>=s.x-1e-6&&r.y>=s.y-1e-6&&r.x+r.w<=s.x+s.w+1e-6&&r.y+r.d<=s.y+s.d+1e-6)?.z||current.position.z;cuboid({...r,z:z+1,h:2},'#138c83',.8);}
   if(layers.suction)for(const s of g.filter(v=>v.valid).slice(0,16)){const p=transformPoint(s.point,current.box,current);p.z+=3;const side=config.cup.diameterMm+2*config.cup.marginMm;cuboid({x:p.x-side/2,y:p.y-side/2,z:p.z,w:side,d:side,h:1},'#147a69',.18);dot(p,'#147a69',.009);}
   const center=transformPoint(current.box.com,current.box,current);dot(center,'#23343c',.018);
  }
  if(layers.candidates){for(const v of frame.candidates.filter(v=>v.reasons.length).slice(0,5)){const b=boxes.find(b=>b.id===v.boxId);if(b)cuboid(bounds(worldParts({box:b,...v})),'#b07666',.35,true);}}
  if(candidate){const b=boxes.find(b=>b.id===candidate.boxId);if(b){const p={box:b,...candidate};cuboid(bounds(worldParts(p)),candidate.reasons.length?'#b34740':'#00786f',1,true);if(candidate.grasp){const gp=transformPoint(candidate.grasp.point,b,p);dot(gp,'#ecaa2d',.026);cuboid({x:gp.x-config.gripper.width/2,y:gp.y-config.gripper.depth/2,z:gp.z+config.gripper.clearance,w:config.gripper.width,d:config.gripper.depth,h:config.gripper.height},'#536d7c',.35);}}
   if(layers.path&&candidate.path.length){const line=new T.Line(new T.BufferGeometry().setFromPoints(candidate.path.map(coord)),new T.LineDashedMaterial({color:'#167b81',dashSize:.04,gapSize:.02}));line.computeLineDistances();root.add(line);}
  }
 },[config,frame,boxes,selected,candidate,layers]);
 return <div className="adaptive-viewport" ref={host}/>;
}
