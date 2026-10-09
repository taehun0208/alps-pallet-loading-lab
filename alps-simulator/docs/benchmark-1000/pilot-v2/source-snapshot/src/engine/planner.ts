import { capacityAlgorithm } from './vendor/pallet/capacity/experiment';
import { validateCandidate } from './validation';
import { searchMcts } from './mcts';
import { searchFloorDense } from './floorDense';
import { searchCluster } from './clusterPacking';
import type { Candidate, DecisionOutcome, DecisionRequest } from './types';
/** CPU-only planner. Production execution requires the external supervisor watchdog. */
export function executePlanning(request: DecisionRequest, onIncumbent: (candidate: Candidate, planningMs: number) => void = () => {}): DecisionOutcome {
  const started=performance.now(), deadline=started+Math.min(request.availableMs,request.searchBudgetMs);
  let incumbent:Candidate|null=null;
  const publish=(candidate:Candidate)=>{
    if(performance.now()>=deadline)return;
    const checked=validateCandidate(request.input,candidate);
    if(!checked.reasons.length&&performance.now()<deadline){incumbent={...candidate,placement:checked.placement,path:checked.path};onIncumbent(incumbent,performance.now()-started);}
  };
  const base=capacityAlgorithm('blb').plan(structuredClone(request.input));
  const basic=base.candidates.find(c=>c.id===base.selectedId&&c.valid);if(basic)publish(basic);
  let fallback=false, fallbackReason:DecisionOutcome['fallbackReason']='none', strategyState:DecisionOutcome['strategyState'], simulations=0,completeScenarios=0;
  let searchDiagnostics:DecisionOutcome['searchDiagnostics'];
  if(performance.now()<deadline){
    if(['cluster-floor','cluster-layer','dispersed'].includes(request.algorithm)){
      const result=searchCluster(request,base.candidates,deadline,publish);searchDiagnostics=result.diagnostics;
      if(result.candidate)publish(result.candidate);
    }else if(request.algorithm==='floor-dense'){
      const result=searchFloorDense(request,base.candidates,deadline,publish);searchDiagnostics=result.diagnostics;simulations=result.simulations;completeScenarios=result.completeScenarios;
      if(result.candidate)publish(result.candidate);
    }else if(request.algorithm==='mcts'){
      const result=searchMcts(request,base.candidates,deadline,publish);simulations=result.simulations;completeScenarios=result.completeScenarios;
      if(result.candidate)publish(result.candidate);
      fallback=result.fallback;fallbackReason=fallback?'insufficient_scenarios':'none';
    }else if(request.algorithm!=='blb'){
      const result=capacityAlgorithm(request.algorithm).plan(structuredClone(request.input));
      const candidate=result.candidates.find(c=>c.id===result.selectedId&&c.valid);
      if(performance.now()<deadline){if(candidate){publish(candidate);strategyState=result.strategyState;}else if(incumbent){fallback=true;fallbackReason='no_valid_candidate';}}
    }
  }
  const elapsed=performance.now()-started;
  if(elapsed>=request.searchBudgetMs){fallback=true;fallbackReason=request.searchBudgetMs<request.availableMs?'search_budget':'watchdog';}
  if(!incumbent&&!fallback)fallbackReason='no_valid_candidate';
  return {candidate:incumbent,strategyState,planningMs:elapsed,elapsedMs:elapsed,fallback,fallbackReason,validDeadline:elapsed<=request.availableMs,watchdog:false,simulations,completeScenarios,searchDiagnostics,
    message:'Finite candidate search; synthetic remaining-count forecasts only. No global optimum or physical cycle guarantee.'};
}
