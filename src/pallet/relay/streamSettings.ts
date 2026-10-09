import {streamInventory} from './streamInventory';
import type {InventoryProfile} from './streamInventory';
import type {Scenario} from '../types';
export interface StreamSettings {seed:number;count:number;height:number;profile?:InventoryProfile;width?:number;depth?:number;deckHeight?:number|null;maxLoadKg?:number|null}
export function streamSettings(s:Scenario):StreamSettings{return {seed:s.arrival.seed,count:s.types.reduce((n,t)=>n+t.quantity,0),height:s.pallet.maxHeight,profile:s.id.startsWith('bed-bpp-stress')?'bed-bpp-stress':s.id.startsWith('bed-bpp')?'bed-bpp':'synthetic',width:s.pallet.width,depth:s.pallet.depth,deckHeight:s.pallet.deckHeightMm??null,maxLoadKg:s.pallet.maxLoadKg??null};}
export function settingsChanged(s:Scenario,draft:StreamSettings){const current=streamSettings(s);return (Object.keys(draft) as (keyof StreamSettings)[]).some(key=>draft[key]!==undefined&&current[key]!==draft[key]);}
export function applyStreamSettings(s:Scenario,draft:StreamSettings){
 if(!Number.isInteger(draft.height)||draft.height<600||draft.height>2000)throw Error('화물 높이는 600–2000 mm 범위의 정수로 입력하세요.');
 const current=streamSettings(s),profile=draft.profile??current.profile??'synthetic',maximum=profile==='synthetic'?120:240;
 if(!Number.isInteger(draft.seed)||!Number.isInteger(draft.count)||draft.count<8||draft.count>maximum)throw Error(`박스 수는 8–${maximum}개, 시드는 정수로 입력하세요.`);
 for(const name of ['width','depth'] as const){const value=draft[name];if(value!==undefined&&(!Number.isInteger(value)||value<600||value>2000))throw Error('팔레트 가로·세로는 600–2000 mm 정수로 입력하세요.');}
 if(draft.deckHeight!=null&&(!Number.isInteger(draft.deckHeight)||draft.deckHeight<0||draft.deckHeight>300))throw Error('팔레트 두께는 0–300 mm 정수로 입력하세요.');
 if(draft.maxLoadKg!=null&&(!Number.isFinite(draft.maxLoadKg)||draft.maxLoadKg<=0||draft.maxLoadKg>5000))throw Error('허용 화물 중량은 0 초과 5000 kg 이하로 입력하세요.');
 // Pallet-only changes retain the exact order and custom packaging properties.
 const sameInput=current.seed===draft.seed&&current.count===draft.count&&profile===current.profile;
 const next=sameInput?structuredClone(s):streamInventory(draft.seed,draft.count,draft.height,profile);
 next.pallet.maxHeight=draft.height;
 if(draft.width!==undefined)next.pallet.width=draft.width;
 if(draft.depth!==undefined)next.pallet.depth=draft.depth;
 if(draft.deckHeight!==undefined){if(draft.deckHeight===null)delete next.pallet.deckHeightMm;else next.pallet.deckHeightMm=draft.deckHeight;}
 if(draft.maxLoadKg!==undefined){if(draft.maxLoadKg===null)delete next.pallet.maxLoadKg;else next.pallet.maxLoadKg=draft.maxLoadKg;}
 return next;
}
