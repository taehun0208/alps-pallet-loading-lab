import type {Assessment,Box,Config,Observed,Placed,Pose,SearchStats,Solid} from './types';
import {assess,contacts} from './mechanics';
import {collides,worldParts} from './shape';
import {suctionCandidates,transport} from './grasp';
export type Edge={from:string;to:string;kind:'support'|'access'|'equilibrium'};
export interface CDG {nodes:string[];edges:Edge[];scope:'heuristic-only';complete:boolean}
export const emptyGraph=():CDG=>({nodes:[],edges:[],scope:'heuristic-only',complete:true});
export function ancestors(g:CDG,id:string){const found=new Set<string>(),queue=[id];while(queue.length){const v=queue.pop()!;for(const e of g.edges)if(e.to===v&&!found.has(e.from)){found.add(e.from);queue.push(e.from);}}return found;}
export function descendants(g:CDG,id:string){const found=new Set([id]),queue=[id];while(queue.length){const v=queue.pop()!;for(const e of g.edges)if(e.from===v&&!found.has(e.to)){found.add(e.to);queue.push(e.to);}}return found;}
export function physicalKey(box:Box){const {id:_,color:__,arrival:___,...physical}=box;return JSON.stringify(physical);}
export function observationKey(p:Observed){return physicalKey(p.box)+JSON.stringify([p.position,p.rotation,p.yawErrorDeg]);}
export interface Prior {key:string;pose:Pose}
export class PlanningMemory {prior=new Map<string,Prior>();}
export const searchStats=():SearchStats=>({checked:0,spaceUpdates:0,priorChecks:0,priorHits:0,equivalentSkipped:0,dependencyChecks:0,dependencyEdges:0,capped:0});
/** Contact edges are conservative prerequisites; never a certificate for coupled statics. */
export function extendGraph(g:CDG,prefix:Placed[],p:Placed,c:Config,paths:Map<string,Solid[]>,meter:{remaining:number;checks:number},deadline=Infinity,check?:Assessment):CDG {
 const out:CDG={nodes:[...g.nodes,p.box.id],edges:[...g.edges],scope:'heuristic-only',complete:g.complete};
 const add=(from:string,kind:Edge['kind'])=>{if(from!==p.box.id&&g.nodes.includes(from)&&!ancestors(out,p.box.id).has(from))out.edges.push({from,to:p.box.id,kind});};
 for(const k of check?.loads[p.box.id]?.contacts||contacts(p,prefix,c))if(k.id!=='@floor')add(k.id,'support');
 const solids=worldParts(p);
 // If the NEW item blocks a PREVIOUS item's insertion, previous -> new (not the reverse).
 for(const q of prefix){let sweeps=paths.get(q.box.id);if(!sweeps){const grasp=suctionCandidates(q.box,c).find(v=>v.valid)||null;sweeps=transport(q,[],grasp,c).sweeps;paths.set(q.box.id,sweeps);}if(sweeps.some(a=>solids.some(b=>collides(a,b,c.penetrationMm))))add(q.box.id,'access');}
 for(const q of [...prefix].reverse()){
  if(ancestors(out,p.box.id).has(q.box.id))continue;
  if(meter.remaining<=0||performance.now()>deadline){out.complete=false;continue;}
  const removed=descendants(g,q.box.id),left=prefix.filter(v=>!removed.has(v.box.id));meter.remaining--;meter.checks++;
  if(assess([...left,p],c).reasons.length)add(q.box.id,'equilibrium');
 }
 return out;
}
export function buildGraph(stack:Placed[],c:Config,maxChecks=64,deadline=Infinity){let graph=emptyGraph();const paths=new Map<string,Solid[]>(),meter={remaining:maxChecks,checks:0};for(let i=0;i<stack.length;i++)graph=extendGraph(graph,stack.slice(0,i),stack[i],c,paths,meter,deadline);return{graph,paths,meter};}
export function compatible(graph:CDG,order:string[]){if(order.length!==graph.nodes.length||new Set(order).size!==order.length||graph.nodes.some(n=>!order.includes(n)))return false;const rank=new Map(order.map((id,i)=>[id,i]));return graph.edges.every(e=>rank.get(e.from)!<rank.get(e.to)!);}
/** Bounded Verify-CDG-Coverage-style recursion. NDOP graph coverage only, NOT a QOP policy/physics certificate. */
export function verifyCoverage(nodes:string[],graphs:CDG[],maxNodes=10000,timeMs=100){
 let visited=0;const start=performance.now(),memo=new Set<string>();
 if(new Set(nodes).size!==nodes.length)throw Error('CDG 노드 ID 중복');
 const valid=graphs.filter(g=>g.nodes.length===nodes.length&&new Set(g.nodes).size===nodes.length&&g.nodes.every(n=>nodes.includes(n))&&g.edges.every(e=>nodes.includes(e.from)&&nodes.includes(e.to)&&e.from!==e.to));
 function visit(left:string[],active:CDG[]):{status:'covered-graph'|'counterexample'|'budget';order?:string[]}{
  if(++visited>maxNodes||performance.now()-start>timeMs)return{status:'budget'};
  if(!left.length)return{status:active.length?'covered-graph':'counterexample',order:active.length?undefined:[]};
  const edges=active.map(g=>g.edges.filter(e=>left.includes(e.from)&&left.includes(e.to)));
  if(edges.some(e=>!e.length))return{status:'covered-graph'};
  const key=JSON.stringify([left,edges]);if(memo.has(key))return{status:'covered-graph'};
  // An isolated node in EVERY surviving graph imposes no ordering choice.
  const singleton=left.find(n=>edges.length&&edges.every(es=>!es.some(e=>e.from===n||e.to===n)));
  if(singleton){const r=visit(left.filter(n=>n!==singleton),active);return r.order?{...r,order:[singleton,...r.order]}:r;}
  const choices=left.map(n=>({n,plans:active.filter((_,i)=>!edges[i].some(e=>e.to===n))})).sort((a,b)=>a.plans.length-b.plans.length);
  for(const {n,plans} of choices){if(!plans.length)return{status:'counterexample',order:[n,...left.filter(v=>v!==n)]};const r=visit(left.filter(v=>v!==n),plans);if(r.status!=='covered-graph')return r.order?{...r,order:[n,...r.order]}:r;}
  memo.add(key);return{status:'covered-graph'};
 }
 const result=visit(nodes,valid);return{...result,visited,milliseconds:performance.now()-start,physicalVerified:false,information:'NDOP 고정 계획 그래프만 검사; QOP 정책·전체 물리 보증 아님'};
}
