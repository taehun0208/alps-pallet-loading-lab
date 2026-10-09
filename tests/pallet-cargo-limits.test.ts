import {expect,it} from 'vitest';
import {inspectConstraints} from '../src/pallet/constraints';
import {evaluatePallet} from '../src/pallet/relay/evaluation';
import {relayDemo} from '../src/pallet/relay/demo';
import type {Observation,Placement} from '../src/pallet/types';
const box=(id:string,x:number,weight:number):Placement=>({id,typeId:id,position:{x,y:0,z:0},size:{w:100,d:100,h:100},weight,orientation:0,supports:[],supportRatio:1,loadAbove:0});
it('rejects an otherwise supported placement that exceeds the whole pallet cargo limit',()=>{
 const s=relayDemo();s.constraints.robotMode='ideal';s.pallet={width:1000,depth:1000,maxHeight:300,deckHeightMm:144,maxLoadKg:10};
 const a=box('a',0,6),b=box('b',200,5),obs:Observation={...b,status:'normal',orientationAllowed:[0]};
 expect(inspectConstraints(b,obs,[a],s.pallet,s.constraints).reasons).toContain('팔레트 허용 적재중량 초과');
 expect(evaluatePallet(s,[a,b]).violations.some(v=>v.message==='팔레트 허용 적재중량 초과')).toBe(true);
 s.pallet.maxLoadKg=11;
 expect(inspectConstraints(b,obs,[a],s.pallet,s.constraints).reasons).not.toContain('팔레트 허용 적재중량 초과');
});
it('measures the cargo height from deck surface without consuming the deck height twice',()=>{
 const s=relayDemo();s.constraints.robotMode='ideal';s.pallet={width:1000,depth:1000,maxHeight:100,deckHeightMm:144};
 const b=box('b',0,5),obs:Observation={...b,status:'normal',orientationAllowed:[0]};
 expect(inspectConstraints(b,obs,[],s.pallet,s.constraints).reasons).not.toContain('최대 적재 높이 초과');
 s.pallet.maxHeight=99;
 expect(inspectConstraints(b,obs,[],s.pallet,s.constraints).reasons).toContain('최대 적재 높이 초과');
});
