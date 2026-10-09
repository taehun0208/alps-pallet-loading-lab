import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {streamInventory,inventoryProfileInfo,getInventoryProfile} from '../src/pallet/relay/streamInventory';
import {materialInfo} from '../src/pallet/materials';
import orders from '../src/pallet/relay/data/bed-bpp-euro-orders.json';
import provenance from '../src/pallet/relay/data/bed-bpp-provenance.json';
import {ArrivalEnvironment} from '../src/pallet/environment';
describe('BED-BPP inventory import',()=>{
 it('bundles a traceable intact subset matching its recorded content hash',()=>{
  const bytes=readFileSync('src/pallet/relay/data/bed-bpp-euro-orders.json');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.subsetSha256);
  expect(Object.keys(orders)).toEqual(provenance.orderIds);expect(Object.values(orders).every(o=>o.properties.target==='euro-pallet')).toBe(true);
 });
 it('replays the whole original order with exact dimensions, mass and source sequence',()=>{
  const s=streamInventory(0,8,1600,'bed-bpp'),source=Object.values(orders['00100004'].item_sequence),env=new ArrivalEnvironment(s);
  expect(s.types).toHaveLength(58);expect(env.total).toBe(58);expect(s.pallet).toEqual({width:1200,depth:800,maxHeight:1600});
  source.forEach((item,i)=>{const o=env.current(i)!;expect(o.size).toEqual({w:item['length/mm'],d:item['width/mm'],h:item['height/mm']});expect(o.weight).toBe(item['weight/kg']);expect(o.orientationAllowed).toEqual([0,90]);});
  expect(getInventoryProfile(s)).toBe('bed-bpp');expect(inventoryProfileInfo(0,'bed-bpp',8).count).toBe(58);
 });
 it('keeps missing compression data unknown and labels simulator assumptions separately',()=>{
  const s=streamInventory(42,120,2000,'bed-bpp-stress');expect(s.types.every(t=>t.maxLoadKg===undefined&&materialInfo(t).capacity===null)).toBe(true);
  expect(s.constraints.heavyRule).toBe('off');expect(s.constraints.standingHeight?.enabled).toBe(false);expect(s.constraints.workspace.zMax).toBeGreaterThan(2000);
  const info=inventoryProfileInfo(42,'bed-bpp-stress',120,2000);expect(info.assumptions.some(s=>s.includes('강도 미검증'))).toBe(true);expect(info.fourPalletVolumeRatio).toBe(info.totalVolumeMm3/(4*1200*800*2000));
 });
 it('concatenates original sequences deterministically with distinct instance IDs and an explicit count cap',()=>{
  const s=streamInventory(0,240,1600,'bed-bpp-stress'),a=streamInventory(0,120,1600,'bed-bpp-stress');
  expect(s.types).toHaveLength(240);expect(new Set(s.types.map(t=>t.id)).size).toBe(240);expect(s.types.slice(0,120)).toEqual(a.types);
  expect(a.types[58].name).toContain('00100005');expect(inventoryProfileInfo(0,'bed-bpp-stress',120).orderIds).toEqual(['00100004','00100005','00100006']);
  expect(()=>streamInventory(0,241,1600,'bed-bpp-stress')).toThrow();expect(()=>streamInventory(0,121)).toThrow();
 });
});
