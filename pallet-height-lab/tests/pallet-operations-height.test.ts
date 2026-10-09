import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {relayHeightDemo} from '../src/pallet/relay/demo';
import {operationScenario,manifest} from '../src/pallet/relay/operations';
import {runRelay,assertRelayInventory} from '../src/pallet/relay/engine';
it('runs the full irregular 192-box batch with the physical tool and retains unplaced stock',()=>{const s=operationScenario(relayHeightDemo(),'amr',160),start=performance.now(),r=runRelay(s,'height-fill',{seed:42}),out=manifest(r.world),report={elapsedMs:performance.now()-start,peak:r.peakConcurrent,placed:out.reduce((n,p)=>n+p.boxIds.length,0),total:r.world.boxes.length,heights:out.map(p=>p.heightMm),robotSeconds:r.elapsed,lastDecision:r.decision,manifest:out};expect(assertRelayInventory(r.world)).toBe(true);expect(r.peakConcurrent).toBe(4);expect(report.heights.every(h=>h<=s.pallet.maxHeight&&h>=s.pallet.maxHeight*.95)).toBe(true);expect(report.placed).toBeGreaterThan(20);writeFileSync('docs/pallet-operations-height.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,manifest:undefined,lastDecision:undefined}));},600000);

