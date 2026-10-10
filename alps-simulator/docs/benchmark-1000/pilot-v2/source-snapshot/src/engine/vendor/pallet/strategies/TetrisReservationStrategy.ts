import { select,type PackingStrategy } from './PackingStrategy';

export const TetrisReservationStrategy:PackingStrategy={
  id:'tetris-reserved',name:'Tetris Reserved Slot',
  score(v,w){return v.current-w.reservation*v.reservationPenalty;},
  choosePlacement(context){return select(context,'tetris-reserved');},
};
