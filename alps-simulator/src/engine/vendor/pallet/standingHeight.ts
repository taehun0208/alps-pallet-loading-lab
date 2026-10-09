import { EPS,top } from './geometry';
import type { Constraints,Placement } from './types';

export const DEFAULT_STANDING_HEIGHT={enabled:true,maxRiseMm:100};
type Box=Pick<Placement,'position'|'size'>;
// This is a local skyline policy, not a lateral support or friction model.
export const isTallBox=(b:Pick<Box,'size'>)=>b.size.h>1.25*Math.min(b.size.w,b.size.d)+EPS;
export function standingHeight(b:Box,placed:Placement[],c:Constraints){
 const config={...DEFAULT_STANDING_HEIGHT,...c.standingHeight},tall=isTallBox(b),limitMm=Math.min(config.maxRiseMm,b.size.h*.25);
 const nearMm=Math.max(20,c.horizontalGap),references:{id:string;height:number;coverage:number}[]=[];
 if(tall)for(const o of placed){
  if(isTallBox(o)||top(o)<=b.position.z+EPS||o.position.z>=(b.position.z+b.size.h)-EPS)continue;
  const overlapX=Math.max(0,Math.min(b.position.x+b.size.w,o.position.x+o.size.w)-Math.max(b.position.x,o.position.x));
  const overlapY=Math.max(0,Math.min(b.position.y+b.size.d,o.position.y+o.size.d)-Math.max(b.position.y,o.position.y));
  const gapX=Math.max(o.position.x-(b.position.x+b.size.w),b.position.x-(o.position.x+o.size.w));
  const gapY=Math.max(o.position.y-(b.position.y+b.size.d),b.position.y-(o.position.y+o.size.d));
  const coverage=Math.max(gapX>=-EPS&&gapX<=nearMm+EPS?overlapY/b.size.d:0,gapY>=-EPS&&gapY<=nearMm+EPS?overlapX/b.size.w:0);
  if(coverage>=.5-EPS)references.push({id:o.id,height:top(o),coverage});
 }
 references.sort((a,b)=>b.height-a.height||b.coverage-a.coverage||a.id.localeCompare(b.id));
 const reference=references[0],referenceHeight=reference?.height??null,riseMm=reference?Math.max(0,(b.position.z+b.size.h)-reference.height):null;
 const valid=!config.enabled||!tall||!!reference&&riseMm!<=limitMm+EPS;
 const reason=valid?'':!reference?'세로 박스 주변 높이 부족 · 가까운 눕힌 적재를 먼저 쌓아야 함':`세로 박스 돌출 높이 초과 · ${riseMm!.toFixed(0)} / ${limitMm.toFixed(0)} mm · 이웃 ${reference.id}`;
 return {enabled:config.enabled,tall,valid,referenceId:reference?.id??null,referenceHeight,riseMm,limitMm,nearMm,reason};
}
