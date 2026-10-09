import {SPEC,EPS,top,volume,coordinates,geometryOK,supportOf,pathFor,pickup,ik,rng,clamp} from './core.js';
import {physicalCheck,placementQuality,categoryTarget,storeReport} from './constraints.js';

export const ALGORITHMS={greedy:'Greedy · 현재 배치',beam:'Beam · 다단계 예측',mcts:'MCTS · 확률 탐색'};
const now=()=>performance.now();
const signature=b=>`${b.p}/${b.sku}/${b.w}/${b.d}/${b.h}/${b.kg}/${b.topKg}`;
function hash(s){let h=2166136261;for(const ch of s)h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;}
export function eligible(b,c){
  const p=c.pallets[b.p],limit=Math.min(SPEC.suction,SPEC.payload-c.toolMass);
  if(b.kg>limit)return '취급 한도 초과';
  if(!((b.w>=.23&&b.d>=.17)||(b.d>=.23&&b.w>=.17)))return '흡착면 크기 부족';
  if(b.h>p.h+EPS||!((b.w<=p.w+EPS&&b.d<=p.d+EPS)||(b.d<=p.w+EPS&&b.w<=p.d+EPS)))return '팔레트 규격 초과';
  if(!ik(pickup(b)))return '입고 위치 도달 불가';return null;
}
export function evaluatePlacement(b,c,placed,remaining=[]) {
  const p=c.pallets[b.p],local=placed.filter(q=>q.p===b.p);
  const invalid=eligible(b,c);if(invalid)return {ok:false,reason:invalid};
  if(local.reduce((s,q)=>s+q.kg,0)+b.kg>p.maxKg+EPS)return {ok:false,reason:'팔레트 총중량 초과'};
  if(!geometryOK(b,local,p,c))return {ok:false,reason:'공간·지지 조건'};
  const check=physicalCheck([...local,b],p,c);if(!check.ok)return check;
  const path=pathFor(b,p,placed,c);if(!path.ok)return path;
  return {ok:true,box:b,...placementQuality(b,local,p,c,remaining,check,path),support:supportOf(b,local).ratio,loadRatio:check.loads.maxRatio,loads:check.loads,transport:check.transport,storeReport:check.store,path,future:0};
}

// All online methods share this bounded candidate generator and every filter.
export function candidates(box,c,placed,remaining=[],options={}) {
  const {deadline=Infinity,limit=12,scan=96}=options,p=c.pallets[box.p],local=placed.filter(b=>b.p===box.p);
  const invalid=eligible(box,c);if(invalid)return {items:[],reason:invalid,examined:0,rejects:{[invalid]:1},cut:false};
  if(local.reduce((s,b)=>s+b.kg,0)+box.kg>p.maxKg+EPS)return {items:[],reason:'팔레트 총중량 초과',examined:0,rejects:{},cut:false};
  const raw=[],rejects={},unique=new Set();let examined=0,cut=false;
  outer:for(const turn of [false,true]){
    const w=turn?box.d:box.w,d=turn?box.w:box.d;if(w<.23||d<.17)continue;
    const cs=coordinates(local,p,w,d),target=categoryTarget(box.zone,p,[...local,box],remaining);
    cs.xs.push(clamp(target-w/2,0,p.w-w));
    for(const y of cs.ys)for(const x of cs.xs)for(const z of cs.zs){
      if((examined++%32===0)&&now()>=deadline){cut=true;break outer;}
      const key=[x,y,z,w,d].map(v=>Math.round(v*100000)).join('/');if(unique.has(key))continue;unique.add(key);
      const b={...box,x,y,z,w,d,sourceW:box.w,sourceD:box.d,turn,yaw:turn?Math.PI/2:0};
      if(!geometryOK(b,local,p,c))continue;
      const h=Math.max(top(b),...local.map(top)),density=(volume(b)+local.reduce((s,q)=>s+volume(q),0))/(p.w*p.d*h);
      const near=local.filter(q=>q.sku===b.sku).reduce((v,q)=>Math.min(v,Math.hypot(q.x-x,q.z-z,q.y-y)),2);
      const store=1-Math.abs(x+w/2-target)/p.w;
      const sw=c.policy==='store'?.55:c.policy==='density'?0:c.storeWeight/100;
      raw.push({b,rank:(1-sw)*density+sw*(.75*store+.25/(1+near))-y*.012});
    }
  }
  raw.sort((a,b)=>b.rank-a.rank);
  // Interleave height/spatial bins so a top-ranked inaccessible cluster does not
  // consume every path check. This remains a heuristic, not exhaustive search.
  const bins=new Map();for(const r of raw){const k=`${Math.round(r.b.y*1000)}/${Math.floor(r.b.x/.25)}/${Math.floor(r.b.z/.25)}`;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(r);}
  const ordered=[];while(ordered.length<scan&&[...bins.values()].some(a=>a.length)){for(const a of bins.values())if(a.length)ordered.push(a.shift());}
  const out=[];
  for(const {b} of ordered.slice(0,scan)){
    if(now()>=deadline){cut=true;break;}const r=evaluatePlacement(b,c,placed,remaining);
    if(r.ok)out.push(r);else rejects[r.reason]=(rejects[r.reason]||0)+1;
  }
  out.sort((a,b)=>b.score-a.score);
  return {items:out.slice(0,limit),examined,rejects,cut:cut||raw.length>scan,reason:Object.entries(rejects).sort((a,b)=>b[1]-a[1])[0]?.[0]||'유한 후보에서 배치를 찾지 못함'};
}

