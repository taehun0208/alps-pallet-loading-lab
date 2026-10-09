/* Hallmark · factory stage · studied: yes · Visual Components / FactoryLens reference
 * Pre-emit critique: P5 H5 E4 S5 R5 V4. Light concrete, powder-coated steel; presentation only. */
import * as THREE from 'three';
import {cellPose,toWorld,ROBOT_COUNT} from './layout';
import {DEFAULT_ROBOT_ARM} from '../robotArm';
import type {Pallet} from '../types';
export const FACTORY={floor:'#9fa5a8',seam:'#899297',wall:'#c5c9ca',upper:'#e0e2e1',steel:'#89949b',dark:'#30373b',rack:'#b28f51',timber:'#b79a71',carton:'#b19370',tape:'#c6b694',paper:'#e1e2d9',yellow:'#d2af47',walk:'#6d8984',lane:'#818e98',lamp:'#f2f4f2',window:'#8aa6b2',ink:'#e6ebee',red:'#b5796b',font:'600 64px "Malgun Gothic",sans-serif'};
const FLOOR=-.405;
type Block={size:[number,number,number];at:[number,number,number];yaw:number};
export function createFactoryEnvironment(pallet:Pallet){
 const group=new THREE.Group();group.name='factory-environment';
 const boxGeometry=new THREE.BoxGeometry(1,1,1),batches=new Map<string,Block[]>(),materials:THREE.Material[]=[],textures:THREE.Texture[]=[],geometries:THREE.BufferGeometry[]=[boxGeometry];
 function block(color:string,size:Block['size'],at:Block['at'],yaw=0){const batch=batches.get(color)??[];batch.push({size,at,yaw});batches.set(color,batch);}
 function stripe(x:number,z:number,w:number,d:number,color=FACTORY.yellow,yaw=0){block(color,[w,.008,d],[x,FLOOR+.012,z],yaw);}
 function beam(a:THREE.Vector3,b:THREE.Vector3,width:number,color:string,parent=group){const g=new THREE.BoxGeometry(width,a.distanceTo(b),width),m=new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.35}),o=new THREE.Mesh(g,m);geometries.push(g);materials.push(m);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());o.castShadow=true;parent.add(o);return o;}
 function sign(text:string,w:number,h:number,at:[number,number,number],rotation:[number,number,number],color=FACTORY.ink,bg=FACTORY.dark,parent=group){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.max(128,Math.round(1024*h/w));const c=canvas.getContext('2d')!;c.fillStyle=bg;c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.font=FACTORY.font;c.fillText(text,512,canvas.height/2,940);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);const mat=new THREE.MeshBasicMaterial({map:texture,transparent:false,side:THREE.DoubleSide});materials.push(mat);const geometry=new THREE.PlaneGeometry(w,h);geometries.push(geometry);const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(...at);mesh.rotation.set(...rotation);parent.add(mesh);return mesh;}
 // Deterministic concrete microtexture, produced once rather than loaded from a CDN.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d')!;c.fillStyle=FACTORY.floor;c.fillRect(0,0,512,512);let seed=19;for(let i=0;i<13000;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed%512;seed=(seed*1664525+1013904223)>>>0;const y=seed%512;c.globalAlpha=.05+(seed%8)/100;c.fillStyle=i%2?FACTORY.upper:FACTORY.dark;c.fillRect(x,y,1+(seed%3),1);}c.globalAlpha=1;
 const concrete=new THREE.CanvasTexture(canvas);concrete.colorSpace=THREE.SRGBColorSpace;concrete.wrapS=concrete.wrapT=THREE.RepeatWrapping;concrete.repeat.set(9,9);textures.push(concrete);
 const floorMat=new THREE.MeshStandardMaterial({map:concrete,roughness:.93,metalness:.05}),floorGeo=new THREE.BoxGeometry(18,.16,18),floor=new THREE.Mesh(floorGeo,floorMat);materials.push(floorMat);geometries.push(floorGeo);floor.position.y=FLOOR-.08;floor.receiveShadow=true;group.add(floor);
 for(let n=-9;n<=9;n+=3){stripe(n,0,.013,18,FACTORY.seam);stripe(0,n,18,.013,FACTORY.seam);}
 // Paint is flat and traversable. The four radial shipping lanes follow the simulation routes.
 for(let i=0;i<ROBOT_COUNT;i++){
  const pose=cellPose(i,pallet),start=new THREE.Vector3(pose.x/1000,FLOOR+.025,pose.y/1000),out=new THREE.Vector3(0,0,1),mid=start.clone().addScaledVector(out,1.55),yaw=-Math.atan2(out.z,out.x);
  stripe(mid.x,mid.z,3.2,1.32,FACTORY.lane,yaw);for(const side of [-1,1]){const sideV=new THREE.Vector3(-out.z,0,out.x).multiplyScalar(side*.69),center=mid.clone().add(sideV);stripe(center.x,center.z,3.25,.035,FACTORY.yellow,yaw);}
  for(const distance of [1.2,2.1,2.8]){const center=start.clone().addScaledVector(out,distance);for(const side of [-1,1])stripe(center.x-out.z*side*.1,center.z+out.x*side*.1,.3,.045,FACTORY.ink,yaw+side*.65);}
  const end=start.clone().addScaledVector(out,3.3);sign(`OUT 0${i+1}`,1.05,.26,[end.x,FLOOR+.032,end.z],[-Math.PI/2,0,yaw+Math.PI/2]);
  const x=pose.x/1000,z=pose.y/1000;for(const offset of [-.7,.7]){stripe(x+offset,z,.035,1.45);stripe(x,z+offset,1.45,.035);}
  const base=toWorld({x:DEFAULT_ROBOT_ARM.baseX,y:DEFAULT_ROBOT_ARM.baseY,z:0},i,pallet);block(FACTORY.dark,[.69,.4,.69],[base.x/1000,-.2,base.y/1000],-pose.angle);block(FACTORY.steel,[.78,.04,.78],[base.x/1000,-.015,base.y/1000],-pose.angle);
  for(const x of [-810,-200])for(const y of [265,775]){const leg=toWorld({x,y,z:0},i,pallet);block(FACTORY.steel,[.065,.36,.065],[leg.x/1000,-.215,leg.y/1000]);}
 }
 // Clear pedestrian aisle behind the working envelope.
 stripe(0,-6.25,16,1.1,FACTORY.walk);stripe(0,-5.65,16,.06);stripe(0,-6.85,16,.06);sign('PEDESTRIAN / 보행 통로',3.8,.35,[-1.2,FLOOR+.025,-6.2],[-Math.PI/2,0,0],FACTORY.ink,FACTORY.walk);
 for(let i=0;i<8;i++)stripe(-5.5+i*.25,5.6,.13,1.1,FACTORY.ink);
 // Two cutaway walls; hide the near wall when an orbit puts the camera outside it.
 const rear=new THREE.Group(),side=new THREE.Group();group.add(rear,side);
 const wallMat=new THREE.MeshStandardMaterial({color:FACTORY.wall,roughness:.9}),upperMat=new THREE.MeshStandardMaterial({color:FACTORY.upper,roughness:.85});materials.push(wallMat,upperMat);
 function wall(size:Block['size'],at:Block['at'],material:THREE.Material,parent:THREE.Group){const geometry=new THREE.BoxGeometry(...size);geometries.push(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...at);mesh.receiveShadow=true;parent.add(mesh);}
 wall([18,3.7,.16],[0,1.45,-8.8],wallMat,rear);wall([18,1.3,.16],[0,3.95,-8.8],upperMat,rear);wall([.16,5.2,18],[-8.8,2.2,0],wallMat,side);
 for(let i=-8;i<=8;i++){block(FACTORY.steel,[.035,4.9,.08],[i,2.05,-8.66]);}
 for(const x of [-8.55,-4.25,0,4.25,8.55]){block(FACTORY.steel,[.2,5.4,.24],[x,2.3,-8.55]);block(FACTORY.yellow,[.27,.7,.3],[x,-.05,-8.55]);}
 for(const z of [-4.3,0,4.3,8.5]){block(FACTORY.steel,[.24,5.4,.2],[-8.55,2.3,z]);block(FACTORY.yellow,[.3,.7,.27],[-8.55,-.05,z]);}
 // Back-bay truss and suspended fixtures leave the central cell unobstructed.
 for(const z of [-7.6,-5.1]){block(FACTORY.steel,[17.2,.15,.12],[0,4.8,z]);for(let x=-8;x<8;x+=2)beam(new THREE.Vector3(x,4.8,z),new THREE.Vector3(x+1,5.3,z),.055,FACTORY.steel);block(FACTORY.steel,[17.2,.12,.1],[0,5.3,z]);}
 for(const x of [-6,-2,2,6]){block(FACTORY.dark,[2.1,.09,.3],[x,4.65,-5.1]);block(FACTORY.lamp,[1.95,.025,.25],[x,4.59,-5.1]);}
 for(const x of [-6.5,-2,2.5,6.5])sign('',2.8,.65,[x,3.8,-8.695],[0,0,0],FACTORY.ink,FACTORY.window,rear);
 sign('PALLET LOADING LAB / MIXED PALLETIZING',7.7,.6,[-1.5,2.9,-8.65],[0,0,0],FACTORY.ink,FACTORY.dark,rear);
 // Roll-up loading door, sectional ribs and dock bumpers.
 block(FACTORY.dark,[3.25,2.75,.18],[5.8,.99,-8.47]);for(let j=0;j<14;j++)block(j%2?FACTORY.steel:FACTORY.floor,[2.95,.17,.06],[5.8,-.25+j*.19,-8.35]);
 sign('INBOUND 01',2.85,.38,[5.8,2.62,-8.29],[0,0,0],FACTORY.dark,FACTORY.yellow);
 for(const x of [4.05,7.55]){block(FACTORY.yellow,[.12,.82,.12],[x,.005,-7.95]);for(const y of [-.17,.11])block(FACTORY.dark,[.126,.09,.126],[x,y,-7.95]);}
 function rack(x:number,z:number,bays:number){
  for(let b=0;b<=bays;b++){for(const zz of [z-.52,z+.52])block(FACTORY.steel,[.09,3.25,.09],[x+b*1.55,1.23,zz]);if(b<bays)for(const y of [.08,1.12,2.16]){block(FACTORY.rack,[1.55,.12,.085],[x+b*1.55+.775,y,z-.52]);block(FACTORY.rack,[1.55,.12,.085],[x+b*1.55+.775,y,z+.52]);block(FACTORY.steel,[1.5,.045,1],[x+b*1.55+.775,y-.04,z]);for(let k=0;k<3;k++){const w=.3+((b+k)%3)*.09,h=.35+((k+b)%2)*.2,cx=x+b*1.55+.3+k*.43;block((b+k)%3?FACTORY.carton:FACTORY.timber,[w,h,.65],[cx,y+h/2+.08,z]);block(FACTORY.tape,[.045,.007,.66],[cx,y+h+.083,z]);block(FACTORY.paper,[w*.45,h*.3,.006],[cx,y+h*.55,z+.328]);}}}
 }
 rack(-7.75,-7.62,4);
 sign('RESERVE / 예비 재고',3.1,.34,[-5,3.05,-7.05],[0,0,0]);
 // Perimeter protection stays outside all four active cells and their radial lanes.
 function fence(x:number,z:number,length:number,rotate=false){const a=rotate?new THREE.Vector3(x,0,z):new THREE.Vector3(x,0,z),b=rotate?new THREE.Vector3(x,0,z+length):new THREE.Vector3(x+length,0,z);for(let i=0;i<=Math.ceil(length/1.4);i++){const v=a.clone().lerp(b,i/Math.ceil(length/1.4));block(FACTORY.yellow,[.07,1.45,.07],[v.x,.32,v.z]);}for(const y of [-.22,1])beam(a.clone().setY(y),b.clone().setY(y),.04,FACTORY.dark);const pts=[];for(let d=0;d<=length;d+=.13){const v=a.clone().lerp(b,d/length);pts.push(v.clone().setY(-.2),v.clone().setY(.99));}for(let y=-.2;y<=1;y+=.16)pts.push(a.clone().setY(y),b.clone().setY(y));const geo=new THREE.BufferGeometry().setFromPoints(pts),mat=new THREE.LineBasicMaterial({color:FACTORY.dark,transparent:true,opacity:.45});geometries.push(geo);materials.push(mat);group.add(new THREE.LineSegments(geo,mat));}
 fence(-4.4,-5.05,4.9);fence(8.1,-2.8,4.6,true);
 // Electrical cabinet and a small operator terminal, clear of transport paths.
 block(FACTORY.paper,[.65,1.55,.48],[7.4,.37,-3.8]);block(FACTORY.steel,[.56,1.4,.025],[7.4,.37,-3.54]);block(FACTORY.dark,[.04,.25,.04],[7.58,.45,-3.51]);block(FACTORY.dark,[.09,1.2,.09],[5.9,.2,-3.9]);block(FACTORY.steel,[.52,.36,.08],[5.9,.85,-3.9]);block(FACTORY.window,[.44,.26,.01],[5.9,.85,-3.85]);
 for(const x of [6.9,7.9])block(FACTORY.yellow,[.09,.8,.09],[x,0,-3.2]);
 // One draw call per material for hundreds of stationary parts.
 for(const [color,parts] of batches){const material=new THREE.MeshStandardMaterial({color,roughness:color===FACTORY.steel?.48:.82,metalness:color===FACTORY.steel?.5:.04,emissive:color===FACTORY.lamp?FACTORY.lamp:0,emissiveIntensity:color===FACTORY.lamp?.55:0});materials.push(material);const mesh=new THREE.InstancedMesh(boxGeometry,material,parts.length),o=new THREE.Object3D();parts.forEach((part,i)=>{o.position.set(...part.at);o.rotation.set(0,part.yaw,0);o.scale.set(...part.size);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);}
 return {group,update:(camera:THREE.Camera)=>{rear.visible=camera.position.z>-8.2;side.visible=camera.position.x>-8.2;},dispose:()=>{group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();group.clear();},instances:[...batches.values()].reduce((n,b)=>n+b.length,0)};
}
