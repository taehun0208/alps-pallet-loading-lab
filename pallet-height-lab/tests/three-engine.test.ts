import { describe, expect, it } from 'vitest';
import { PIECES3D, DEFAULT_CONFIG3D, DEFAULT_WEIGHTS3D, candidates3D, clearPlanes3D, empty3D, fits3D, index3D, landing3D, measure3D, orientationKey3D, orientations3D, rotate3D, scenario3D, search3D, shaftReady3D, supply3D, validateBoard3D } from '../src/three/engine';
describe('3D rotations and geometry',()=>{
  it('enumerates only proper rotations, keeps chirality and all four connected cubes',()=>{
    const counts=[3,3,12,24,12,8,12,12];
    PIECES3D.forEach((p,i)=>{
      const rotations=orientations3D(p);expect(rotations.length).toBe(counts[i]);
      expect(new Set(rotations.map(orientationKey3D)).size).toBe(rotations.length);
      rotations.forEach(cells=>{expect(cells).toHaveLength(4);expect(new Set(cells.map(c=>c.join(','))).size).toBe(4);for(const c of cells)expect(cells.some(other=>other!==c&&other.reduce((s,n,j)=>s+Math.abs(n-c[j]),0)===1)).toBe(true);});
    });
    expect(orientations3D('R').some(r=>orientations3D('C').some(c=>orientationKey3D(r)===orientationKey3D(c)))).toBe(false);
  });
  it('four axis rotations return to the same shape',()=>{
    for(const p of PIECES3D)for(const axis of ['x','y','z'] as const){let c=orientations3D(p)[0];for(let i=0;i<4;i++)c=rotate3D(c,axis);expect(orientationKey3D(c)).toBe(orientationKey3D(orientations3D(p)[0]));}
  });
  it('lands at first collision and never tunnels under a ceiling',()=>{
    const b=empty3D();b.cells[index3D(b,0,4,0)]=8;
    const r=orientations3D('I').findIndex(c=>c.every(v=>v[0]===0&&v[2]===0));
    expect(landing3D(b,'I',r,0,0)?.action.y).toBe(5);
    expect(landing3D(b,'I',r,5,0)).toBeNull();
    b.cells[index3D(b,0,11,0)]=8;expect(landing3D(b,'I',r,0,0)).toBeNull();
  });
});
describe('3D clearing, evaluation and search',()=>{
  it('vertical I clears exactly four prepared planes without mutating input',()=>{
    const b=scenario3D('shaft'),original=[...b.cells];expect(shaftReady3D(b)).toBe(4);
    const r=orientations3D('I').findIndex(c=>c.every(v=>v[0]===0&&v[2]===0));
    const placed=landing3D(b,'I',r,4,4)!;
    expect(placed.cleared).toEqual([0,1,2,3]);expect(placed.board.cells.every(v=>v===0)).toBe(true);expect(b.cells).toEqual(original);
  });
  it('a filled row is insufficient; clearing shifts whole planes and preserves upper voxels',()=>{
    const b=empty3D(4,4,10);for(let x=0;x<4;x++)b.cells[index3D(b,x,0,0)]=1;
    expect(clearPlanes3D(b).cleared).toHaveLength(0);
    for(let z=0;z<4;z++)for(let x=0;x<4;x++)b.cells[index3D(b,x,0,z)]=2;
    b.cells[index3D(b,1,3,2)]=7;const cleared=clearPlanes3D(b);
    expect(cleared.cleared).toEqual([0]);expect(cleared.board.cells[index3D(b,1,2,2)]).toBe(7);expect(cleared.board.cells.filter(Boolean)).toHaveLength(1);
  });
  it('measures vertical holes and roughness in both horizontal directions',()=>{
    const b=empty3D(4,4,10);b.cells[index3D(b,1,2,1)]=1;
    const m=measure3D(b);expect(m.holes).toBe(2);expect(m.roughness).toBe(12);expect(m.height).toBe(3/16);expect(m.maxHeight).toBe(3);
  });
  it('all enumerated actions are legal and stable; reflected pieces stay distinct',()=>{
    const b=scenario3D('terrain');for(const p of PIECES3D){const list=candidates3D(b,p,DEFAULT_WEIGHTS3D,'balanced');expect(list.length).toBeGreaterThan(0);for(const c of list)expect(fits3D(b,orientations3D(p)[c.action.rotation],c.action.x,c.action.y,c.action.z)).toBe(true);}
  });
  it('all three algorithms find the four-plane clear and expose coherent scores',()=>{
    const b=scenario3D('shaft');for(const algorithm of ['greedy','two','beam'] as const){const a=search3D(b,'I',['O','V'],DEFAULT_WEIGHTS3D,{...DEFAULT_CONFIG3D,algorithm});const c=a.candidates.find(c=>c.id===a.selectedId)!;expect(c.cleared).toHaveLength(4);expect(c.reward).toBe(144);expect(c.immediate).toBeCloseTo(c.f+c.reward);expect(c.f).toBeCloseTo(Object.values(c.terms).reduce((s,n)=>s+n,0));expect(c.q).not.toBeNull();expect(a.nodes).toBeGreaterThan(0);}
  });
  it('two-ply agrees with exhaustive enumeration',()=>{
    const b=scenario3D('terrain',4,4,10),w=DEFAULT_WEIGHTS3D;
    const roots=candidates3D(b,'V',w,'balanced');const expected=roots.map(r=>r.reward+Math.max(...candidates3D(r.board,'T',w,'balanced').map(c=>c.immediate))).sort((a,b)=>b-a)[0];
    const a=search3D(b,'V',['T'],w,{algorithm:'two',depth:2,width:8,strategy:'balanced'});expect(a.candidates[0].q).toBeCloseTo(expected);
  });
  it('limits search to disclosed next pieces and never reports pruned roots as searched',()=>{
    const b=empty3D(4,4,10),w=DEFAULT_WEIGHTS3D;
    const a=search3D(b,'V',[],w,{...DEFAULT_CONFIG3D,depth:3});expect(a.depth).toBe(1);
    const beam=search3D(b,'V',['I','O'],w,{...DEFAULT_CONFIG3D,depth:3,width:1});expect(beam.pruned).toBeGreaterThan(0);expect(beam.candidates.filter(c=>c.q!==null)).toHaveLength(1);
  });
  it('returns no action on a full ceiling',()=>{
    const b=empty3D();for(let i=(b.height-1)*b.width*b.depth;i<b.cells.length;i++)b.cells[i]=8;
    expect(search3D(b,'I',['T'],DEFAULT_WEIGHTS3D,DEFAULT_CONFIG3D).selectedId).toBeNull();
  });
  it('reports evaluated terminal scores even for paths outside the final beam',()=>{
    const a=search3D(empty3D(),'I',['V'],DEFAULT_WEIGHTS3D,{...DEFAULT_CONFIG3D,depth:2,width:8});
    expect(a.candidates.filter(c=>c.q!==null)).toHaveLength(8);
    expect(a.candidates[0].q).toBe(Math.max(...a.candidates.filter(c=>c.q!==null).map(c=>c.q!)));
  });
  it('conserves occupied volume across a deterministic 40-block run',()=>{
    let b=empty3D();const feed=supply3D(123,43);
    for(let i=0;i<40;i++){
      const original=[...b.cells],a=search3D(b,feed[i],feed.slice(i+1,i+3),DEFAULT_WEIGHTS3D,{...DEFAULT_CONFIG3D,strategy:'balanced'});
      const chosen=a.candidates.find(c=>c.id===a.selectedId);if(!chosen)break;
      expect(chosen.board.cells.filter(Boolean).length).toBe(b.cells.filter(Boolean).length+4-chosen.cleared.length*b.width*b.depth);
      expect(b.cells).toEqual(original);expect(chosen.board.cells).toHaveLength(b.cells.length);b=chosen.board;
    }
  });
  it('uses deterministic eight-piece bags',()=>{expect(supply3D(42)).toEqual(supply3D(42));expect(new Set(supply3D(42,8)).size).toBe(8);expect(supply3D(43)).not.toEqual(supply3D(42));});
  it('rejects malformed or oversized imported boards',()=>{expect(()=>validateBoard3D({...empty3D(),width:50})).toThrow();expect(()=>validateBoard3D({...empty3D(),cells:[0]})).toThrow();expect(validateBoard3D(empty3D())).toEqual(empty3D());});
});
