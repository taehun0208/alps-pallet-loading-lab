import type {Box,Config,Observed,Placed} from './types';
import {observe} from './shape';
/** Camera adapters may only receive arrived instances / the visible placed scene. */
export interface ObservationProvider {capture(object:Placed,config:Config,revision:number):Observed}
export const syntheticObserver:ObservationProvider={capture:observe};
/** Future robot/AMR implementation must validate the same planned grasp and path. */
export interface MotionExecutor {
 capabilities:{inverseKinematics:boolean;contactForce:boolean;vacuumSeal:boolean};
 execute(request:{objectId:string;path:{x:number;y:number;z:number}[];rotation:0|90;grasp:{x:number;y:number;z:number}|null}):Promise<{success:boolean;reason:string;movedObjectIds:string[]}>;
}
/** FEM/BCT adapter is intentionally separate from geometric shape deformation. */
export interface MaterialCapacityProvider {
 capacity(box:Box,direction:'height'):Promise<{topLoadKg:number|null;source:'measured'|'research-example'|'assumption'|'unknown';evidence:string}>;
}
export const MODEL_CAPABILITIES={staticEquilibrium:true,compoundCollision:true,sweptGripper:true,geometricAlignment:true,forceControlledCompliance:false,vacuumSeal:false,inverseKinematics:false,flexibleBending:false,transportVibration:false} as const;
