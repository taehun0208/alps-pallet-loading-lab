import * as THREE from 'three';
import {dentFactor,type Dent} from './intake';
// Render dimensions are metres; deform the same surface sampled by the simulated scanner.
export function boxGeometry(size:[number,number,number],dent?:Dent){
 const [w,h,d]=size,geo=new THREE.BoxGeometry(w,h,d,dent?8:1,dent?8:1,dent?8:1);
 if(dent){const p=geo.attributes.position;for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),delta=dent.depthMm/1000*dentFactor(dent.kind,x/w,y/h,z/d);
  if(dent.kind==='side')p.setX(i,x-delta);else p.setY(i,y-delta);
 }p.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingBox();}
 return geo;
}
