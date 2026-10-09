import * as THREE from 'three';
import type {Constraints} from '../types';
import type {PracticalSettings} from './practical';
import {TWIN_SCENE,TWIN_ROBOT_PALETTE} from './twinSceneTheme';
export function addEndEffector(group:THREE.Group,g:Constraints['gripper'],tool:PracticalSettings['tool']='vacuum'){
 const w=g.width/1000,h=g.height/1000,d=g.depth/1000,metal=new THREE.MeshStandardMaterial({color:TWIN_SCENE.tool,roughness:.55}),rubber=new THREE.MeshStandardMaterial({color:TWIN_ROBOT_PALETTE.dark,roughness:.8});
 const block=(bw:number,bh:number,bd:number,x:number,y:number,z:number,mat=metal)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),mat);m.position.set(x,y,z);group.add(m);};
 block(w,h*.24,d,0,h*.88,0);
 if(tool==='vacuum'){block(w*.8,h*.42,d*.8,0,h*.55,0);const radius=Math.min(w*.16,d*.16,.025);for(const x of [-.3,.3])for(const z of [-.3,.3]){const cup=new THREE.Mesh(new THREE.CylinderGeometry(radius*.75,radius,h*.15,16),rubber);cup.position.set(x*w,h*.075,z*d);group.add(cup);}}
 else if(tool==='jaw'){for(const x of [-1,1]){block(w*.1,h*.75,d*.68,x*w*.45,h*.38,0);block(w*.035,h*.35,d*.6,x*w*.39,h*.2,0,rubber);}}
 else{for(const x of [-1,1]){block(w*.08,h*.75,d,x*w*.46,h*.38,0);block(w*.42,h*.08,d,x*w*.25,h*.04,0);}}
 group.name=`exchange-tool-${tool}`;
}
