import {Session,metrics} from './runtime';
import {makeBoxes} from './shape';
import {orderingJobs} from './orderingExperiments';
import {captureRecord,type TraceRecord} from './performance';
import type {Box,Config,Mode} from './types';
let session:Session|null=null,playing=false,generation=0;
let history:TraceRecord[]=[];
function emitFrame(){if(!session)return;const record=captureRecord(session.frame,history.at(-1),session.config,session.boxes.length);history.push(record);send('frame',{frame:session.frame,record});}
const send=(type:string,data:unknown)=>postMessage({type,data});
function advance(token:number){if(!playing||!session||token!==generation)return;try{const f=session.step();emitFrame();if(f.done){playing=false;return;}setTimeout(()=>advance(token),80);}catch(e){playing=false;send('error',String(e));}}
onmessage=e=>{const m=e.data as {type:string;config:Config;boxes?:Box[];seeds?:number[]};
 try{
 if(m.type==='init'){generation++;playing=false;session=new Session(m.config,m.boxes);history=[];emitFrame();}
 if(m.type==='pause'){playing=false;generation++;}
 if(m.type==='play'){if(!session)session=new Session(m.config,m.boxes);if(!playing){playing=true;advance(++generation);}}
 if(m.type==='step'){playing=false;generation++;if(!session)session=new Session(m.config,m.boxes);session.step();emitFrame();}
 if(m.type==='compare'||m.type==='orderingCompare'){
  generation++;playing=false;const token=generation,rows:unknown[]=[],seeds=m.seeds||[m.config.seed,m.config.seed+1,m.config.seed+2],jobs=m.type==='orderingCompare'?orderingJobs(m.config).map(j=>({...j,seed:j.config.seed,mode:j.config.mode})):seeds.flatMap(seed=>(['A','B','C'] as Mode[]).map(mode=>({seed,mode,label:mode,config:{...m.config,seed,mode}})));let at=0;
  const next=()=>{if(token!==generation)return;const job=jobs[at++];if(!job){send(m.type==='orderingCompare'?'orderingComparison':'comparison',rows);return;}const c=job.config,boxes=m.boxes||makeBoxes(c),run=new Session(c,boxes),records:TraceRecord[]=[captureRecord(run.frame,undefined,c,boxes.length)];
   const tick=()=>{if(token!==generation)return;try{run.step();records.push(captureRecord(run.frame,records.at(-1),c,boxes.length));send('progress',{job:at,total:jobs.length,tick:run.frame.tick,mode:job.label,seed:job.seed});if(!run.frame.done){setTimeout(tick,0);return;}rows.push({label:job.label,config:c,boxes,metrics:metrics(run.frame,boxes,c),frame:run.frame,history:records});setTimeout(next,0);}catch(e){send('error',String(e));}};
   tick();
  };next();
 }
 }catch(e){send('error',String(e));}
};
