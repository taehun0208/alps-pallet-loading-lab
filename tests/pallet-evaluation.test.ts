import { describe,expect,it } from 'vitest';
import { createRelayEvaluator,evaluatePallet,evaluateRelay,summarizeLatency } from '../src/pallet/relay/evaluation';
import { relayDemo } from '../src/pallet/relay/demo';
import { createStream } from '../src/pallet/relay/streamEngine';
import type { Placement } from '../src/pallet/types';
const box=(id:string,x=0,z=0,weight=1):Placement=>({id,typeId:'test',position:{x,y:0,z},size:{w:100,d:100,h:100},weight,orientation:0,supports:[],supportRatio:1,loadAbove:0});
const scenario=()=>{const s=relayDemo();s.pallet={width:1000,depth:1000,maxHeight:1000};s.constraints.stability={maxSlenderness:10,minMarginRatio:0,lateralAccelerationG:0,loadSafetyFactor:1};s.constraints.supportRatio=.9;s.constraints.heavyRule='off';return s;};
describe('relay performance evaluation',()=>{
  it('does not turn absent measurements into zero or a safety pass',()=>{
    const s=scenario(),w=createStream(s),r=evaluateRelay(s,w);
    expect(r.safety.status).toBe('unverified');expect(r.safety.minTippingG).toBeNull();expect(r.capacity.utilization).toBeNull();
    expect(r.operation.throughputPerHour).toBeNull();expect(r.safety.robotExecution).toBe('unverified');expect(r.robustness).toBe('unverified');
    expect(summarizeLatency([])).toEqual({count:0,p50:null,p95:null,p99:null,max:null,deadlineCount:0,validDeadlineRate:null});
  });
  it('preserves completion and nominal utilization through pallet dispatch and counts partial pallets',()=>{
    const s=scenario(),w=createStream(s),a=box(w.boxes[0].observation.id);w.cells[0].placements=[a];w.time=10;
    const before=evaluateRelay(s,w);w.cells[0].placements=[];w.stream!.dispatched.push({robot:0,cycle:1,placements:[a],at:10});
    expect(evaluateRelay(s,w).completion).toEqual(before.completion);expect(evaluateRelay(s,w).capacity).toEqual(before.capacity);
    w.cells[1].placements=[box(w.boxes[1].observation.id)];const after=evaluateRelay(s,w);
    expect(after.capacity.usedPallets).toBe(2);expect(after.capacity.utilization).toBeCloseTo(.001);expect(after.completion.placed).toBe(2);
    expect(after.operation.throughputPerHour).toBe(720);
  });
  it('reconstructs stale support fields and detects floating boxes and overlap',()=>{
    const s=scenario();expect(evaluatePallet(s,[box('floating',0,200)]).violations.some(v=>v.kind==='support')).toBe(true);
    expect(evaluatePallet(s,[box('A'),box('B',50)]).violations.some(v=>v.kind==='geometry')).toBe(true);
    expect(evaluatePallet(s,[box('outside',990)]).violations.some(v=>v.kind==='geometry')).toBe(true);
  });
  it('rejects invalid masses and duplicate graph IDs before solving contact forces',()=>{
    const s=scenario();
    for(const placements of [[box('zero',0,0,0)],[box('bad',0,0,NaN)],[box('A'),box('A',0,100)]]){
      const r=evaluatePallet(s,placements);expect(r.violations.some(v=>v.kind==='geometry')).toBe(true);expect(r.center).toBeNull();expect(r.minTippingG).toBeNull();expect(r.minMarginMm).toBeNull();
    }
    const w=createStream(s);w.cells[0].placements=[{...box('bad'),size:{w:NaN,d:100,h:100}}];const result=evaluateRelay(s,w);
    expect(result.safety.status).toBe('fail');expect(result.capacity.utilization).toBeNull();
  });
  it('uses upper loads to expose local instability even with a valid global footprint',()=>{
    const s=scenario(),base=box('base'),upper=box('upper',90,100,100);s.constraints.supportRatio=.05;
    const r=evaluatePallet(s,[base,upper]);expect(r.minSupportRatio).toBeCloseTo(.1);
    expect(r.violations.some(v=>v.message.includes('평형 불가'))).toBe(true);
    expect(r.minTippingG).toBe(0);
  });
  it('computes rigid contact tipping proxy and mass center with no overall physical certification',()=>{
    const s=scenario(),w=createStream(s);w.cells[0].placements=[box('A'),box('B',0,100)];const r=evaluateRelay(s,w);
    expect(r.pallets[0].center).toEqual({x:50,y:50,z:100});expect(r.safety.minMarginMm).toBe(50);expect(r.safety.minTippingG).toBe(.5);
    expect(r.safety.status).toBe('pass');expect(r.safety.compression).toBe('unverified');
  });
  it('reports nearest-rank tails and counts invalid or late returns against an explicit deadline',()=>{
    const samples=[{milliseconds:1,deadlineMs:10,valid:true},{milliseconds:2,deadlineMs:10,valid:false},{milliseconds:20,deadlineMs:10,valid:true},{milliseconds:3},{milliseconds:NaN}];
    expect(summarizeLatency(samples)).toEqual({count:4,p50:2,p95:20,p99:20,max:20,deadlineCount:3,validDeadlineRate:1/3});
    expect(summarizeLatency([{milliseconds:3,deadlineMs:10}]).validDeadlineRate).toBeNull();
  });
  it('reuses geometry across deep-cloned ticks and refreshes on version or scenario changes',()=>{
    const s=scenario(),w=createStream(s),evaluate=createRelayEvaluator();w.cells[0].placements=[box('A')];
    const a=evaluate(s,w);w.time=20;expect(evaluate(s,w).operation.modeledElapsedSeconds).toBe(20);
    expect(evaluate(s,structuredClone(w)).pallets[0].center).toBe(a.pallets[0].center);
    w.cells[0].placements=[...w.cells[0].placements,box('B',500)];w.cells[0].version++;expect(evaluate(s,w).completion.placed).toBe(2);expect(a.completion.placed).toBe(1);
    const other={...s,pallet:{...s.pallet,width:10}};expect(evaluate(other,w).safety.status).toBe('fail');
  });
});
