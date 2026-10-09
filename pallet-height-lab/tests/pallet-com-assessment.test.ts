import {describe,it,expect} from 'vitest';
import {assessPalletCom} from '../src/pallet/comAssessment';
import type {Placement} from '../src/pallet/types';
const pallet={width:1000,depth:1000,maxHeight:2000};
const box=(x=0,y=0,z=0,w=1000,d=1000,h=200,m=10):Placement=>({id:`${x}-${y}-${z}`,typeId:'t',position:{x,y,z},size:{w,d,h},weight:m,orientation:0,supports:[],supportRatio:1,loadAbove:0});
describe('display-only pallet CoM assessment',()=>{
 it('computes a centered base from exact geometry',()=>{
  const a=assessPalletCom(pallet,[box()]);
  expect(a.center).toEqual({x:500,y:500,z:100});expect(a.marginMm).toBe(500);
  expect(a.score).toBeCloseTo(100*500/600);expect(a.tippingDeg).toBeCloseTo(Math.atan(5)*180/Math.PI);
 });
 it('uses mass-weighted centers and gives less margin to an offset load',()=>{
  const centered=assessPalletCom(pallet,[box(),box(400,400,200,200,200,200,90)]);
  const offset=assessPalletCom(pallet,[box(),box(800,400,200,200,200,200,90)]);
  expect(offset.center?.x).toBe(860);expect(offset.center?.z).toBe(280);
  expect(offset.marginMm).toBe(140);expect(offset.score!).toBeLessThan(centered.score!);
 });
 it('reduces the score when identical footprints have higher CoM',()=>{
  expect(assessPalletCom(pallet,[box(0,0,0,1000,1000,1000)]).score!).toBeLessThan(assessPalletCom(pallet,[box()]).score!);
 });
 it('does not pretend empty, unsupported or invalid input is safe',()=>{
  expect(assessPalletCom(pallet,[])).toMatchObject({status:'empty',score:null});
  expect(assessPalletCom(pallet,[box(0,0,20)])).toMatchObject({status:'invalid',score:null});
  for(const p of [box(0,0,0,1000,1000,200,0),box(NaN),box(0,0,0,1000,1000,200,Infinity),box(0,0,-20)])
   expect(assessPalletCom(pallet,[p]).score).toBeNull();
 });
 it('clips floor contacts to the pallet and reports an outside resultant as zero',()=>{
  const a=assessPalletCom(pallet,[box(0,0,0,200,1000,100,1),box(800,0,100,200,1000,100,100)]);
  expect(a.status).toBe('outside');expect(a.score).toBe(0);expect(a.marginMm!).toBeLessThan(0);
  const clipped=assessPalletCom(pallet,[box(-100,0,0,1100,1000)]);
  expect(Math.min(...clipped.hull.map(p=>p.x))).toBe(0);
 });
 it('treats a resultant on a support edge as zero',()=>{
  const a=assessPalletCom(pallet,[box(0,0,0,200,1000,100,1),box(200,0,100,200,1000,100,1)]);
  expect(a.marginMm).toBe(0);expect(a.score).toBe(0);expect(a.status).toBe('outside');
 });
 it('is invariant to order and subdivision and does not mutate inputs',()=>{
  const split=[box(0,0,0,500,1000,200,5),box(500,0,0,500,1000,200,5)],before=structuredClone(split);
  expect(assessPalletCom(pallet,split).score).toBeCloseTo(assessPalletCom(pallet,[box()]).score!);
  expect(assessPalletCom(pallet,[...split].reverse())).toEqual(assessPalletCom(pallet,split));expect(split).toEqual(before);
 });
});
