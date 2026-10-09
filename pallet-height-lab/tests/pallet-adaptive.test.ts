import {describe,it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {DEFAULT_CONFIG,type Box,type Config,type Placed} from '../src/pallet/adaptive/types';
import {shape,area,makeBoxes,observe,volumes,wallSolids} from '../src/pallet/adaptive/shape';
import {assess,unionContacts} from '../src/pallet/adaptive/mechanics';
import {suctionCandidates,transport} from '../src/pallet/adaptive/grasp';
import {baseline,baselineInput,planObserved} from '../src/pallet/adaptive/planner';
import {plan} from '../src/pallet/planner';
import {Session,adjudicate,metrics,validateConfig,validateBoxes} from '../src/pallet/adaptive/runtime';
const cfg=():Config=>({...structuredClone(DEFAULT_CONFIG),pallet:{width:1000,depth:1000,maxHeight:1400},timeBudgetMs:30000,maxCandidates:32});
function box(id:string,w=200,d=200,h=100,mass=5):Box{return{id,nominal:{w,d,h},parts:shape({w,d,h},'normal',0),mass,com:{x:w/2,y:d/2,z:h/2},rotations:[0,90],friction:.5,strength:{topLoadKg:100,residual:1,source:'assumption',note:'test'},damage:'normal',masks:[],arrival:0,color:'#80b7b0',suction:{seal:'unknown',maxMassKg:35,maxMomentNm:20}};}
const at=(b:Box,x=0,y=0,z=0):Placed=>({box:b,position:{x,y,z},rotation:0});
describe('deformed pallet mechanics and causal planning',()=>{
 it('1 preserves original planner decisions with normal shapes',()=>{
  const c=cfg();c.mode='A';const b=box('a'),input=baselineInput(b,[],c),a=baseline(input),old=plan(input);
  expect(a.selectedId).toBe(old.selectedId);expect(a.candidates.map(v=>v.placement)).toEqual(old.candidates.map(v=>v.placement));
  const session=new Session(c,[box('a'),box('b'),box('c')]);expect(session.run().placed).toHaveLength(3);
 });
 it('2 bulge changes true boundary feasibility and three volume definitions',()=>{
  const c=cfg(),b=box('bulge',400,300,200);expect(assess([at(b,600)],c).reasons).not.toContain('boundary');
  b.parts=shape(b.nominal,'bulge',30);expect(assess([at(b,600)],c).reasons).toContain('boundary');
  const v=volumes(b);expect(v.occupiedVolume).toBeGreaterThan(v.nominalVolume);expect(v.envelopeVolume).toBeGreaterThan(v.occupiedVolume);
 });
 it('3 tiny contacts and floating placements are not valid support',()=>{
  const c=cfg();expect(assess([at(box('float'),0,0,5)],c).reasons).toContain('support');
  const a=box('a',20,200,100),b=box('b');expect(assess([at(a),at(b,0,0,100)],c).reasons).toContain('support');
 });
 it('4 unions overlap and conserves force and moment over several supports',()=>{
  const contacts=unionContacts([{x:0,y:0,w:100,d:100,owner:'a'},{x:50,y:0,w:100,d:100,owner:'b'}]);
  expect(contacts.reduce((s,c)=>s+c.area,0)).toBe(15000);expect(area(contacts.map(c=>c.rect))).toBe(15000);
  const c=cfg(),a=box('a',100,200,100),b=box('b',100,200,100),top=box('top',200,200,100,12);
  const r=assess([at(a),at(b,100),at(top,0,0,100)],c);expect(r.reasons).toEqual([]);expect(r.loads.a.aboveKg+r.loads.b.aboveKg).toBeCloseTo(12);
  expect(r.forceResidualKg).toBeLessThan(1e-7);expect(r.momentResidualKgMm).toBeLessThan(1e-5);expect(r.floorReactionKg).toBe(22);
 });
 it('5 propagates cumulative overload to the lowest box',()=>{
  const c=cfg(),a=box('a'),b=box('b'),d=box('c');a.strength.topLoadKg=8;
  expect(assess([at(a),at(b,0,0,100)],c).reasons).not.toContain('load');
  const r=assess([at(a),at(b,0,0,100),at(d,0,0,200)],c);expect(r.reasons).toContain('load');expect(r.loads.a.aboveKg).toBe(10);
 });
 it('6 detects explicit CoM and transmitted load tipping, even with area support',()=>{
  const c=cfg();c.supportRatio=.4;const a=box('base',100,200,100,1),b=box('bridge',200,200,100,1),d=box('upper',100,200,100,20);
  b.com.x=40;expect(assess([at(a),at(b,0,0,100)],c).reasons).not.toContain('tipping');
  expect(assess([at(a),at(b,0,0,100),at(d,100,0,200)],c).reasons).toContain('tipping');
  b.com.x=190;expect(assess([at(a),at(b,0,0,100)],c).reasons).toContain('tipping');
 });
 it('7 rejects damaged central cup patch but finds a whole off-centre flat patch',()=>{
  const c=cfg(),b=box('tear',400,400,150,2);b.masks=[{x:160,y:160,w:80,d:80}];
  const gs=suctionCandidates(b,c);expect(gs.some(g=>g.valid)).toBe(true);
  expect(gs.find(g=>g.point.x===200&&g.point.y===200)?.valid).toBe(false);
  const dent=box('dent',400,400,150,2);dent.parts=shape(dent.nominal,'dent',25);
  expect(suctionCandidates(dent,c).filter(g=>g.valid).length).toBeGreaterThan(0);
 });
 it('8 rejects a descent path under an overhang despite a clear final box',()=>{
  const c=cfg(),target=at(box('target'),100,100,0),obstacle=at(box('roof',300,300,100),50,50,400),g=suctionCandidates(target.box,c).find(g=>g.valid)!;
  expect(transport(target,[obstacle],g,c).reasons).toContain('path');
  expect(transport(target,[],g,c).reasons).toEqual([]);
 });
 it('9 never borrows nonexistent wall support or lateral friction',()=>{
  const c=cfg(),floating=at(box('a'),0,0,10);expect(wallSolids(c)).toEqual([]);expect(assess([floating],c).reasons).toContain('support');
  c.environment='roll';expect(wallSolids(c)).toHaveLength(3);expect(assess([floating],c).reasons).toContain('support');
 });
 it('10 seeded observations and finite retries are reproducible; planner has no future input',()=>{
  const c=cfg();c.count=5;c.noise={dimensionMm:3,positionMm:2,surfaceMm:2,yawDeg:.3};c.maxCandidates=12;
  const boxes=makeBoxes(c);expect(observe(at(boxes[0]),c,2)).toEqual(observe(at(boxes[0]),c,2));
  const a=new Session(c,boxes).run(),b=new Session(c,boxes).run();const stable=(f:typeof a)=>({events:f.events,placed:f.placed,rejected:f.rejected,tick:f.tick,retries:f.retries});
  expect(stable(a)).toEqual(stable(b));expect(a.done).toBe(true);expect(a.tick).toBeLessThan(50);expect(a.placed.length+a.rejected.length).toBe(5);
  const seen=[observe(at(boxes[0]),c,0)],r1=planObserved(seen,[],{},c),r2=planObserved(seen,[],{},c);expect(r1.selected).toEqual(r2.selected);
 });
 it('keeps material damage and CoM independent of shape and refuses unknown load capacity',()=>{
  const c=cfg(),a=box('a'),b=box('b');const center=structuredClone(a.com);a.parts=shape(a.nominal,'corner',20);
  expect(a.com).toEqual(center);expect(a.strength.residual).toBe(1);a.strength.topLoadKg=null;
  expect(assess([at(a),at(b,0,0,100)],c).reasons).toContain('strength');
 });
 it('validates the commanded grasp instead of substituting an oracle grasp',()=>{
  const c=cfg(),b=box('tear',400,400,150,2);b.masks=[{x:160,y:160,w:80,d:80}];
  expect(adjudicate(at(b),[],c,{x:200,y:200,z:150}).reasons).toContain('grasp');
  const point=suctionCandidates(b,c).find(g=>g.valid)!.point;
  expect(adjudicate(at(b),[],c,point).reasons).not.toContain('grasp');
  expect(adjudicate(at(b),[],c,{...point,z:point.z+3}).reasons).toContain('grasp');
 });
 it('rejects malformed inputs and preserves occupied volume under permitted yaw',()=>{
  const c=cfg();c.supportRatio=0;expect(()=>validateConfig(c)).toThrow();
  const b=box('a');b.rotations=[90];expect(volumes(b,0).occupiedVolume).toEqual(volumes(b,90).occupiedVolume);
  b.parts[0].w=-1;expect(()=>validateBoxes([b])).toThrow();
 });
 it('makes causal baseline adapter replay the original placements across a layered sequence',()=>{
  const c=cfg();c.mode='A';c.pallet={width:400,depth:400,maxHeight:1200};let oldStack:any[]=[],newStack:Placed[]=[];
  for(let i=0;i<8;i++){const b=box('p'+i,200,200,100,2),oldInput=baselineInput(b,[],c);oldInput.placements=oldStack;
   const old=plan(oldInput),oldChoice=old.candidates.find(v=>v.id===old.selectedId)!;
   const fresh=baseline(baselineInput(b,newStack,c)),next=fresh.candidates.find(v=>v.id===fresh.selectedId)!;
   expect(next?.placement.position).toEqual(oldChoice?.placement.position);expect(next?.placement.orientation).toBe(oldChoice?.placement.orientation);
   if(!oldChoice)break;oldStack.push(oldChoice.placement);newStack.push({box:b,position:next.placement.position,rotation:next.placement.orientation as 0|90});
  }
  expect(newStack.length).toBe(8);expect(newStack.some(p=>p.position.z>0)).toBe(true);
 });
 it('does not expire unexamined FIFO boxes behind a blocked head',()=>{
  const c=cfg();c.mode='B';c.maxWait=1;c.maxRetries=0;
  const bad=box('bad',1200,1200,100),good=box('good');
  const f=new Session(c,[bad,good]).run();expect(f.placed.map(p=>p.box.id)).toContain('good');
 });
 it('compares identical actual inputs and writes measured multi-seed results',()=>{
  const rows=[];for(const seed of [41,42,43])for(const mode of ['A','B','C'] as const){const c=cfg();Object.assign(c,{seed,mode,count:12,maxCandidates:24});const boxes=makeBoxes(c),s=new Session(c,boxes),f=s.run();const row={config:c,boxes,metrics:metrics(f,boxes,c),frame:f};rows.push(row);
   expect(f.done).toBe(true);expect(f.placed.length+f.rejected.length).toBe(12);expect(row.metrics.physicalPickSuccessRate).toBeNull();expect(row.metrics.finalViolations).toEqual([]);
   for(const p of f.placed)expect(adjudicate(p,f.placed.filter(v=>v.box.id!==p.box.id&&v.position.z<=p.position.z),c).mechanics.reasons).not.toContain('collision');
  }
  mkdirSync('docs/adaptive-results',{recursive:true});writeFileSync('docs/adaptive-results/comparison.json',JSON.stringify(rows.map(r=>({...r,frame:{...r.frame,candidates:r.frame.candidates.map(v=>({id:v.id,boxId:v.boxId,position:v.position,rotation:v.rotation,reasons:v.reasons,score:v.score}))}})),null,2));
  const keys=['mode','seed','placed','unplaced','utilization','nominalFulfilled','heightMm','retries','waitTicks','planningMs','modelExecutionSeconds','forceResidualKg','momentResidualKgMm'] as const;
  writeFileSync('docs/adaptive-results/comparison.csv',keys.join(',')+'\n'+rows.map(r=>keys.map(k=>r.metrics[k]).join(',')).join('\n'));
  console.log(JSON.stringify(rows.map(r=>({mode:r.metrics.mode,seed:r.metrics.seed,placed:r.metrics.placed,ms:Math.round(r.metrics.planningMs)}))));
 },180000);
});
