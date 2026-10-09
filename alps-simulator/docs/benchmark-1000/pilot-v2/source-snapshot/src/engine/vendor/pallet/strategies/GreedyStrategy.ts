import { select,type PackingStrategy } from './PackingStrategy';

export const GreedyStrategy:PackingStrategy={
  id:'strategy-greedy',name:'Greedy',
  score(v,w){return v.current;},
  choosePlacement(context){return select(context,'strategy-greedy');},
};
