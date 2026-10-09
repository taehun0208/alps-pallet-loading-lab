export const PIECES3D = ['I', 'O', 'T', 'L', 'S', 'V', 'R', 'C'] as const;
export type Piece3D = typeof PIECES3D[number];
export type Cell3D = readonly [number, number, number]; // x, y (height), z (depth)
export type Axis3D = 'x' | 'y' | 'z';
export interface Board3D { width: number; depth: number; height: number; cells: number[] }
export interface Action3D { piece: Piece3D; rotation: number; x: number; y: number; z: number }
export interface Metrics3D { height: number; holes: number; roughness: number; maxHeight: number; heights: number[]; occupied: number }
export interface Weights3D { height: number; holes: number; roughness: number; planes: number; shaft: number }
export interface Config3D { algorithm: 'greedy' | 'two' | 'beam'; depth: number; width: number; strategy: 'balanced' | 'shaft' }
export interface Candidate3D {
  id: string; action: Action3D; board: Board3D; beforeClear: Board3D; cleared: number[];
  metrics: Metrics3D; f: number; reward: number; immediate: number; q: number | null;
  terms: { height: number; holes: number; roughness: number; shaft: number; danger: number };
  path: Action3D[];
}
export interface Analysis3D { candidates: Candidate3D[]; selectedId: string | null; nodes: number; milliseconds: number; depth: number; pruned: number }
export const DEFAULT_WEIGHTS3D: Weights3D = { height: 1, holes: 7, roughness: 0.6, planes: 18, shaft: 2 };
export const DEFAULT_CONFIG3D: Config3D = { algorithm: 'beam', depth: 2, width: 8, strategy: 'shaft' };
export const PIECE_NAMES3D: Record<Piece3D, string> = { I: '직선', O: '정사각', T: 'T자', L: 'L자', S: '계단', V: '삼각 가지', R: '오른 나선', C: '왼 나선' };
const SHAPES: Record<Piece3D, Cell3D[]> = {
  I: [[0,0,0],[1,0,0],[2,0,0],[3,0,0]], O: [[0,0,0],[1,0,0],[0,0,1],[1,0,1]],
  T: [[0,0,0],[1,0,0],[2,0,0],[1,0,1]], L: [[0,0,0],[1,0,0],[2,0,0],[0,0,1]],
  S: [[0,0,0],[1,0,0],[1,0,1],[2,0,1]], V: [[0,0,0],[1,0,0],[0,1,0],[0,0,1]],
  R: [[0,0,0],[1,0,0],[1,1,0],[1,1,1]], C: [[0,0,0],[-1,0,0],[-1,1,0],[-1,1,1]],
};
export function normalize3D(cells: readonly Cell3D[]): Cell3D[] {
  const mins = [0,1,2].map(axis => Math.min(...cells.map(c => c[axis])));
  return cells.map(c => [c[0]-mins[0],c[1]-mins[1],c[2]-mins[2]] as Cell3D).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
}
export const orientationKey3D = (cells: readonly Cell3D[]) => normalize3D(cells).map(c=>c.join(',')).join(';');
export function rotate3D(cells: readonly Cell3D[], axis: Axis3D): Cell3D[] {
  return normalize3D(cells.map(([x,y,z])=>axis==='x'?[x,-z,y]:axis==='y'?[z,y,-x]:[-y,x,z]));
}
const orientationCache = new Map<Piece3D, Cell3D[][]>();
export function orientations3D(piece: Piece3D): Cell3D[][] {
  const cached = orientationCache.get(piece); if (cached) return cached;
  const result = [normalize3D(SHAPES[piece])], keys = new Set([orientationKey3D(result[0])]);
  for (let i=0;i<result.length;i++) for (const axis of ['x','y','z'] as const) {
    const rotated = rotate3D(result[i],axis), key = orientationKey3D(rotated);
    if (!keys.has(key)) { keys.add(key); result.push(rotated); }
  }
  orientationCache.set(piece,result); return result;
}
export const index3D = (b: Board3D,x: number,y: number,z: number) => (y*b.depth+z)*b.width+x;
export const empty3D = (width=5,depth=5,height=12): Board3D => ({width,depth,height,cells:Array(width*depth*height).fill(0)});
export function fits3D(b: Board3D, cells: readonly Cell3D[], x: number,y: number,z: number): boolean {
  return cells.every(([dx,dy,dz])=>x+dx>=0&&x+dx<b.width&&z+dz>=0&&z+dz<b.depth&&y+dy>=0&&y+dy<b.height&&!b.cells[index3D(b,x+dx,y+dy,z+dz)]);
}
export function clearPlanes3D(b: Board3D): {board: Board3D; cleared: number[]} {
  const area=b.width*b.depth, cleared:number[]=[], remaining:number[]=[];
  for (let y=0;y<b.height;y++) {
    const plane=b.cells.slice(y*area,(y+1)*area);
    if (plane.every(Boolean)) cleared.push(y); else remaining.push(...plane);
  }
  remaining.push(...Array(cleared.length*area).fill(0));
  return {board:{...b,cells:remaining},cleared};
}
export function landing3D(b: Board3D,piece: Piece3D,rotation: number,x: number,z: number): {action: Action3D;board: Board3D;beforeClear: Board3D;cleared: number[]} | null {
  const cells=orientations3D(piece)[rotation]; if (!cells) return null;
  let y=b.height-1-Math.max(...cells.map(c=>c[1]));
  if (!fits3D(b,cells,x,y,z)) return null;
  while (fits3D(b,cells,x,y-1,z)) y--;
  const beforeClear={...b,cells:[...b.cells]};
  cells.forEach(([dx,dy,dz])=>beforeClear.cells[index3D(b,x+dx,y+dy,z+dz)]=PIECES3D.indexOf(piece)+1);
  return {action:{piece,rotation,x,y,z},beforeClear,...clearPlanes3D(beforeClear)};
}
export function measure3D(b: Board3D): Metrics3D {
  const heights:number[]=[], area=b.width*b.depth; let holes=0,occupied=0;
  for (let z=0;z<b.depth;z++) for (let x=0;x<b.width;x++) {
    let h=0,cover=false;
    for (let y=b.height-1;y>=0;y--) {
      if (b.cells[index3D(b,x,y,z)]) { occupied++; if (!cover) h=y+1; cover=true; }
      else if (cover) holes++;
    }
    heights.push(h);
  }
  let roughness=0;
  for (let z=0;z<b.depth;z++) for (let x=0;x<b.width;x++) {
    if (x+1<b.width) roughness+=Math.abs(heights[z*b.width+x]-heights[z*b.width+x+1]);
    if (z+1<b.depth) roughness+=Math.abs(heights[z*b.width+x]-heights[(z+1)*b.width+x]);
  }
  return {height:heights.reduce((a,h)=>a+h,0)/area,holes,roughness,maxHeight:Math.max(...heights),heights,occupied};
}
export function shaftReady3D(b: Board3D): number {
  let ready=0;
  for (let y=0;y<b.height;y++) {
    let complete=true;
    for (let z=0;z<b.depth;z++) for (let x=0;x<b.width;x++) {
      const isShaft=x===b.width-1&&z===b.depth-1;
      if (Boolean(b.cells[index3D(b,x,y,z)])===isShaft) complete=false;
    }
    if (!complete) break; ready++;
  }
  return ready;
}
export function evaluate3D(b: Board3D,w: Weights3D,strategy: Config3D['strategy']) {
  const m=measure3D(b),adjacencies=(b.width-1)*b.depth+(b.depth-1)*b.width;
  const terms={height:-w.height*m.height*10,holes:-w.holes*m.holes,roughness:-w.roughness*m.roughness/adjacencies*10,
    shaft:strategy==='shaft'?w.shaft*(2*Math.min(4,shaftReady3D(b))-m.heights.at(-1)!):0,
    danger:-8*Math.max(0,m.maxHeight-Math.floor(b.height*0.75))**2};
  return {metrics:m,terms,f:Object.values(terms).reduce((a,v)=>a+v,0)};
}
export function candidates3D(b: Board3D,piece: Piece3D,w: Weights3D,strategy: Config3D['strategy']): Candidate3D[] {
  const result:Candidate3D[]=[];
  orientations3D(piece).forEach((cells,r)=>{
    const maxX=Math.max(...cells.map(c=>c[0])),maxZ=Math.max(...cells.map(c=>c[2]));
    for (let z=0;z<b.depth-maxZ;z++) for (let x=0;x<b.width-maxX;x++) {
      const placed=landing3D(b,piece,r,x,z); if (!placed) continue;
      const evaluation=evaluate3D(placed.board,w,strategy),p=placed.cleared.length,reward=w.planes*(p+(p===4?4:0));
      result.push({...placed,...evaluation,id:`${piece}:${r}:${x}:${z}`,reward,immediate:evaluation.f+reward,q:null,path:[placed.action]});
    }
  });
  return result;
}
const tie3D=(a:Candidate3D,b:Candidate3D)=>a.metrics.holes-b.metrics.holes||a.metrics.maxHeight-b.metrics.maxHeight||a.action.rotation-b.action.rotation||a.action.z-b.action.z||a.action.x-b.action.x;
export function search3D(b: Board3D,piece: Piece3D,next: readonly Piece3D[],w: Weights3D,c: Config3D): Analysis3D {
  const start=performance.now(),roots=candidates3D(b,piece,w,c.strategy); let nodes=roots.length,pruned=0;
  const depth=c.algorithm==='greedy'?1:Math.min(c.algorithm==='two'?2:Math.max(1,Math.min(3,c.depth)),next.length+1);
  if (depth===1) roots.forEach(r=>r.q=r.immediate);
  else if (c.algorithm==='two') {
    roots.forEach(root=>{
      const children=candidates3D(root.board,next[0],w,c.strategy); nodes+=children.length;
      children.sort((a,b)=>b.immediate-a.immediate||tie3D(a,b));
      root.q=children.length?root.reward+children[0].immediate:-1e9;
      root.path=children.length?[root.action,children[0].action]:[root.action];
    });
  } else {
    type Node={root:Candidate3D;board:Board3D;reward:number;f:number;path:Action3D[];tie:Candidate3D};
    const rank=(a:Node,b:Node)=>(b.reward+b.f)-(a.reward+a.f)||tie3D(a.tie,b.tie)||a.root.id.localeCompare(b.root.id);
    let beam:Node[]=roots.map(root=>({root,board:root.board,reward:root.reward,f:root.f,path:[root.action],tie:root})).sort(rank);
    pruned+=Math.max(0,beam.length-c.width); beam=beam.slice(0,Math.max(1,c.width));
    for (let d=1;d<depth;d++) {
      const expanded:Node[]=[];
      for (const n of beam) {
        const children=candidates3D(n.board,next[d-1],w,c.strategy); nodes+=children.length;
        if (!children.length) expanded.push({...n,f:-1e9});
        else children.forEach(child=>expanded.push({root:n.root,board:child.board,reward:n.reward+child.reward,f:child.f,path:[...n.path,child.action],tie:child}));
      }
      if(d===depth-1)expanded.forEach(n=>{const q=n.reward+n.f;if(n.root.q===null||q>n.root.q){n.root.q=q;n.root.path=n.path;}});
      expanded.sort(rank); pruned+=Math.max(0,expanded.length-c.width); beam=expanded.slice(0,Math.max(1,c.width));
    }
    beam.forEach(n=>{const q=n.reward+n.f;if(n.root.q===null||q>n.root.q){n.root.q=q;n.root.path=n.path;}});
  }
  roots.sort((a,b)=>a.q===null&&b.q!==null?1:b.q===null&&a.q!==null?-1:(b.q??b.immediate)-(a.q??a.immediate)||tie3D(a,b));
  return {candidates:roots,selectedId:roots.find(r=>r.q!==null)?.id??null,nodes,milliseconds:performance.now()-start,depth,pruned};
}
export function supply3D(seed:number,count=1000): Piece3D[] {
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const result:Piece3D[]=[];
  while(result.length<count){const bag=[...PIECES3D];for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}result.push(...bag);}
  return result.slice(0,count);
}
export type Scenario3D='shaft'|'empty'|'terrain'|'cavity';
export function scenario3D(id:Scenario3D,width=5,depth=5,height=12): Board3D {
  const b=empty3D(width,depth,height);
  for(let z=0;z<depth;z++)for(let x=0;x<width;x++) {
    const levels=id==='shaft'?4:id==='terrain'?1+(x+2*z)%4:id==='cavity'?3:0;
    for(let y=0;y<levels;y++) {
      if(id==='shaft'&&x===width-1&&z===depth-1)continue;
      if(id==='terrain'&&x===width-1&&z===depth-1)continue;
      if(id==='cavity'&&(x===width-1||z===depth-1||y===1&&x===2&&z===2))continue;
      b.cells[index3D(b,x,y,z)]=9;
    }
  }
  return b;
}
export function validateBoard3D(value:unknown): Board3D {
  if(!value||typeof value!=='object')throw new Error('보드 객체가 필요합니다.');
  const b=value as Board3D;
  if(!Number.isInteger(b.width)||b.width<4||b.width>6||!Number.isInteger(b.depth)||b.depth<4||b.depth>6||!Number.isInteger(b.height)||b.height<8||b.height>16)throw new Error('크기는 가로·깊이 4~6, 높이 8~16의 정수여야 합니다.');
  if(!Array.isArray(b.cells)||b.cells.length!==b.width*b.depth*b.height||!b.cells.every(v=>Number.isInteger(v)&&v>=0&&v<=9))throw new Error('셀 개수 또는 값(0~9)이 올바르지 않습니다.');
  return {width:b.width,depth:b.depth,height:b.height,cells:[...b.cells]};
}