function sampleBag(remaining,random) {
  const bag=remaining.map((r,i)=>({...r,sku:r.sku??r.id,bagKey:i})),sequence=[];
  while(bag.some(r=>r.count>0)){let n=random()*bag.reduce((s,r)=>s+r.count,0);const r=bag.find(r=>(n-=r.count)<0);r.count--;sequence.push({...r,id:`forecast-${r.bagKey}-${r.count}`,count:undefined});}
  return sequence;
}
function quality(placed,c) {
  let rehandles=0,fragments=0,height=0;
  for(const p of c.pallets){const bs=placed.filter(b=>b.p===p.id),s=storeReport(bs,p);rehandles+=s.rehandles;fragments+=s.fragments;height+=Math.max(0,...bs.map(top));}
  return c.policy==='density'?1/(1+height):1/(1+rehandles+fragments+height);
}
function compareStates(a,b){return b.count-a.count||b.vol-a.vol||b.q-a.q;}
function rollout(state,seq,index,c,deadline,random) {
  let {placed,count,vol}=state;
  for(let i=index;i<seq.length;i++){
    if(now()>=deadline)return null;
    const out=candidates(seq[i],c,placed,[],{deadline,limit:3,scan:24});
    if(now()>=deadline)return null;
    if(out.items.length){const k=random()<.15?Math.floor(random()*out.items.length):0;const r=out.items[k];placed=[...placed,r.box];count++;vol+=volume(r.box);}
  }
  return {placed,count,vol,q:quality(placed,c)};
}

function beamSearch(roots,input,deadline,random) {
  const {c,placed,remaining}=input,depth=Math.min(c.lookaheadDepth,remaining.reduce((s,r)=>s+r.count,0));
  const seq=sampleBag(remaining,random).slice(0,depth),width=c.beamWidth;
  let beam=roots.map((r,i)=>({placed:[...placed,r.box],count:1,vol:volume(r.box),q:r.score/100,root:i}));
  let completed=0,nodes=0,last=beam;
  for(let d=0;d<seq.length;d++){
    const next=[];let interrupted=false;
    for(const state of beam){
      if(now()>=deadline){interrupted=true;break;}
      const out=candidates(seq[d],c,state.placed,[],{deadline,limit:3,scan:32});nodes+=out.examined;
      if(now()>=deadline){interrupted=true;break;}
      // A future box may be deferred, even when a feasible placement exists.
      next.push({...state,q:quality(state.placed,c)});
      for(const r of out.items)next.push({...state,placed:[...state.placed,r.box],count:state.count+1,vol:state.vol+volume(r.box),q:quality([...state.placed,r.box],c)});
    }
    if(interrupted)break;
    next.sort(compareStates);beam=next.slice(0,width);last=beam;completed=d+1;
  }
  if(!completed)return {index:0,meta:{depth:0,nodes,simulations:0,fallback:true}};
  last.sort(compareStates);return {index:last[0].root,meta:{depth:completed,nodes,simulations:1,predictedCount:last[0].count,horizon:completed+1,fallback:false}};
}

