import { candidateSet } from '../planner';
import { compactScore } from '../compactPacking';
import { allowedOrientations } from '../orientations';
import { oriented,top } from '../geometry';
import type { Candidate,PlanningInput } from '../types';

// A finite-stock, bounded height-combination estimate. It is only a ranking term:
// every actual placement still passes support, equilibrium, load and path checks.
export function residualHeadroom(input:PlanningInput,c:Candidate){
 const room=Math.floor(input.pallet.maxHeight-top(c.placement));
 if(room<=0)return 0;
 const reachable=new Uint8Array(room+1);reachable[0]=1;
 for(const b of input.available||[]){
  if(b.id===c.placement.id)continue;
  const heights=[...new Set(allowedOrientations(b.size,b.orientationAllowed,b.handling,b.maxLoadByAxis).map(o=>oriented(b.size,o)).filter(s=>s.w<=c.placement.size.w&&s.d<=c.placement.size.d&&s.h<=room).map(s=>Math.ceil(s.h)))];
  // Descending sums ensure a box is used at most once across all its orientations.
  for(let z=room;z>=0;z--)if(!reachable[z]&&heights.some(h=>z>=h&&reachable[z-h]))reachable[z]=1;
 }
 for(let z=room;z>=0;z--)if(reachable[z])return room-z;
 return room;
}

export function heightFillPlan(input:PlanningInput){
 const unique=input.available!.filter((b,i,all)=>all.findIndex(v=>v.typeId===b.typeId)===i);
 const inspect=(box:typeof unique[number],budget:number)=>{
  const ctx={...input,current:box,available:undefined,remaining:{},settings:{...input.settings,inventoryMode:'none' as const,policy:'legacy' as const,maxCandidates:budget}};
  const result=candidateSet(ctx,true).candidates;
  for(const c of result){c.id=`${box.id}:${c.id}`;if(c.valid)compactScore(c,ctx);}
  return result;
 };
 let candidates=unique.flatMap(b=>inspect(b,24));
 const promising=unique.map(b=>({box:b,best:candidates.filter(c=>c.valid&&c.placement.typeId===b.typeId).sort((a,b)=>a.placement.position.z-b.placement.position.z||b.score-a.score)[0]})).filter(v=>v.best).sort((a,b)=>a.best.placement.position.z-b.best.placement.position.z||b.best.score-a.best.score).slice(0,3);
 for(const {box} of promising){candidates=candidates.filter(c=>c.placement.typeId!==box.typeId);candidates.push(...inspect(box,64));}
 if(!candidates.some(c=>c.valid))candidates=unique.flatMap(b=>inspect(b,96));
 const valid=candidates.filter(c=>c.valid),foundations=valid.filter(c=>c.placement.handling!=='no-top-load'&&c.placement.maxLoadKg!==0),pool=foundations.length?foundations:valid,lowest=Math.min(...pool.map(c=>c.placement.position.z));
 // Build broad low support first, then fit the remaining vertical space with stock.
 // We never award height alone: this avoids choosing a tall narrow pillar.
 const shortlist=(foundations.length?pool.filter(c=>c.placement.position.z<=lowest+.5):pool).sort((a,b)=>foundations.length?b.score-a.score:top(b.placement)-top(a.placement)||b.score-a.score).slice(0,16);
 // Equivalent positions share a height-combination subproblem within this decision.
 const headroomCache=new Map<string,number>();
 for(const c of shortlist){
  const room=input.pallet.maxHeight-top(c.placement),key=`${c.placement.id}:${c.placement.size.w}:${c.placement.size.d}:${room}`;
  let residual=headroomCache.get(key);if(residual===undefined){residual=residualHeadroom(input,c);headroomCache.set(key,residual);}
  const cap=c.placement.handling==='no-top-load'||c.placement.maxLoadKg===0;
  // Scale unusable height by remaining headroom, so a small unfillable top gap
  // matters near the ceiling without rewarding a tall isolated column.
  c.score+=30*(1-residual/Math.max(1,room))-(cap?180*room/input.pallet.maxHeight:0);
 }
 shortlist.sort((a,b)=>b.score-a.score||top(b.placement)-top(a.placement)||a.id.localeCompare(b.id));
 return {candidates,selectedId:shortlist[0]?.id??null};
}

