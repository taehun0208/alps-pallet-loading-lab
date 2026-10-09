import { validateBoard } from './board';
import { PIECES, STRATEGIES, type Board, type Piece, type SearchConfig, type Weights } from './types';
export type Experiment = { version: 1; board: Board; seed: number; current: Piece; next: Piece[]; weights: Weights; config: SearchConfig; supply?:{pieces:Piece[];index:number} };
export function parseExperiment(text: string): Experiment {
  if (text.length > 100000) throw Error('JSON은 100 KB 이하로 가져올 수 있습니다.');
  const value = JSON.parse(text);
  if (value?.version !== 1 || !validateBoard(value.board)) throw Error('버전 1의 10×20 보드가 필요합니다. 셀 값은 0~8 정수여야 합니다.');
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 4294967295) throw Error('시드는 0~4,294,967,295 정수여야 합니다.');
  if (!PIECES.includes(value.current) || !Array.isArray(value.next) || value.next.length !== 5 || !value.next.every((p:Piece)=>PIECES.includes(p))) throw Error('현재 블록과 공개 NEXT 5개를 확인해 주세요.');
  if (!value.weights || !['lines','height','holes','bumpiness'].every(k=>Number.isFinite(value.weights[k]) && value.weights[k]>=0 && value.weights[k]<=40)) throw Error('가중치는 0~40의 유한한 숫자여야 합니다.');
  if (!value.config || !['greedy','two','beam'].includes(value.config.algorithm) || !Number.isInteger(value.config.depth) || value.config.depth<1 || value.config.depth>5 || ![1,5,10,20,50].includes(value.config.width)) throw Error('알고리즘, 깊이 1~5, 빔 너비를 확인해 주세요.');
  if (value.config.strategy !== undefined && !STRATEGIES.includes(value.config.strategy)) throw Error('플레이 전략은 균형, 오른쪽·왼쪽·가운데 웰 중 하나여야 합니다.');
  if(value.supply){const s=value.supply;if(!Array.isArray(s.pieces)||s.pieces.length>20000||!s.pieces.every((p:Piece)=>PIECES.includes(p))||!Number.isInteger(s.index)||s.index<0||s.index+5>=s.pieces.length||s.pieces[s.index]!==value.current||JSON.stringify(s.pieces.slice(s.index+1,s.index+6))!==JSON.stringify(value.next))throw Error('저장된 공급 배열과 현재 블록·NEXT·소비 위치가 일치하지 않습니다.');}
  return {version:1,board:value.board,seed:value.seed,current:value.current,next:value.next,weights:{lines:value.weights.lines,height:value.weights.height,holes:value.weights.holes,bumpiness:value.weights.bumpiness},config:{algorithm:value.config.algorithm,depth:value.config.depth,width:value.config.width,...(value.config.strategy!==undefined?{strategy:value.config.strategy}:{})},...(value.supply?{supply:{pieces:value.supply.pieces,index:value.supply.index}}:{})};
}