// Scenario trees use UCT selection, one-node expansion, rollout and backprop.
// A scenario is a sampled order WITHOUT replacement from known remaining counts.
// Actual future arrivals are never passed to this module.
function mctsSearch(roots,input,deadline,random) {
  const {c,placed,remaining}=input,depth=Math.min(c.lookaheadDepth,remaining.reduce((s,r)=>s+r.count,0));
  const scenarios=Array.from({length:3},()=>sampleBag(remaining,random).slice(0,depth));
  const forests=scenarios.map(()=>({visits:0,children:roots.map((r,i)=>({action:r,root:i,visits:0,sum:0,countSum:0,volumeSum:0,children:null}))}));
  let simulations=0,nodes=0;
  while(now()<deadline&&simulations<384){
    const warming=forests.findIndex(f=>f.children.some(q=>q.visits===0));
    const si=warming>=0?warming:simulations%scenarios.length,seq=scenarios[si],tree=forests[si];
    const trail=[tree];let node=tree,at=0,state={placed,count:0,vol:0},completed=false;
    while(true){
      if(now()>=deadline)break;
      const child=node.children.find(q=>q.visits===0)||node.children.reduce((a,b)=>{
        const u=q=>q.sum/q.visits+Math.SQRT2*Math.sqrt(Math.log(Math.max(1,node.visits))/q.visits);return u(a)>=u(b)?a:b;});
      trail.push(child);
      if(child.action){state={placed:[...state.placed,child.action.box],count:state.count+1,vol:state.vol+volume(child.action.box)};}
      if(at>=seq.length){state.q=quality(state.placed,c);completed=true;break;}
      if(child.children===null){
        const out=candidates(seq[at],c,state.placed,[],{deadline,limit:3,scan:28});nodes+=out.examined;
        if(now()>=deadline)break;
        child.children=[...out.items,null].map(action=>({action,visits:0,sum:0,countSum:0,volumeSum:0,children:null}));
        const expansion=child.children[0];trail.push(expansion);
        if(expansion.action)state={placed:[...state.placed,expansion.action.box],count:state.count+1,vol:state.vol+volume(expansion.action.box)};
        const end=rollout(state,seq,at+1,c,deadline,random);if(end){state=end;completed=true;}break;
      }
      node=child;at++;
    }
    if(!completed)break;
    const possibleVolume=volume(input.box)+seq.reduce((s,b)=>s+volume(b),0);
    const reward=state.count/(depth+1)+.0001*state.vol/Math.max(EPS,possibleVolume)+.000001*(state.q??0);
    for(const q of trail){q.visits++;q.sum=(q.sum||0)+reward;q.countSum=(q.countSum||0)+state.count;q.volumeSum=(q.volumeSum||0)+state.vol;}
    simulations++;
  }
  // Compare only equally represented scenarios; an unvisited scenario is not a
  // zero-success outcome. Fall back rather than overclaim incomplete evidence.
  const completeForests=forests.filter(f=>f.children.every(q=>q.visits>0));
  if(!completeForests.length)return {index:0,meta:{depth,nodes,simulations,fallback:true}};
  const evaluated=roots.map((r,i)=>({i,n:completeForests.reduce((s,f)=>s+f.children[i].visits,0),count:completeForests.reduce((s,f)=>s+f.children[i].countSum/f.children[i].visits,0)/completeForests.length,vol:completeForests.reduce((s,f)=>s+f.children[i].volumeSum/f.children[i].visits,0)/completeForests.length}));
  evaluated.sort((a,b)=>b.count-a.count||b.vol-a.vol||roots[b.i].score-roots[a.i].score);
  return {index:evaluated[0].i,meta:{depth,nodes,simulations,scenarios:completeForests.length,predictedCount:evaluated[0].count,horizon:depth+1,fallback:false}};
}

