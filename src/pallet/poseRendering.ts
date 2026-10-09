import { Quaternion,Vector3,Matrix4 } from 'three';
import { orientationYaw,verticalAxis } from './orientations';
import type { Orientation,Dimensions } from './types';
export function poseQuaternion(pose:Orientation){
 const axis=verticalAxis(pose),tilt=new Quaternion();if(axis==='w')tilt.setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);else if(axis==='d')tilt.setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
 return new Quaternion().setFromAxisAngle(new Vector3(0,1,0),orientationYaw(pose)*Math.PI/180).multiply(tilt);
}
export function movingHeight(size:Dimensions,q:Quaternion){const e=new Matrix4().makeRotationFromQuaternion(q).elements;return Math.abs(e[1])*size.w+Math.abs(e[5])*size.h+Math.abs(e[9])*size.d;}
