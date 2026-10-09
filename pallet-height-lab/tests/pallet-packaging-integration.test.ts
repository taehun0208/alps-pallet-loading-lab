import {it,expect} from 'vitest';
import {packagingScenario,sampleSpecs} from '../src/pallet/packaging/spec';
import {PACKAGE_SETTINGS} from '../src/pallet/packaging/planner';
import {newSession,preview,commit,applyEvent} from '../src/pallet/packaging/session';
import {ArrivalEnvironment} from '../src/pallet/environment';
import {emptyFrame,DEFAULT_SEARCH} from '../src/pallet/types';
import {candidateSet} from '../src/pallet/candidates';
import {createRelay,localInput} from '../src/pallet/relay/engine';
import {operationScenario} from '../src/pallet/relay/operations';
import {parseScenario} from '../src/pallet/scenarios';
it('passes BoxSpec through legacy, stock, and four-cell planning paths',()=>{
 const s=packagingScenario(),env=new ArrivalEnvironment(s),input=env.input(emptyFrame(),'greedy',DEFAULT_SEARCH,'integration')!;
 expect(input.current.packaging?.id).toBe(input.current.typeId);expect(candidateSet(input).candidates.every(c=>!!c.placement.packaging)).toBe(true);
 const world=createRelay(s);expect(world.cells).toHaveLength(4);for(let i=0;i<4;i++){const input=localInput(s,world,i,'height-fill');expect(input.available!.every(b=>!!b.packaging)).toBe(true);expect(candidateSet({...input,available:undefined}).candidates.every(c=>!!c.placement.packaging)).toBe(true);}
});
it('retains the industrial/cobot payload limit when loading package stock',()=>{expect(operationScenario(packagingScenario(),'fixed',160).constraints.gripper.payload).toBe(35);expect(operationScenario(packagingScenario(),'cobot',160).constraints.gripper.payload).toBe(15);});
it('rejects a stale plan after observation correction',()=>{const state=newSession(packagingScenario()),plan=preview(state,'greedy',PACKAGE_SETTINGS),updated=applyEvent(state,{kind:'weight',weight:90});expect(commit(updated,plan)).toBe(updated);expect(updated.placements).toHaveLength(0);});
it('validates imported BoxSpec and 3D robot settings',()=>{expect(parseScenario(JSON.stringify(packagingScenario())).types[0].packaging).toBeDefined();const s=packagingScenario();s.types[0].packaging!.centerOfGravity.x=9999;expect(()=>parseScenario(JSON.stringify(s))).toThrow(/무게중심/);});
it('keeps independent specs when a legacy resize event is injected',()=>{const s=packagingScenario([sampleSpecs()[1]]);s.arrival.pattern='ordered';s.events=[{step:1,kind:'resize',size:{w:500,d:360,h:300}}];const env=new ArrivalEnvironment(s),b=env.current(0)!;expect(b.packaging?.centerOfGravity).toEqual({x:250,y:180,z:150});expect(env.current(1)?.size.w).toBe(250);expect(s.types[0].packaging?.length).toBe(250);});
