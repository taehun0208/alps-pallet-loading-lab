import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const LIGHTING={sky:'#f2f5f6',ground:'#697278',key:'#fff8ed',fill:'#dce8f0'};

/** Presentation only: prefiltered studio reflections are generated once on mount.
 * One shadow-casting light; no postprocessing, network assets or physics changes. */
export function createFactoryLighting(renderer:THREE.WebGLRenderer,scene:THREE.Scene){
 const room=new RoomEnvironment(),generator=new THREE.PMREMGenerator(renderer);
 const environment=generator.fromScene(room,.04);
 room.dispose();generator.dispose();scene.environment=environment.texture;scene.environmentIntensity=.5;
 const ambient=new THREE.HemisphereLight(LIGHTING.sky,LIGHTING.ground,.7);
 const key=new THREE.DirectionalLight(LIGHTING.key,2.3);key.position.set(-3,11,6);key.castShadow=true;
 key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-10,right:10,top:10,bottom:-10,near:.5,far:35});
 key.shadow.bias=-.00015;key.shadow.normalBias=.012;
 const fill=new THREE.DirectionalLight(LIGHTING.fill,.4);fill.position.set(7,5,-7);
 scene.add(ambient,key,fill);
 return ()=>{scene.environment=null;environment.dispose();key.shadow.map?.dispose();scene.remove(ambient,key,fill);};
}
