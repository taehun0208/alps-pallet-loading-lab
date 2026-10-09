import type {Dimensions,Scenario} from '../types';
import type {RelayBox} from './types';
export interface Dent {kind:'corner'|'top'|'side';depthMm:number}
export interface ScanResult {completedAt:number;deviationMm:number;verdict:'normal'|'damaged';kind:Dent['kind']|null;size:Dimensions}
export const SCANNER_OFFSET=650,REJECT_SECONDS=1.2;
export const DENT_NAMES={corner:'모서리 눌림',top:'윗면 함몰',side:'옆면 눌림'};
export function intakeSettings(rate=.16){if(!Number.isFinite(rate)||rate<0||rate>1)throw Error('찌그러짐 발생률은 0–100% 범위입니다.');return {damageRate:rate,thresholdMm:8};}
// ID-indexed seeded stream: independent from arrival spacing, render frames and planner calls.
export function seededDent(seed:number,id:string,size:Dimensions,rate:number):Dent|undefined{
 intakeSettings(rate);let h=seed>>>0;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
 const next=()=>{h=(h+0x6D2B79F5)>>>0;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
 if(next()>=rate)return;const kind=(['corner','top','side'] as const)[Math.floor(next()*3)];
 return {kind,depthMm:Math.min(18+next()*42,Math.min(size.w,size.d,size.h)*.35)};
}
// Shared surface displacement for scan sampling and visible mesh. No material/CoM changes.
export function dentFactor(kind:Dent['kind'],x:number,y:number,z:number){
 if(kind==='top')return y>.499?Math.max(0,1-4*x*x-4*z*z):0;
 if(kind==='corner')return y>.499?Math.max(0,x*2)*Math.max(0,z*2):0;
 return x>.499?Math.max(0,1-4*y*y-4*z*z):0;
}
export function scanBox(b:RelayBox,time:number,s:Scenario):ScanResult{
 let max=0;const d=b.deformation;
 if(d)for(let a=0;a<=8;a++)for(let c=0;c<=8;c++)max=Math.max(max,d.depthMm*(d.kind==='side'?dentFactor(d.kind,.5,a/8-.5,c/8-.5):dentFactor(d.kind,a/8-.5,.5,c/8-.5)));
 return {completedAt:time,deviationMm:max,verdict:max>=(s.intake?.thresholdMm??8)||b.observation.status==='damaged'?'damaged':'normal',kind:d?.kind??null,size:{...b.observation.size}};
}
export function scanned(b:RelayBox,time:number,s:Scenario){return !!b.flow&&b.flow.measuredAt<=time&&(!s.intake||!!b.scan);}
export const handled=(b:RelayBox)=>b.status==='placed'||b.status==='quarantined'||b.status==='outfeed';
