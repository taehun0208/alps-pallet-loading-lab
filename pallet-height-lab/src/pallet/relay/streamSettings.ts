import {streamInventory} from './streamInventory';
import type {Scenario} from '../types';
export interface StreamSettings {seed:number;count:number;height:number}
export function streamSettings(s:Scenario):StreamSettings{return {seed:s.arrival.seed,count:s.types.reduce((n,t)=>n+t.quantity,0),height:s.pallet.maxHeight};}
export function settingsChanged(s:Scenario,draft:StreamSettings){const current=streamSettings(s);return current.seed!==draft.seed||current.count!==draft.count||current.height!==draft.height;}
export function applyStreamSettings(s:Scenario,draft:StreamSettings){
 if(!Number.isInteger(draft.height)||draft.height<600||draft.height>2000)throw Error('최대 높이는 600–2000 mm 범위의 정수로 입력하세요.');
 if(!Number.isInteger(draft.seed)||!Number.isInteger(draft.count)||draft.count<8||draft.count>120)throw Error('박스 수는 8–120개, 시드는 정수로 입력하세요.');
 const current=streamSettings(s);
 // Changing only the height must preserve measured carton specs and packaging constraints.
 if(current.seed===draft.seed&&current.count===draft.count){const next=structuredClone(s);next.pallet.maxHeight=draft.height;return next;}
 const next=streamInventory(draft.seed,draft.count,draft.height);next.pallet.robotLayout=s.pallet.robotLayout?{...s.pallet.robotLayout}:undefined;return next;
}
