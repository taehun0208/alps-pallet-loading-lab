import { executePlanning } from './planner';
import type { PlannerCommand, PlannerEvent } from './types';
const send=(message:PlannerEvent)=>self.postMessage(message);
self.onmessage=(event:MessageEvent<PlannerCommand>)=>{
  if(event.data.type!=='plan')return;
  const request=event.data.request;
  try { const outcome=executePlanning(request,(candidate,planningMs)=>send({type:'incumbent',id:request.id,candidate,planningMs}));send({type:'result',id:request.id,outcome}); }
  catch(error){send({type:'error',id:request.id,message:error instanceof Error?error.message:String(error)});}
};
send({type:'ready'});
