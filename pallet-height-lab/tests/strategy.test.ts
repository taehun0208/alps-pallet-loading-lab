import { describe, expect, it, vi } from 'vitest';
import { boardFromRows, cloneBoard, emptyBoard, lock, measure } from '../src/engine/board';
import { boardValue, clearReward, contributions, sum } from '../src/engine/evaluate';
import { search } from '../src/engine/search';
import { strategyMetrics, wellColumn } from '../src/engine/strategy';
import { DEFAULT_WEIGHTS as W, type Analysis, type Strategy } from '../src/engine/types';
import { SCENARIOS } from '../src/engine/scenarios';
import { parseExperiment } from '../src/engine/io';
import { replayEvents } from '../src/engine/narration';
import type { AnalysisRequest, CompareRequest } from '../src/engine/worker';
const greedy={algorithm:'greedy',depth:3,width:10} as const;
const wellConfig={...greedy,strategy:'well-right'} as const;
const readyBoard=boardFromRows(Array(4).fill('#########.'));

describe('player-inspired well strategy',()=>{
  it('distinguishes an open well from holes and counts ready rows',()=>{
    const m=measure(readyBoard),well=strategyMetrics(readyBoard,m,'well-right')!;
    expect(m.holes).toBe(0);expect(well).toMatchObject({column:9,open:true,readyRows:4,reservedHeight:0,stackBumpiness:0});
  });
  it('a covered well has no accessible ready rows',()=>{
    const b=cloneBoard(readyBoard);b[15][9]=8;const m=measure(b),well=strategyMetrics(b,m,'well-right')!;
    expect(m.holes).toBe(4);expect(well).toMatchObject({open:false,reservedHeight:5,readyRows:0});
    expect(contributions(m,W,well).well).toBeLessThan(0);
  });
  it('ready rows stop at the first incomplete row, rather than counting distant rows',()=>{
    const b=cloneBoard(readyBoard);b[17][0]=0;
    expect(strategyMetrics(b,measure(b),'well-right')!.readyRows).toBe(2);
  });
  it('supports mirrored and middle well positions without changing collisions',()=>{
    expect(wellColumn()).toBeNull();expect(wellColumn('well-left')).toBe(0);expect(wellColumn('well-63')).toBe(6);
    for(const [strategy,column] of [['well-left',0],['well-63',6]] as const){
      const b=boardFromRows(Array(4).fill('#'.repeat(column)+'.'+'#'.repeat(9-column)));
      expect(strategyMetrics(b,measure(b),strategy)).toMatchObject({open:true,readyRows:4});
      const a=search(b,'I',[],W,{...greedy,strategy});expect(a.candidates[0].metrics.lines).toBe(4);expect(a.candidates[0].action.x).toBe(column);
    }
  });
  it('refunds only the intentional well edge and retains ordinary roughness',()=>{
    const m=measure(readyBoard),well=strategyMetrics(readyBoard,m,'well-right')!,c=contributions(m,W,well);
    expect(c.bumpiness).toBe(-2.8);expect(c.well).toBeCloseTo(2.8+72);
    expect(c.bumpiness+c.well!).toBeCloseTo(72);
  });
  it('caps readiness reward at four so a taller well does not farm unlimited reward',()=>{
    const b=boardFromRows(Array(8).fill('#########.')),m=measure(b),well=strategyMetrics(b,m,'well-right')!,c=contributions(m,W,well);
    expect(well.readyRows).toBe(8);expect(c.well!-m.bumpiness*W.bumpiness).toBe(72);
    expect(boardValue(m,W,well)).toBeLessThan(boardValue(measure(readyBoard),W,strategyMetrics(readyBoard,measure(readyBoard),'well-right')));
  });
  it('rewards a four-line clear more than four singles while preserving balanced scoring',()=>{
    const m=measure(emptyBoard(),4),well=strategyMetrics(emptyBoard(),m,'well-right')!,quad=contributions(m,W,well);
    const singleM=measure(emptyBoard(),1),single=contributions(singleM,W,strategyMetrics(emptyBoard(),singleM,'well-right'));
    expect(clearReward(quad)).toBe(80);expect(clearReward(single)*4).toBe(40);
    expect(contributions(m,W)).toEqual({lines:40,height:-0,holes:-0,bumpiness:-0});
  });
  it('changes the real S placement to preserve the reserved column',()=>{
    const s=SCENARIOS.find(s=>s.id==='well-build')!,a=search(s.board,s.current,s.next,W,greedy),b=search(s.board,s.current,s.next,W,wellConfig);
    expect(a.selectedId).toBe('1:8');expect(b.selectedId).toBe('0:5');
    expect(a.candidates[0].metrics.heights[9]).toBe(2);expect(b.candidates[0].strategy?.open).toBe(true);
    expect(a.candidates[0].metrics.holes).toBe(0);expect(b.candidates[0].metrics.holes).toBe(0);
  });
  it('can keep a low three-row setup instead of spending it on a premature small clear',()=>{
    const board=boardFromRows(Array(3).fill('#########.'));
    const balanced=search(board,'I',[],W,greedy),well=search(board,'I',[],W,wellConfig);
    expect(balanced.candidates[0].metrics.lines).toBe(3);
    expect(well.candidates[0].metrics.lines).toBe(0);expect(well.candidates[0].strategy?.readyRows).toBe(3);
    expect(well.candidates[0].strategy?.open).toBe(true);expect(well.candidates.some(c=>c.metrics.lines===3)).toBe(true);
  });
  it('actually builds four ready rows with O and clears them with NEXT I',()=>{
    const s=SCENARIOS.find(s=>s.id==='well-cashout')!,a=search(s.board,s.current,s.next,W,s.config),c=a.candidates[0];
    expect(c.action).toMatchObject({piece:'O',x:0});expect(c.strategy?.readyRows).toBe(4);
    expect(c.path).toHaveLength(2);expect(c.path[1]).toMatchObject({piece:'I',rotation:1,x:9});
    const next=lock(c.board,c.path[1])!;expect(next.clearedRows).toHaveLength(4);expect(measure(next.board).height).toBe(0);
    expect(c.pathContributions).toMatchObject({lines:40,tetris:40});expect(c.pathScore).toBe(80);expect(sum(c.pathContributions!)).toBe(80);
  });
  it('path scores accumulate clear bonuses, but apply board features only at the end',()=>{
    const s=SCENARIOS.find(s=>s.id==='well-cashout')!,a=search(s.board,s.current,s.next,W,{...s.config,algorithm:'beam',depth:3,width:10});
    for(const c of a.candidates.filter(c=>c.pathScore!==null)){
      let board=s.board,reward=0;
      for(const action of c.path){const r=lock(board,action)!;board=r.board;const m=measure(board,r.clearedRows.length);reward+=clearReward(contributions(m,W,strategyMetrics(board,m,'well-right')));}
      const m=measure(board);expect(c.pathScore).toBeCloseTo(reward+boardValue(m,W,strategyMetrics(board,m,'well-right')));expect(sum(c.pathContributions!)).toBeCloseTo(c.pathScore!);
    }
  });
  it('takes a three-line escape and lowers a dangerous stack',()=>{
    const s=SCENARIOS.find(s=>s.id==='well-danger')!,before=measure(s.board),a=search(s.board,s.current,s.next,W,s.config),c=a.candidates[0];
    expect(before.maxHeight).toBe(16);expect(contributions(before,W,strategyMetrics(s.board,before,'well-right')).danger).toBe(-192);
    expect(c.action).toMatchObject({rotation:3,x:8});expect(c.metrics).toMatchObject({lines:3,maxHeight:13});expect(c.contributions.danger).toBe(-12);
    expect(c.contributions.tetris).toBe(0);expect(sum(c.contributions)).toBeCloseTo(c.immediate);
  });
  it('still respects public-piece boundaries and deterministic ranking',()=>{
    const s=SCENARIOS.find(s=>s.id==='well-build')!;
    for(const strategy of ['well-right','well-left','well-63'] as Strategy[]){
      const a=search(s.board,s.current,['I'],W,{...greedy,strategy}),b=search(s.board,s.current,['Z'],W,{...greedy,strategy});
      expect(a.path).toEqual(b.path);
      const c=search(s.board,s.current,s.next,W,{...greedy,algorithm:'beam',strategy});
      const d=search(s.board,s.current,s.next,W,{...greedy,algorithm:'beam',strategy});expect({...c,elapsedMs:0}).toEqual({...d,elapsedMs:0});
    }
  });
  it('preserves and validates strategy in JSON, including old balanced experiments',()=>{
    const s=SCENARIOS.find(s=>s.id==='well-build')!,data={version:1,board:s.board,seed:42,current:s.current,next:s.next,weights:W,config:s.config};
    expect(parseExperiment(JSON.stringify(data)).config.strategy).toBe('well-right');
    expect(()=>parseExperiment(JSON.stringify({...data,config:{...s.config,strategy:'unknown'}}))).toThrow('플레이 전략');
    expect(parseExperiment(JSON.stringify({...data,config:greedy})).config.strategy).toBeUndefined();
  });
  it('strategy narration and replay contain actual scores',()=>{
    const s=SCENARIOS.find(s=>s.id==='well-build')!,a=search(s.board,s.current,s.next,W,s.config),e=replayEvents(s.board,s.current,a,s.config,W,s.id);
    expect(e[3].text).toContain(a.candidates[0].contributions.well!.toFixed(1));expect(e[3].candidateId).toBe(a.selectedId);expect(Object.isFrozen(e)).toBe(true);
  });
  it('worker applies the same strategy to all three algorithms and returns a real baseline',async()=>{
    const messages:{result:Analysis|Analysis[];baseline?:Analysis}[]=[],surface={onmessage:null as null|((e:{data:AnalysisRequest|CompareRequest})=>void),postMessage:(m:{result:Analysis|Analysis[];baseline?:Analysis})=>messages.push(m)};
    vi.stubGlobal('self',surface);
    try{
      await import('../src/engine/worker');const s=SCENARIOS.find(s=>s.id==='well-build')!;
      surface.onmessage!({data:{id:1,type:'analysis',board:s.board,current:s.current,next:s.next,weights:W,config:s.config}});
      expect((messages[0].result as Analysis).selectedId).toBe('0:5');expect(messages[0].baseline?.selectedId).toBe('1:8');
      surface.onmessage!({data:{id:2,type:'compare',boards:[s.board,s.board,s.board],current:s.current,next:s.next,weights:W,beam:{...s.config,algorithm:'beam'}}});
      const results=messages[1].result as Analysis[];expect(results[0].selectedId).toBe('0:5');
      for(const [i,result] of results.entries()){const config={...s.config,algorithm:i===0?'greedy' as const:i===1?'two' as const:'beam' as const};expect(result.path).toEqual(search(s.board,s.current,s.next,W,config).path);expect(result.candidates[0].strategy).not.toBeNull();}
    }finally{vi.unstubAllGlobals();}
  });
});
