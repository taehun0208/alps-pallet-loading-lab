import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {packagingScenario} from '../src/pallet/packaging/spec';
import {PACKAGE_SETTINGS} from '../src/pallet/packaging/planner';
import {newSession,compareMethods} from '../src/pallet/packaging/session';
it('runs the same 22-box sequence through all five bounded planners',()=>{
 const rows=compareMethods(newSession(packagingScenario()),PACKAGE_SETTINGS);
 for(const r of rows){expect(r.metrics.packed+r.metrics.failed+r.metrics.excluded).toBe(22);expect(r.metrics.maxLoad).toBeLessThanOrEqual(1.000001);expect(r.sequence).toEqual(rows[0].sequence);expect(r.metrics.packed).toBeGreaterThan(4);}
 writeFileSync('docs/packaging-benchmark.json',JSON.stringify({date:new Date().toISOString(),settings:PACKAGE_SETTINGS,rows:rows.map(({placements,...r})=>({...r,poses:placements.map(b=>({id:b.id,position:b.position,size:b.size,support:b.supportRatio,load:b.loadAbove}))}))},null,2));
 console.log(rows.map(r=>({method:r.method,...r.metrics,capped:r.cappedSteps})));
},180000);
