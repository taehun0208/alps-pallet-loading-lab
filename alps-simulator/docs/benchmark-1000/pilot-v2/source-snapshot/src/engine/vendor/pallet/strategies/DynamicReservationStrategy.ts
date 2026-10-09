import { select,type PackingStrategy } from './PackingStrategy';

export const DynamicReservationStrategy:PackingStrategy={
  id:'dynamic-reservation',name:'Dynamic Reservation',
  score(v,w){return v.current-w.fpl*v.futurePlacementLoss-w.deadEnd*v.deadEnds-w.lowerSpace*v.lowerSpaceLoss-w.fragmentation*v.fragmentation;},
  choosePlacement(context){return select(context,'dynamic-reservation');},
};
