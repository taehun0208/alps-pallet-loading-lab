import { search3D, type Board3D, type Config3D, type Piece3D, type Weights3D } from './engine';
self.onmessage=(event:MessageEvent<{board:Board3D;piece:Piece3D;next:Piece3D[];weights:Weights3D;config:Config3D}>)=>{
  try {const {board,piece,next,weights,config}=event.data;self.postMessage({result:search3D(board,piece,next,weights,config)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'3D 탐색 실패'});}
};
