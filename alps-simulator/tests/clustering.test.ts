import {describe,it,expect} from 'vitest';
import {contact,clusteringMetrics,type ClusterBox} from '../src/metrics/clustering';
const b=(id:string,typeId:string,x=0,y=0,z=0):ClusterBox=>({id,typeId,position:{x,y,z},size:{w:100,d:100,h:100}});
describe('independent hand-calculated cluster geometry',()=>{
 it('counts a shared face once and excludes edge/corner adjacency',()=>{
  expect(contact(b('a','S1'),b('b','S1',100)).area).toBe(10000);
  expect(contact(b('a','S1'),b('b','S1',100,100)).area).toBe(0);
  const m=clusteringMetrics([b('a','S1'),b('b','S1',100),b('c','S2',200)]);
  expect(m.contactAreaMm2).toBe(20000);expect(m.sameSkuContact).toBe(.5);
  expect(m.sameDepartmentContact).toBe(1);expect(m.sameSkuVertical).toBeNull();
 });
 it('distinguishes direct vertical stacking from projection overlap through air',()=>{
  expect(clusteringMetrics([b('a','S1'),b('b','S1',0,0,100)]).sameSkuVertical).toBe(1);
  expect(clusteringMetrics([b('a','S1'),b('b','S2',0,0,100)]).sameSkuVertical).toBe(0);
  expect(clusteringMetrics([b('a','S1'),b('b','S1',0,0,200)]).sameSkuVertical).toBeNull();
 });
 it('uses area weighting, not counts of neighboring boxes',()=>{
  const c=b('c','S2',0,0,100);c.size.w=50;
  const m=clusteringMetrics([b('a','S1'),b('b','S1',100),c]);
  expect(m.sameSkuContact).toBeCloseTo(2/3);expect(m.sameSkuVertical).toBe(0);
 });
 it('measures fragmentation without merging separated boxes of the same SKU',()=>{
  const boxes=[b('a','S1'),b('b','S1',100),b('c','S1',400),b('d','S2',600)];
  const copy=structuredClone(boxes),m=clusteringMetrics(boxes);
  expect(m.components).toBe(3);expect(m.largestComponentShare).toBe(.75);expect(boxes).toEqual(copy);
 });
 it('returns unknown, not a perfect result, when no contacts exist',()=>{
  expect(clusteringMetrics([]).sameSkuContact).toBeNull();
  expect(clusteringMetrics([b('a','S1'),b('b','S1',300)]).sameSkuContact).toBeNull();
 });
});
