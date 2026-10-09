import * as THREE from 'three';
import type { Pallet } from '../types';
import { CONVEYOR,beltBounds,beltStation } from './conveyor';
import { ROBOT_COUNT } from './layout';

export function createConveyorView(p:Pallet) {
  const group=new THREE.Group();group.name='single-shared-conveyor';
  const b=beltBounds(p),left=b.left/1000,right=b.right/1000,front=CONVEYOR.front/1000,back=CONVEYOR.back/1000;
  const width=CONVEYOR.width/1000,z=CONVEYOR.deck/1000,geometry=new THREE.BoxGeometry(1,1,1);
  const steel=new THREE.MeshStandardMaterial({color:'#969b99',metalness:.65,roughness:.35});
  const dark=new THREE.MeshStandardMaterial({color:'#252c2b',roughness:.83});
  const markings=new THREE.MeshStandardMaterial({color:'#d8d2b5',roughness:.7});
  const parts:{w:number;h:number;d:number;x:number;y:number;z:number}[]=[];
  const block=(w:number,h:number,d:number,x:number,y:number,z:number)=>parts.push({w,h,d,x,y,z});
  const decks=new THREE.Group();group.add(decks);
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=32;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#303734';ctx.fillRect(0,0,128,32);ctx.fillStyle='#4c5550';ctx.fillRect(0,0,3,32);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  const animated:THREE.Texture[]=[];
  function run(x:number,y:number,length:number,vertical=false,reverse=false){
    const t=texture.clone();t.repeat.set(length/.22,1);animated.push(t);
    const deck=new THREE.Mesh(new THREE.BoxGeometry(length,.13,width),[dark,dark,new THREE.MeshStandardMaterial({map:t,roughness:.8}),dark,dark,dark]);
    deck.position.set(x,z-.065,y);deck.rotation.y=vertical?Math.PI/2:0;deck.userData.reverse=reverse;deck.receiveShadow=true;decks.add(deck);
    for(const edge of [-1,1])block(vertical?width*.025:length,.095,vertical?length:width*.025,x+(vertical?edge*width/2:0),z-.035,y+(vertical?0:edge*width/2));
    for(let d=-length/2+.25;d<length/2;d+=1.4)for(const side of [-1,1]){
      block(.075,z+.34,.075,x+(vertical?side*.32:d),(z-.41)/2-.03,y+(vertical?d:side*.32));
      block(.16,.04,.16,x+(vertical?side*.32:d),-.39,y+(vertical?d:side*.32));
    }
  }
  run((left+right)/2,front,right-left);run((left+right)/2,back,right-left,false,true);
  run(left,(front+back)/2,front-back+width,true);run(right,(front+back)/2,front-back+width,true,true);
  const frame=new THREE.InstancedMesh(geometry,steel,parts.length),dummy=new THREE.Object3D();
  parts.forEach((v,i)=>{dummy.position.set(v.x,v.y,v.z);dummy.scale.set(v.w,v.h,v.d);dummy.updateMatrix();frame.setMatrixAt(i,dummy.matrix);});frame.castShadow=true;group.add(frame);
  for(let i=0;i<ROBOT_COUNT;i++){
    const point=beltStation(i,p);
    for(const edge of [-1,1]){const marker=new THREE.Mesh(new THREE.BoxGeometry(.8,.012,.045),markings);marker.position.set(point.x/1000,z+.008,front+edge*(width/2-.055));group.add(marker);}
  }
  // A single measurement portal on the common infeed.
  for(const side of [-1,1]){const upright=new THREE.Mesh(new THREE.BoxGeometry(.07,1.05,.07),steel);upright.position.set(left+.65,z+.525,front+side*.56);group.add(upright);}
  const bridge=new THREE.Mesh(new THREE.BoxGeometry(.18,.1,1.19),steel);bridge.position.set(left+.65,z+1.02,front);group.add(bridge);
  const scanner=new THREE.Mesh(new THREE.BoxGeometry(.1,.035,.3),new THREE.MeshStandardMaterial({color:'#b5e5bd',emissive:'#406347',emissiveIntensity:.4}));scanner.position.set(left+.65,z+.94,front);group.add(scanner);
  return {group,update:(time:number)=>{animated.forEach((t,i)=>{t.offset.x=(i===1||i===3?1:-1)*time*CONVEYOR.speed/220;});},dispose:()=>texture.dispose()};
}
