import {Session,metrics} from './runtime';
import {makeBoxes} from './shape';
import type {Box,Config,Mode} from './types';
let session:Session|null=null,playing=false,generation=0;
const send=(type:string,data:unknown)=>postMessage({type,data});
function advance(token:number){if(!playing||!session||token!==generation)return;try{const f=session.step();send('frame',f);if(f.done){playing=false;return;}setTimeout(()=>advance(token),80);}catch(e){playing=false;send('error',String(e));}}
onmessage=e=>{const m=e.data as {type:string;config:Config;boxes?:Box[];seeds?:number[]};
 try{
 if(m.type==='init'){generation++;playing=false;session=new Session(m.config,m.boxes);send('frame',session.frame);}
 if(m.type==='pause'){playing=false;generation++;}
 if(m.type==='play'){if(!session)session=new Session(m.config,m.boxes);if(!playing){playing=true;advance(++generation);}}
 if(m.type==='step'){playing=false;generation++;if(!session)session=new Session(m.config,m.boxes);send('frame',session.step());}
 if(m.type==='compare'){
  generation++;playing=false;const token=generation,rows:unknown[]=[],seeds=m.seeds||[m.config.seed,m.config.seed+1,m.config.seed+2],jobs=seeds.flatMap(seed=>(['A','B','C'] as Mode[]).map(mode=>({seed,mode})));let at=0;
  const next=()=>{if(token!==generation)return;const job=jobs[at++];if(!job){send('comparison',rows);return;}const c={...m.config,...job},boxes=m.boxes||makeBoxes(c),run=new Session(c,boxes);
   const tick=()=>{if(token!==generation)return;try{run.step();send('progress',{job:at,total:jobs.length,tick:run.frame.tick,mode:job.mode,seed:job.seed});if(!run.frame.done){setTimeout(tick,0);return;}rows.push({config:c,boxes,metrics:metrics(run.frame,boxes,c),frame:run.frame});setTimeout(next,0);}catch(e){send('error',String(e));}};
   tick();
  };next();
 }
 }catch(e){send('error',String(e));}
};
