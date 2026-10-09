import { candidateSet } from './vendor/pallet/candidates';
import { inspectConstraints } from './vendor/pallet/constraints';
import { rng } from './vendor/pallet/scenarios';
import { fingerprint } from './vendor/pallet/benchmark/statistics';
import { top, volume } from './vendor/pallet/geometry';
import type { Candidate, Observation, Placement, PlanningInput } from './types';
import type { DecisionRequest } from './types';
interface State { placed: Placement[]; count: number; vol: number }
interface Node { action: Candidate | null; visits: number; sum: number; countSum: number; volumeSum: number; children: Node[] | null }
const node = (action: Candidate | null): Node => ({ action, visits: 0, sum: 0, countSum: 0, volumeSum: 0, children: null });
/** Logical port of alps-control-room engine/search.js: scenario UCT, expansion, stochastic rollout, backpropagation.
 * Geometry, root generation and hard constraints come exclusively from this app's canonical TS engine.
 * It is a new common-engine adapter, not a claim of bit-identical outputs from the old engine.
 */
export function searchMcts(request: DecisionRequest, rootCandidates: Candidate[], deadline: number, publish: (c: Candidate) => void) {
  const input = request.input, clock = () => performance.now(), roots = rootCandidates.filter(c => c.valid).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0, 6);
  if (!roots.length) return { candidate: null, simulations: 0, completeScenarios: 0, fallback: false };
  const depth = Math.min(request.mcts.depth, Object.values(input.remaining).reduce((s,v) => s+v,0));
  if (!depth) return { candidate: roots[0], simulations: 0, completeScenarios: 0, fallback: false };
  const random = rng(parseInt(fingerprint({ seed: input.settings.plannerSeed, current: input.current.id, remaining: input.remaining }),16));
  const sample = () => {
    const counts = { ...input.remaining }, sequence: Observation[] = [];
    for (let at = 0; at < depth; at++) {
      const total = Object.values(counts).reduce((s,v) => s+v,0); if (!total) break;
      let draw = random()*total;
      const type = input.types.find(t => (draw -= counts[t.id] ?? 0) < 0)!;
      counts[type.id]--;
      sequence.push({ id:`forecast-${at}-${type.id}`, typeId:type.id, size:{...type.size}, weight:type.weight,
        status:'normal', orientationAllowed:[...type.orientations], maxLoadKg:type.maxLoadKg,maxLoadSource:type.maxLoadSource,
        maxLoadByAxis:type.maxLoadByAxis, material:type.material,handling:type.handling,friction:type.friction,strengthFactor:type.strengthFactor });
    }
    return sequence;
  };
  const sequences = Array.from({length:request.mcts.scenarios},sample);
  const forests = sequences.map(() => ({...node(null),children:roots.map(c=>node(c))}));
  let simulations=0;
  const apply = (state:State,c:Candidate|null):State => {
    if (!c) return state;
    const source = c.placement.id === input.current.id ? input.current : sequences.flat().find(o=>o.id===c.placement.id)!;
    return {placed:inspectConstraints(c.placement,source,state.placed,input.pallet,input.constraints).stack,count:state.count+1,vol:state.vol+volume(c.placement.size)};
  };
  const future = (state:State,seq:Observation[],index:number) => {
    const remaining={...input.remaining}; for(let j=0;j<=index;j++) remaining[seq[j].typeId]--;
    const result=candidateSet({...input,current:seq[index],remaining,placements:state.placed,strategyState:undefined,
      settings:{...input.settings,inventoryMode:'none',maxCandidates:Math.min(28,input.settings.maxCandidates)}});
    return result.candidates.filter(c=>c.valid).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,3);
  };
  const rollout=(initial:State,seq:Observation[],index:number):State|null=>{
    let state=initial;
    for(let i=index;i<seq.length;i++){
      if(clock()>=deadline)return null;
      const choices=future(state,seq,i); if(clock()>=deadline)return null;
      if(choices.length)state=apply(state,choices[random()<.15?Math.floor(random()*choices.length):0]);
    }
    return state;
  };
  const choose=()=>{
    const complete=forests.filter(f=>f.children.every(c=>c.visits>0));
    if(!complete.length)return {candidate:null,completeScenarios:0};
    const ranked=roots.map((c,i)=>({c,count:complete.reduce((s,f)=>s+f.children[i].countSum/f.children[i].visits,0)/complete.length,
      vol:complete.reduce((s,f)=>s+f.children[i].volumeSum/f.children[i].visits,0)/complete.length}));
    ranked.sort((a,b)=>b.count-a.count||b.vol-a.vol||b.c.score-a.c.score);
    return {candidate:ranked[0].c,completeScenarios:complete.length};
  };
  while(clock()<deadline&&simulations<request.mcts.maxIterations){
    const warming=forests.findIndex(f=>f.children.some(c=>!c.visits)),si=warming>=0?warming:simulations%sequences.length,seq=sequences[si],tree=forests[si];
    const trail:Node[]=[tree];let current:Node=tree,at=0,state:State={placed:input.placements,count:0,vol:0},complete=false;
    while(clock()<deadline){
      const children=current.children!;
      const child=children.find(c=>!c.visits)??children.reduce((a,b)=>{
        const u=(n:Node)=>n.sum/n.visits+Math.SQRT2*Math.sqrt(Math.log(Math.max(1,current.visits))/n.visits);return u(a)>=u(b)?a:b;
      });
      trail.push(child);state=apply(state,child.action);
      if(at>=seq.length){complete=true;break;}
      if(child.children===null){
        const choices=future(state,seq,at);if(clock()>=deadline)break;
        child.children=[...choices,null].map(node);const expansion=child.children[0];trail.push(expansion);state=apply(state,expansion.action);
        const end=rollout(state,seq,at+1);if(end){state=end;complete=true;}break;
      }
      current=child;at++;
    }
    if(!complete)break;
    const possible=volume(input.current.size)+seq.reduce((s,o)=>s+volume(o.size),0),quality=1/(1+Math.max(0,...state.placed.map(top)));
    // Original port's count-first reward and lexicographic root comparison; not a reported combined quality score.
    const reward=state.count/(depth+1)+.0001*state.vol/Math.max(1,possible)+.000001*quality;
    for(const n of trail){n.visits++;n.sum+=reward;n.countSum+=state.count;n.volumeSum+=state.vol;}
    simulations++;
    if(simulations%roots.length===0){const best=choose();if(best.candidate&&clock()<deadline)publish(best.candidate);}
  }
  const best=choose();return {...best,simulations,fallback:!best.candidate};
}
