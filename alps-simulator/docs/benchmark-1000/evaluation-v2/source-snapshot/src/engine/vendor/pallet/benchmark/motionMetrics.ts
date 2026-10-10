import type { GripPath } from '../types';
/** Rest-to-rest straight TCP segments; no joint torque or real controller model. */
export function segmentTravelSeconds(distanceMm:number,speedMmS:number,accelerationMmS2:number){
 if(distanceMm===0)return 0;
 if(!(distanceMm>=0&&speedMmS>0&&accelerationMmS2>0))return NaN;
 const rampDistance=speedMmS*speedMmS/accelerationMmS2;
 return distanceMm<=rampDistance?2*Math.sqrt(distanceMm/accelerationMmS2):distanceMm/speedMmS+speedMmS/accelerationMmS2;
}
export function estimatedPathSeconds(path:GripPath,speed:number,acceleration:number|null|undefined){
 if(path.model==='ideal')return null;
 if(acceleration==null)return path.seconds;
 return path.points.slice(1).reduce((sum,p,i)=>{
  const a=path.points[i].tcp,d=Math.hypot(p.tcp.x-a.x,p.tcp.y-a.y,p.tcp.z-a.z),hold=p.hold;
  // Preserve existing orientation/hold duration; translation and rotation overlap in this proxy.
  return sum+Math.max((path.segmentSeconds[i]??0)-hold,segmentTravelSeconds(d,speed,acceleration))+hold;
 },0);
}
