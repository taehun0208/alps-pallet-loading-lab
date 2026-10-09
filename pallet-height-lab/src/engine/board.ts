import { PIECES, type Action, type Board, type Cell, type Metrics, type Piece } from './types';
export const WIDTH = 10, HEIGHT = 20;
export const emptyBoard = (): Board => Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));
export const cloneBoard = (b: Board): Board => b.map(r => [...r]);
const SHAPES: Record<Piece, number[][]> = {
  I: [[1, 1, 1, 1]], J: [[1, 0, 0], [1, 1, 1]], L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]], S: [[0, 1, 1], [1, 1, 0]], T: [[0, 1, 0], [1, 1, 1]], Z: [[1, 1, 0], [0, 1, 1]],
};
export function rotations(piece: Piece): Cell[][] {
  let matrix = SHAPES[piece];
  const unique = new Map<string, Cell[]>();
  for (let r = 0; r < 4; r++) {
    const cells: Cell[] = [];
    matrix.forEach((row, y) => row.forEach((v, x) => { if (v) cells.push({ x, y }); }));
    const minX = Math.min(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y));
    const normalized = cells.map(c => ({ x: c.x - minX, y: c.y - minY })).sort((a, b) => a.y - b.y || a.x - b.x);
    unique.set(JSON.stringify(normalized), normalized);
    matrix = matrix[0].map((_, x) => matrix.map(row => row[x]).reverse());
  }
  return [...unique.values()];
}
export function collides(board: Board, cells: Cell[], x: number, y: number): boolean {
  return cells.some(c => { const cx = x + c.x, cy = y + c.y; return cx < 0 || cx >= WIDTH || cy >= HEIGHT || (cy >= 0 && board[cy][cx] !== 0); });
}
export function clearLines(board: Board): { board: Board; rows: number[] } {
  const rows: number[] = [];
  const kept = board.filter((row, y) => { if (row.every(Boolean)) { rows.push(y); return false; } return true; }).map(row => [...row]);
  return { board: [...Array.from({ length: rows.length }, () => Array(WIDTH).fill(0)), ...kept], rows };
}
export function lock(board: Board, action: Action) {
  const cells = action.cells.map(c => ({ x: c.x + action.x, y: c.y + action.y }));
  // Top-out precedes line clearing; no cells can teleport through occupied cells.
  if (cells.some(c => c.y < 0) || collides(board, action.cells, action.x, action.y)) return null;
  const beforeClear = cloneBoard(board);
  cells.forEach(c => { beforeClear[c.y][c.x] = PIECES.indexOf(action.piece) + 1; });
  const cleared = clearLines(beforeClear);
  return { beforeClear, board: cleared.board, clearedRows: cleared.rows };
}
export function landings(board: Board, piece: Piece) {
  const actions: Action[] = [];
  let failures = 0;
  rotations(piece).forEach((cells, rotation) => {
    const width = Math.max(...cells.map(c => c.x)) + 1;
    const height = Math.max(...cells.map(c => c.y)) + 1;
    for (let x = 0; x <= WIDTH - width; x++) {
      let y = -height;
      while (!collides(board, cells, x, y + 1)) y++;
      if (cells.some(c => c.y + y < 0)) { failures++; continue; }
      actions.push({ piece, rotation, x, y, cells });
    }
  });
  return { actions, failures };
}
export function measure(board: Board, lines = 0): Metrics {
  const heights: number[] = [], holeCells: Cell[] = [];
  for (let x = 0; x < WIDTH; x++) {
    let first = -1;
    for (let y = 0; y < HEIGHT; y++) {
      if (board[y][x] && first < 0) first = y;
      else if (!board[y][x] && first >= 0) holeCells.push({ x, y });
    }
    heights.push(first < 0 ? 0 : HEIGHT - first);
  }
  return { lines, height: heights.reduce((a, b) => a + b, 0), holes: holeCells.length, holeCells, heights, maxHeight: Math.max(...heights), bumpiness: heights.slice(1).reduce((sum, h, x) => sum + Math.abs(h - heights[x]), 0) };
}
export function boardFromRows(rows: string[]): Board {
  return [...Array.from({ length: HEIGHT - rows.length }, () => Array(WIDTH).fill(0)), ...rows.map(row => [...row].map(v => v === '.' ? 0 : 8))];
}
export function validateBoard(value: unknown): value is Board {
  return Array.isArray(value) && value.length === HEIGHT && value.every(row => Array.isArray(row) && row.length === WIDTH && row.every(cell => Number.isInteger(cell) && cell >= 0 && cell <= 8));
}