export function plan(input) {
  const started=now(),{c,box,placed,remaining}=input,deadline=started+c.budgetMs;
  const algorithm=c.algorithm||'mcts';
  const initial=candidates(box,c,placed,remaining,{deadline:algorithm==='greedy'?deadline:started+c.budgetMs*.32,limit:algorithm==='greedy'?12:6,scan:120});
  const roots=initial.items;
  if(!roots.length)return {ok:false,reason:initial.reason,ms:now()-started,examined:initial.examined,rejects:initial.rejects,candidates:[],timedOut:now()>=deadline,search:{algorithm,proof:false,limited:true}};
  const random=rng(hash(`${c.planningSeed??91473}/${box.id}/${remaining.map(r=>signature(r)+r.count).join('|')}`));
  const choice=algorithm==='mcts'?mctsSearch(roots,input,deadline,random):algorithm==='beam'?beamSearch(roots,input,deadline,random):{index:0,meta:{depth:0,nodes:0,simulations:0,fallback:false}};
  const best=roots[choice.index],meta=choice.meta;
  best.future=meta.horizon?meta.predictedCount/meta.horizon:0;
  return {ok:true,best,candidates:[best,...roots.filter(r=>r!==best)].slice(0,5),ms:now()-started,examined:initial.examined+meta.nodes,rejects:initial.rejects,timedOut:now()>=deadline,search:{algorithm,...meta,proof:false,limited:true}};
}

// Safe but deliberately loose upper bound: ignore geometry, support, transport,
// store and path restrictions. Count is bounded by BOTH volume and mass per store.
export function capacityBound(boxes,c,placed=[]) {
  let count=placed.length,vol=placed.reduce((s,b)=>s+volume(b),0);const pallets=[];
  for(const p of c.pallets){const fixed=placed.filter(b=>b.p===p.id),eligibleBoxes=boxes.filter(b=>b.p===p.id&&!eligible(b,c));
    const freeV=Math.max(0,p.w*p.d*p.h-fixed.reduce((s,b)=>s+volume(b),0)),freeK=Math.max(0,p.maxKg-fixed.reduce((s,b)=>s+b.kg,0));
    function fits(values,max){let sum=0,n=0;for(const value of values.sort((a,b)=>a-b)){if(sum+value>max+EPS)break;sum+=value;n++;}return n;}
    const upper=Math.min(fits(eligibleBoxes.map(volume),freeV),fits(eligibleBoxes.map(b=>b.kg),freeK));
    const upperVolume=Math.min(freeV,eligibleBoxes.map(volume).sort((a,b)=>b-a).slice(0,upper).reduce((a,b)=>a+b,0));
    count+=upper;vol+=upperVolume;pallets.push({p:p.id,upperCount:fixed.length+upper,upperVolume:fixed.reduce((s,b)=>s+volume(b),0)+upperVolume});
  }
  return {count,volume:vol,pallets,kind:'품목·부피·중량 완화 상한',notPlacement:true};
}

export function certificate(boxes,c,placed) {
  const upper=capacityBound(boxes,c),lower=placed.length,gap=Math.max(0,upper.count-lower);
  return {lower,upper:upper.count,gap,relativeGap:upper.count?gap/upper.count:0,countOptimal:lower===upper.count,scope:'주어진 주문·두 팔레트·현재 근사 모델의 적재 개수',volumeOptimal:false,transportCertified:false};
}
