import RAPIER from '@dimforge/rapier3d-compat';
import { materialInfo } from './materials';
import { engineToRender,renderToEngine,renderSize,centerOf } from './coordinates';
import type { Pallet,Placement,PhysicsSettings,PhysicsResult } from './types';
let ready:Promise<void>|null=null;
export async function verifyPhysics(placements:Placement[],pallet:Pallet,settings:PhysicsSettings,runId:string):Promise<PhysicsResult>{
 const resolved={...settings,solverIterations:settings.solverIterations??12,contactNaturalFrequencyHz:settings.contactNaturalFrequencyHz??120};
 if(!Number.isInteger(resolved.solverIterations)||resolved.solverIterations<1||resolved.solverIterations>128||!Number.isFinite(resolved.contactNaturalFrequencyHz)||resolved.contactNaturalFrequencyHz<=0||resolved.contactNaturalFrequencyHz>1000)throw Error('강체 접촉 계산 설정 범위를 확인하세요.');
 ready??=RAPIER.init();await ready;const start=performance.now(),world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=settings.dt;
 // Numerical contact stiffness for rigid boxes, not measured packaging compression strength.
 // Convergence is checked at double iterations and half dt without changing classification thresholds.
 world.numSolverIterations=resolved.solverIterations;world.integrationParameters.contact_natural_frequency=resolved.contactNaturalFrequencyHz;
 world.createCollider(RAPIER.ColliderDesc.cuboid(pallet.width/2000,.07,pallet.depth/2000).setTranslation(0,-.07,0).setFriction(settings.friction));
 const bodies=placements.map(b=>{const friction=settings.materialFriction?materialInfo(b).friction:settings.friction,p=engineToRender(centerOf(b.position,b.size),pallet),s=renderSize(b.size),body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...p).setCcdEnabled(true));world.createCollider(RAPIER.ColliderDesc.cuboid(s[0]/2,s[1]/2,s[2]/2).setMass(b.weight).setFriction(friction).setRestitution(0),body);return {b,body,friction};});
 const steps=Math.ceil(settings.seconds/settings.dt);for(let i=0;i<steps;i++)world.step();
 const poses=bodies.map(({b,body,friction})=>{const t=body.translation(),r=body.rotation(),center=renderToEngine([t.x,t.y,t.z],pallet),actual={x:center.x-b.size.w/2,y:center.y-b.size.d/2,z:center.z-b.size.h/2},displacementMm=Math.hypot(actual.x-b.position.x,actual.y-b.position.y,actual.z-b.position.z),angleDeg=2*Math.acos(Math.min(1,Math.abs(r.w)))*180/Math.PI;return {id:b.id,friction,planned:{...b.position},actual,rotation:[r.x,r.y,r.z,r.w] as [number,number,number,number],displacementMm,angleDeg,fell:actual.z<b.position.z-b.size.h/2||actual.z< -100||angleDeg>45};});
 world.free();const status=poses.some(p=>p.fell)?'fallen':poses.some(p=>p.angleDeg>settings.angleToleranceDeg)?'rotated':poses.some(p=>p.displacementMm>settings.moveToleranceMm)?'moved':'stable';return {runId,status,poses,settings:resolved,steps,milliseconds:performance.now()-start};
}
