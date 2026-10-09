import { search } from './search';
import type { Board, Piece, SearchConfig, Weights } from './types';
export type AnalysisRequest = { id: number; type: 'analysis'; board: Board; current: Piece; next: Piece[]; weights: Weights; config: SearchConfig };
export type CompareRequest = { id: number; type: 'compare'; boards: (Board | null)[]; current: Piece; next: Piece[]; weights: Weights; beam: SearchConfig };
self.onmessage = (event: MessageEvent<AnalysisRequest | CompareRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'analysis') {
      const result = search(request.board, request.current, request.next, request.weights, request.config);
      const baseline = request.config.strategy && request.config.strategy !== 'balanced'
        ? search(request.board, request.current, request.next, request.weights, {...request.config, strategy:'balanced'}) : null;
      self.postMessage({id:request.id,result,baseline});
      return;
    }
    const result = request.boards.map((board,i)=>board ? search(board,request.current,request.next,request.weights, i===0 ? {algorithm:'greedy',depth:1,width:10,strategy:request.beam.strategy} : i===1 ? {algorithm:'two',depth:2,width:10,strategy:request.beam.strategy} : request.beam) : null);
    self.postMessage({ id:request.id, result });
  } catch (error) { self.postMessage({id:request.id,error:error instanceof Error ? error.message : String(error)}); }
};
