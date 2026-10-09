import { it,expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { relayHeightDemo } from '../src/pallet/relay/demo';
import { runRelay,assertRelayInventory } from '../src/pallet/relay/engine';
import { inspectConstraints } from '../src/pallet/constraints';
import { top,volume } from '../src/pallet/geometry';

it('measures four-cell height filling with irregular finite stock and validates every committed stack',()=>{
 const s=relayHeightDemo(),start=performance.now(),r=runRelay(s,'height-fill',{seed:42,progress:w=>{writeFileSync('docs/pallet-four-progress.json',JSON.stringify({step:w.revision,placed:w.cells.reduce((n,c)=>n+c.placements.length,0),heights:w.cells.map(c=>Math.max(0,...c.placements.map(top)))}));}}),w=r.world;
 expect(assertRelayInventory(w)).toBe(true);expect(w.cells).toHaveLength(4);
 for(const cell of w.cells){let placed:typeof cell.placements=[];for(const p of cell.placements){const b=w.boxes.find(b=>b.observation.id===p.id)!;const checked=inspectConstraints(p,b.observation,placed,s.pallet,{...s.constraints,robotMode:'ideal'});expect(checked.reasons).toEqual([]);placed=checked.stack;}}
 const heights=w.cells.map(c=>Math.max(0,...c.placements.map(top))),placed=w.cells.reduce((n,c)=>n+c.placements.length,0),report={elapsedMs:performance.now()-start,peak:r.peakConcurrent,placed,total:w.boxes.length,heights,fill:w.cells.map(c=>c.placements.reduce((n,p)=>n+volume(p.size),0)/(s.pallet.width*s.pallet.depth*s.pallet.maxHeight)),transfers:w.records.filter(r=>r.kind==='send').length,reasons:r.decision.reasons,scenario:s,world:w};
 writeFileSync('docs/pallet-four-height.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,scenario:undefined,world:undefined}));
 // Four cells redistribute the same stock; each must exceed 90%, with mean >96%.
 expect(heights.every(h=>h<=s.pallet.maxHeight&&h>=s.pallet.maxHeight*.90)).toBe(true);
 expect(r.peakConcurrent).toBe(4);expect(r.world.records.filter(r=>r.kind==='send').length).toBeGreaterThan(0);
 expect(heights.reduce((n,h)=>n+h,0)/(w.cells.length*s.pallet.maxHeight)).toBeGreaterThan(.96);
},600000);
