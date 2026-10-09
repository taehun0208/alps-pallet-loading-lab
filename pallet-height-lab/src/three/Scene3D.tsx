import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { index3D, orientations3D, type Board3D, type Candidate3D } from './engine';

const COLOR_TOKENS=['--color-existing','--color-I','--color-O','--color-T','--color-L','--color-S','--color-gold','--color-J','--color-Z'];
function tokenColor(name:string): THREE.Color {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue(name).trim();ctx.fillRect(0,0,1,1);
  const data=ctx.getImageData(0,0,1,1).data;return new THREE.Color((data[0]<<16)|(data[1]<<8)|data[2]);
}
interface SceneProps { board:Board3D; preview:Candidate3D|null; slice:number; cut:boolean; holes:boolean; shaft:boolean; clearRows:number[]; dropStarted:number|null; cameraView:string; cameraVersion:number }
export function Scene3D(props:SceneProps) {
  const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
  const stage=useRef<{scene:THREE.Scene;renderer:THREE.WebGLRenderer;camera:THREE.PerspectiveCamera;controls:OrbitControls;blocks:THREE.Group;ghost:THREE.Group;box:THREE.BoxGeometry;edges:THREE.EdgesGeometry;materials:THREE.Material[]}|null>(null);
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    const el=host.current!;let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{setUnavailable(true);return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(tokenColor('--color-board'));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','회전 가능한 3D 테트리스 보드');renderer.domElement.tabIndex=0;
    el.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,0.1,120),controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;controls.dampingFactor=.12;controls.enablePan=false;controls.minDistance=8;controls.maxDistance=42;controls.maxPolarAngle=Math.PI*.49;
    const ambient=new THREE.HemisphereLight(tokenColor('--color-ink'),tokenColor('--color-panel'),2.3);scene.add(ambient);
    const light=new THREE.DirectionalLight(tokenColor('--color-ink'),3);light.position.set(3,12,7);scene.add(light);
    const rim=new THREE.DirectionalLight(tokenColor('--color-accent'),1.6);rim.position.set(-5,4,-4);scene.add(rim);
    const blocks=new THREE.Group(),ghost=new THREE.Group(),box=new THREE.BoxGeometry(.93,.93,.93),edges=new THREE.EdgesGeometry(box),materials:THREE.Material[]=[];
    scene.add(blocks,ghost);stage.current={scene,renderer,camera,controls,blocks,ghost,box,edges,materials};
    let frame=0;
    const render=()=>{
      const p=latest.current;
      if(p.preview&&p.dropStarted!==null){const cells=orientations3D(p.preview.action.piece)[p.preview.action.rotation],top=p.board.height-Math.max(...cells.map(c=>c[1]))-1;
        const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?100:550;
        const t=Math.min(1,(performance.now()-p.dropStarted)/duration),ease=1-(1-t)**3;
        ghost.position.y=(top-p.preview.action.y)*(1-ease);
      }else ghost.position.y=0;
      controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);
    };
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();render();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();box.dispose();edges.dispose();materials.forEach(m=>m.dispose());scene.traverse(o=>{if(o.userData.ownedGeometry)(o as THREE.LineSegments).geometry.dispose();});renderer.dispose();renderer.domElement.remove();stage.current=null;};
  },[]);
  useEffect(()=>{
    const s=stage.current;if(!s)return;const b=props.board;
    s.controls.target.set(0,b.height*.32,0);
    if(props.cameraView==='top')s.camera.position.set(.01,b.height+15,.01);
    else if(props.cameraView==='front')s.camera.position.set(0,b.height*.45,b.height+12);
    else s.camera.position.set(b.width+9,b.height*.85,b.depth+11);
    s.controls.update();
  },[props.board.width,props.board.depth,props.board.height,props.cameraView,props.cameraVersion]);
  useEffect(()=>{
    const s=stage.current;if(!s)return;
    for(const group of [s.blocks,s.ghost]){group.traverse(o=>{if(o.userData.ownedGeometry)(o as THREE.LineSegments).geometry.dispose();});group.clear();}
    s.materials.splice(0).forEach(m=>m.dispose());
    const b=props.board,colors=COLOR_TOKENS.map(tokenColor),accent=tokenColor('--color-accent'),gold=tokenColor('--color-gold'),grid=tokenColor('--color-rule');
    const materials=colors.map(color=>new THREE.MeshStandardMaterial({color,roughness:.38,metalness:.16}));
    const outline=new THREE.LineBasicMaterial({color:tokenColor('--color-paper'),transparent:true,opacity:.55});
    const ghostMaterial=new THREE.MeshStandardMaterial({color:accent,emissive:accent,emissiveIntensity:.2,transparent:true,opacity:.63,roughness:.2,depthWrite:false});
    const ghostOutline=new THREE.LineBasicMaterial({color:accent});
    const clearMaterial=new THREE.MeshStandardMaterial({color:gold,emissive:gold,emissiveIntensity:.55,roughness:.35});
    const holeMaterial=new THREE.LineBasicMaterial({color:tokenColor('--color-warning'),transparent:true,opacity:.85});
    const lineMaterial=new THREE.LineBasicMaterial({color:grid,transparent:true,opacity:.6});
    s.materials.push(...materials,outline,ghostMaterial,ghostOutline,clearMaterial,holeMaterial,lineMaterial);
    const position=(x:number,y:number,z:number)=>new THREE.Vector3(x-(b.width-1)/2,y+.5,z-(b.depth-1)/2);
    const cube=(group:THREE.Group,x:number,y:number,z:number,material:THREE.Material,border:THREE.Material)=>{
      const mesh=new THREE.Mesh(s.box,material);mesh.position.copy(position(x,y,z));group.add(mesh);
      const lines=new THREE.LineSegments(s.edges,border);lines.position.copy(mesh.position);group.add(lines);
    };
    const line=(points:THREE.Vector3[],material:THREE.Material)=>{const geometry=new THREE.BufferGeometry().setFromPoints(points);const obj=new THREE.LineSegments(geometry,material);obj.userData.ownedGeometry=true;s.blocks.add(obj);};
    const coords:THREE.Vector3[]=[];
    for(let x=0;x<=b.width;x++)coords.push(new THREE.Vector3(x-b.width/2,0,-b.depth/2),new THREE.Vector3(x-b.width/2,0,b.depth/2));
    for(let z=0;z<=b.depth;z++)coords.push(new THREE.Vector3(-b.width/2,0,z-b.depth/2),new THREE.Vector3(b.width/2,0,z-b.depth/2));
    line(coords,lineMaterial);
    const boundaryBox=new THREE.BoxGeometry(b.width,b.height,b.depth),boundary=new THREE.EdgesGeometry(boundaryBox);boundaryBox.dispose();
    const wall=new THREE.LineSegments(boundary,lineMaterial);wall.position.y=b.height/2;wall.userData.ownedGeometry=true;s.blocks.add(wall);
    for(let z=0;z<b.depth;z++)for(let x=0;x<b.width;x++){
      let covered=false;
      for(let y=b.height-1;y>=0;y--){const value=b.cells[index3D(b,x,y,z)];const visible=!props.cut||y<=props.slice;
        if(value){covered=true;if(visible)cube(s.blocks,x,y,z,props.clearRows.includes(y)?clearMaterial:materials[value===9?0:value],outline);}
        else if(covered&&props.holes&&visible){const hole=new THREE.LineSegments(s.edges,holeMaterial);hole.position.copy(position(x,y,z));s.blocks.add(hole);}
      }
    }
    if(props.shaft){const shaftMaterial=new THREE.LineBasicMaterial({color:gold,transparent:true,opacity:.55});s.materials.push(shaftMaterial);
      const shaftBox=new THREE.BoxGeometry(.99,b.height,.99),shaftGeometry=new THREE.EdgesGeometry(shaftBox);shaftBox.dispose();const shaft=new THREE.LineSegments(shaftGeometry,shaftMaterial);shaft.position.set((b.width-1)/2,b.height/2,(b.depth-1)/2);shaft.userData.ownedGeometry=true;s.blocks.add(shaft);
    }
    if(props.cut){const sliceMaterial=new THREE.LineBasicMaterial({color:accent,transparent:true,opacity:.75});s.materials.push(sliceMaterial);const y=props.slice+1;
      line([new THREE.Vector3(-b.width/2,y,-b.depth/2),new THREE.Vector3(b.width/2,y,-b.depth/2),new THREE.Vector3(b.width/2,y,-b.depth/2),new THREE.Vector3(b.width/2,y,b.depth/2),new THREE.Vector3(b.width/2,y,b.depth/2),new THREE.Vector3(-b.width/2,y,b.depth/2),new THREE.Vector3(-b.width/2,y,b.depth/2),new THREE.Vector3(-b.width/2,y,-b.depth/2)],sliceMaterial);
    }
    if(props.preview){const a=props.preview.action;orientations3D(a.piece)[a.rotation].forEach(([x,y,z])=>{if(!props.cut||a.y+y<=props.slice)cube(s.ghost,a.x+x,a.y+y,a.z+z,ghostMaterial,ghostOutline);});}
  },[props.board,props.preview,props.cut,props.slice,props.holes,props.shaft,props.clearRows]);
  return <div className="three-scene" ref={host} data-testid="three-scene" data-renderer={unavailable?'fallback':'webgl'}>
    {unavailable&&<div className="three-fallback" role="status"><strong>이 브라우저에서 WebGL을 사용할 수 없습니다.</strong><p>오른쪽 층별 단면으로 배치·삭제·AI 탐색을 계속 실험할 수 있습니다.</p></div>}
    <div className="three-axis" aria-label="좌표축"><span>x · 가로</span><span>y · 높이 ↑</span><span>z · 깊이</span></div>
    <span className="three-orbit-hint">드래그로 회전 · 휠 / 두 손가락으로 확대</span>
  </div>;
}
