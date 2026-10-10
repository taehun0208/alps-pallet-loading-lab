import { select,type PackingStrategy } from './PackingStrategy';

export const LookaheadStrategy:PackingStrategy={
  id:'lookahead',name:'Lookahead',
  score(v,w){return v.current+w.lookahead*v.lookahead;},
  choosePlacement(context){return select(context,'lookahead');},
};
