import { select,type PackingStrategy } from './PackingStrategy';

export const MacsStrategy:PackingStrategy={
  id:'macs',name:'MACS',
  score(v,w){return v.current+w.macs*v.macs-w.fragmentation*v.fragmentation;},
  choosePlacement(context){return select(context,'macs');},
};
