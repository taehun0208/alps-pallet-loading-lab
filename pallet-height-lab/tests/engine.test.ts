import { describe, expect, it } from 'vitest';
import { boardFromRows, clearLines, cloneBoard, collides, emptyBoard, landings, lock, measure, rotations } from '../src/engine/board';
import { contributions, sum, boardValue } from '../src/engine/evaluate';
import { explainChoice, replayEvents } from '../src/engine/narration';
import { parseExperiment } from '../src/engine/io';
import { actionOrder, generate, rank, search } from '../src/engine/search';
import { supply } from '../src/engine/supply';
import { DEFAULT_WEIGHTS as W, PIECES, type Action, type Piece } from '../src/engine/types';
import { SCENARIOS } from '../src/engine/scenarios';
const greedy={algorithm:'greedy',depth:1,width:10} as const;
const two={algorithm:'two',depth:2,width:10} as const;
describe('board mechanics and features',()=>{
  it('empty features are zero',()=>{expect(measure(emptyBoard())).toMatchObject({height:0,holes:0,bumpiness:0,maxHeight:0});});
  it('counts height sum, closed holes and open wells by hand',()=>{const b=boardFromRows(['#.........','..#.......','#.#.......']);expect(measure(b)).toMatchObject({heights:[3,0,2,0,0,0,0,0,0,0],height:5,holes:1,bumpiness:7,holeCells:[{x:0,y:18}]});});
  it('deduplicates occupied rotations',()=>{expect(PIECES.map(p=>rotations(p).length)).toEqual([2,4,4,1,2,4,2]);rotations('T').forEach(r=>{expect(r).toHaveLength(4);expect(Math.min(...r.map(c=>c.x))).toBe(0);expect(Math.min(...r.map(c=>c.y))).toBe(0);});});
  it('has 34 valid T landings on empty board',()=>{expect(landings(emptyBoard(),'T').actions).toHaveLength(34);});
  it('respects walls, floor and existing cells',()=>{const b=emptyBoard(),cells=rotations('O')[0];expect(collides(b,cells,-1,0)).toBe(true);expect(collides(b,cells,9,0)).toBe(true);expect(collides(b,cells,0,19)).toBe(true);b[18][0]=8;expect(collides(b,cells,0,17)).toBe(true);});
  it('does not teleport into sealed holes',()=>{const b=boardFromRows(['####......','#..#......','####......']);for(const action of landings(b,'O').actions){expect(action.cells.map(c=>({x:c.x+action.x,y:c.y+action.y}))).not.toContainEqual({x:1,y:18});let y=-2;while(!collides(b,action.cells,action.x,y+1))y++;expect(action.y).toBe(y);}});
  it('rejects top-out before clearing full rows',()=>{const b=emptyBoard();b[0]=Array(10).fill(8);expect(landings(b,'O').actions).toHaveLength(0);expect(landings(b,'O').failures).toBe(9);const a:Action={piece:'I',rotation:1,x:0,y:-1,cells:rotations('I')[1]};expect(lock(b,a)).toBeNull();expect(search(b,'T',['I'],W,greedy).reason).toBe('gameover');});
  for(const n of [1,2,3,4])it(`clears ${n} rows simultaneously without mutating`,()=>{const b=emptyBoard();b[19-n][0]=2;for(let y=20-n;y<20;y++)b[y]=Array(10).fill(8);const before=cloneBoard(b),result=clearLines(b);expect(result.rows).toHaveLength(n);expect(result.board[19][0]).toBe(2);expect(result.board.slice(0,n)).toEqual(Array.from({length:n},()=>Array(10).fill(0)));expect(b).toEqual(before);});
  it('keeps before/after clear snapshots and does not mutate input',()=>{const s=SCENARIOS[3],b=cloneBoard(s.board),before=JSON.stringify(b);const result=generate(b,'I',W).candidates.find(c=>c.action.rotation===1&&c.action.x===9)!;expect(result.clearedRows).toHaveLength(4);expect(result.beforeClear.slice(-4).every(row=>row.every(Boolean))).toBe(true);expect(result.metrics.height).toBe(0);expect(result.metrics.lines).toBe(4);expect(JSON.stringify(b)).toBe(before);});
});
describe('seeded public supply',()=>{
  it('reproduces the same sequence and each seven is a bag',()=>{const a=supply(42,210);expect(a).toEqual(supply(42,210));expect(a).not.toEqual(supply(43,210));for(let i=0;i<210;i+=7)expect([...a.slice(i,i+7)].sort()).toEqual([...PIECES].sort());});
  it('greedy never reads future, 2 ply only reads next[0], beam respects public depth',()=>{const b=SCENARIOS[1].board;const a=search(b,'T',['J','I','O','S'],W,two),c=search(b,'T',['J','Z','Z','Z'],W,two);expect(a.selectedId).toBe(c.selectedId);expect(a.path).toEqual(c.path);expect(search(b,'T',[],W,{algorithm:'beam',depth:5,width:10}).completedDepth).toBe(1);expect(search(b,'T',['I'],W,greedy).path).toEqual(search(b,'T',['Z'],W,greedy).path);});
});
describe('objective and search',()=>{
  it('sums exactly the displayed contributions',()=>{for(const c of generate(SCENARIOS[1].board,'T',W).candidates){expect(sum(c.contributions)).toBe(c.immediate);expect(contributions(c.metrics,W)).toEqual(c.contributions);}});
  it('uses a consistent deterministic tie breaker',()=>{const a=search(emptyBoard(),'O',[],{lines:0,height:0,holes:0,bumpiness:0},greedy);expect(a.selectedId).toBe('0:0');for(let i=0;i<5;i++)expect(search(emptyBoard(),'O',[],{lines:0,height:0,holes:0,bumpiness:0},greedy).selectedId).toBe(a.selectedId);expect(actionOrder(a.path[0],{...a.path[0],x:1})).toBeLessThan(0);});
  it('matches an independent exhaustive 2-ply traversal and returns FIRST action',()=>{
    const s=SCENARIOS[4],all:{score:number;metrics:ReturnType<typeof measure>;actions:Action[]}[]=[];
    for(const first of landings(s.board,s.current).actions){const a=lock(s.board,first)!;for(const second of landings(a.board,s.next[0]).actions){const b=lock(a.board,second)!;const m=measure(b.board,b.clearedRows.length);all.push({score:(a.clearedRows.length+b.clearedRows.length)*W.lines+boardValue(m,W),metrics:m,actions:[first,second]});}}
    all.sort(rank);const actual=search(s.board,s.current,s.next,W,two);expect(actual.path).toEqual(all[0].actions);expect(actual.candidates.find(c=>c.id===actual.selectedId)!.pathScore).toBeCloseTo(all[0].score);expect(actual.selectedId).toBe(`${all[0].actions[0].rotation}:${all[0].actions[0].x}`);
  });
  it('wide depth-2 beam agrees with exhaustive under same objective',()=>{for(const s of SCENARIOS){const a=search(s.board,s.current,s.next,W,two),b=search(s.board,s.current,s.next,W,{algorithm:'beam',depth:2,width:100000});expect(b.path).toEqual(a.path);expect(b.candidates.find(c=>c.id===b.selectedId)?.pathScore).toBeCloseTo(a.candidates.find(c=>c.id===a.selectedId)!.pathScore!);}});
  it('does not repeatedly add intermediate board penalties',()=>{const s=SCENARIOS[4],a=search(s.board,s.current,s.next,W,two);let b=s.board,reward=0;for(const action of a.path){const result=lock(b,action)!;reward+=result.clearedRows.length*W.lines;b=result.board;}expect(a.candidates.find(c=>c.id===a.selectedId)!.pathScore).toBeCloseTo(reward+boardValue(measure(b),W));});
  it('retains K GLOBALLY at each beam depth with accurate counts',()=>{const a=search(emptyBoard(),'T',['I','S'],W,{algorithm:'beam',depth:3,width:5});expect(a.stats).toHaveLength(3);a.stats.forEach(s=>{expect(s.kept).toBeLessThanOrEqual(5);expect(s.generated).toBe(s.kept+s.pruned);});expect(a.evaluated).toBe(a.stats.reduce((n,s)=>n+s.generated,0));for(const n of a.nodes.filter(n=>!n.kept)){expect(n.cutoff).not.toBeNull();expect(n.score).toBeLessThanOrEqual(n.cutoff!);}});
  it('same inputs reproduce scores, path and nodes',()=>{const s=SCENARIOS[5];const a=search(s.board,s.current,s.next,W,s.config),b=search(s.board,s.current,s.next,W,s.config);expect({...a,elapsedMs:0}).toEqual({...b,elapsedMs:0});});
  it('every root path score sums cumulative reward and ONLY final features',()=>{const s=SCENARIOS[4],a=search(s.board,s.current,s.next,W,two);for(const c of a.candidates.filter(c=>c.pathScore!==null)){expect(sum(c.pathContributions!)).toBeCloseTo(c.pathScore!);expect(c.pathContributions!.holes).toBe(-c.finalMetrics!.holes*W.holes);}});
  it('replay events are immutable copies with a deterministic preview sequence',()=>{const s=SCENARIOS[1],a=search(s.board,s.current,s.next,W,greedy),e=replayEvents(s.board,s.current,a,greedy,W);expect(Object.isFrozen(e)).toBe(true);expect(Object.isFrozen(e[2].board[0])).toBe(true);expect(e[2].sequence).toHaveLength(3);expect(()=>{e[2].board[19][0]=4;}).toThrow();expect(Object.isFrozen(s.board)).toBe(false);expect(replayEvents(s.board,s.current,a,greedy,W)[2].sequence).toEqual(e[2].sequence);});
  it('narration numbers come from real contributions',()=>{const s=SCENARIOS[1],a=search(s.board,s.current,s.next,W,greedy),selected=a.candidates.find(c=>c.id===a.selectedId)!,other=a.candidates.find(c=>c.metrics.holes===selected.metrics.holes+1)!;const text=explainChoice(selected,other,W,1);expect(text).toContain('8.0');const events=replayEvents(s.board,s.current,a,greedy,W);expect(events).toHaveLength(8);expect(events[1].text).toContain(String(a.candidates.length));expect(events[3].contributions).toEqual(a.candidates.find(c=>c.id===events[3].candidateId)?.contributions);expect(events[7].board).toEqual(selected.board);});
});
describe('all educational fixtures fulfil promises',()=>{
  it('placements fixture',()=>{const s=SCENARIOS[0];expect(search(s.board,s.current,s.next,s.weights,s.config).candidates.length).toBe(34);});
  it('one hole changes the choice at zero penalty',()=>{const s=SCENARIOS[1],a=search(s.board,s.current,s.next,W,greedy),b=search(s.board,s.current,s.next,{...W,holes:0},greedy);expect(a.selectedId).not.toBe(b.selectedId);expect(a.candidates[0].metrics.holes).toBe(0);expect(b.candidates[0].metrics.holes).toBe(1);});
  it('surface fixture measured by hand',()=>{expect(measure(SCENARIOS[2].board)).toMatchObject({heights:[2,0,5,1,3,0,1,4,0,1],height:17,bumpiness:25,holes:0});});
  it('line removal fixture chooses four-line clearing',()=>{const s=SCENARIOS[3],a=search(s.board,s.current,s.next,W,greedy);expect(a.candidates.find(c=>c.id===a.selectedId)!.metrics).toMatchObject({lines:4,height:0,holes:0,bumpiness:0});});
  it('future fixture has a less attractive immediate action that wins in 2-ply',()=>{const s=SCENARIOS[4],a=search(s.board,s.current,s.next,W,greedy),b=search(s.board,s.current,s.next,W,two);expect(a.selectedId).not.toBe(b.selectedId);expect(b.candidates.find(c=>c.id===b.selectedId)!.immediate).toBeLessThan(a.candidates[0].immediate);});
  it('beam fixture width changes evaluated/retained paths',()=>{const s=SCENARIOS[5],a=search(s.board,s.current,s.next,W,{...s.config,width:1}),b=search(s.board,s.current,s.next,W,{...s.config,width:10});expect(b.evaluated).toBeGreaterThan(a.evaluated);expect(a.stats.every(d=>d.kept===1)).toBe(true);});
  it('scenario-specific narration uses actual line clears and surface sums',()=>{for(const index of [2,3]){const s=SCENARIOS[index],a=search(s.board,s.current,s.next,W,s.config),e=replayEvents(s.board,s.current,a,s.config,W,s.id),c=a.candidates.find(c=>c.id===e[3].candidateId)!;expect(e[3].text).toContain(String(index===2?c.metrics.bumpiness:c.metrics.lines));if(index===3)expect(c.metrics.lines).toBe(4);}});
});
describe('JSON boundary',()=>{
  const data={version:1,board:emptyBoard(),seed:42,current:'T' as Piece,next:['I','J','O','L','Z'],weights:W,config:greedy};
  it('validates data and preserves board',()=>{expect(parseExperiment(JSON.stringify(data))).toEqual(data);});
  it('rejects size, invalid cells, pieces, nonfinite/out-of-range settings',()=>{for(const value of [{...data,board:[[0]]},{...data,seed:-1},{...data,next:['I']},{...data,weights:{...W,holes:-1}},{...data,config:{...greedy,width:100}}])expect(()=>parseExperiment(JSON.stringify(value))).toThrow();expect(()=>parseExperiment(' '.repeat(100001))).toThrow();});
});
