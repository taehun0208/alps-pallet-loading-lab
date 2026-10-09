import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { boardFromRows } from '../src/engine/board';
import { search } from '../src/engine/search';
import { DEFAULT_WEIGHTS as w, PIECES } from '../src/engine/types';
it('find fixed educational fixtures', () => {
  let state = 7123, foundHole = false, foundFuture = false;
  const fixtures: Record<string,unknown> = {};
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let trial = 0; trial < 10000 && (!foundHole || !foundFuture); trial++) {
    const heights = Array.from({length: 10}, () => Math.floor(random() * 7));
    const rows = Array.from({length: Math.max(...heights)}, (_, y) => heights.map(h => h >= Math.max(...heights) - y ? '#' : '.').join(''));
    if (rows.some(row => !row.includes('.'))) continue;
    const board = boardFromRows(rows), piece = 'T', next = [PIECES[Math.floor(random() * 7)]];
    const g = search(board, piece, next, w, {algorithm:'greedy',depth:1,width:10});
    if (!foundHole) {
      const low = search(board, piece, next, {...w,holes:0}, {algorithm:'greedy',depth:1,width:10});
      if (g.selectedId !== low.selectedId && low.candidates[0].metrics.holes === g.candidates[0].metrics.holes + 1) { fixtures.hole={rows,piece,next,default:g.selectedId,low:low.selectedId,holes:[g.candidates[0].metrics.holes,low.candidates[0].metrics.holes]}; foundHole=true; }
    }
    if (!foundFuture) {
      const two = search(board, piece, next, w, {algorithm:'two',depth:2,width:10});
      if (g.selectedId !== two.selectedId && two.selectedId && two.candidates.find(c=>c.id===two.selectedId)!.immediate < g.candidates[0].immediate) { fixtures.future={rows,piece,next,greedy:g.selectedId,two:two.selectedId}; foundFuture=true; }
    }
  }
  if (!foundHole || !foundFuture) throw Error('fixture missing');
  writeFileSync('tests/fixtures-found.json',JSON.stringify(fixtures,null,2));
});
