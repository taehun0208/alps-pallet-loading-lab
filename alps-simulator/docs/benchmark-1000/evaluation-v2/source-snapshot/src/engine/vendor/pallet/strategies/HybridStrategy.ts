import { select,type PackingStrategy } from './PackingStrategy';

export const HybridStrategy:PackingStrategy={
  id:'future-hybrid',name:'Future-Aware Hybrid',
  score(v,w){return v.current+w.macs*v.macs-w.fragmentation*v.fragmentation-w.fpl*v.futurePlacementLoss-w.deadEnd*v.deadEnds-w.lowerSpace*v.lowerSpaceLoss;},
  choosePlacement(context){return select(context,'future-hybrid');},
};
