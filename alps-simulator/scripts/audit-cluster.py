"""Independent Python geometry/statistics audit. Does not run/modify old trials."""
from pathlib import Path
import json, math, hashlib, zipfile, statistics
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/cluster'
OLD=ROOT/'public/results'
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def close(a,b):
    assert math.isclose(a,b,rel_tol=1e-8,abs_tol=1e-7),(a,b)
def area_union(boxes,pallet):
    xs=sorted({0,pallet['width']}|{p['position']['x']+d for p in boxes for d in [0,p['size']['w']]})
    ys=sorted({0,pallet['depth']}|{p['position']['y']+d for p in boxes for d in [0,p['size']['d']]})
    area=column=0
    for l,r in zip(xs,xs[1:]):
        for f,b in zip(ys,ys[1:]):
            x,y=(l+r)/2,(f+b)/2
            covers=[p for p in boxes if p['position']['x']<=x<p['position']['x']+p['size']['w'] and p['position']['y']<=y<p['position']['y']+p['size']['d']]
            if covers:
                area+=(r-l)*(b-f)
                column+=(r-l)*(b-f)*max(p['position']['z']+p['size']['h'] for p in covers)
    return area,column

def geometry(r):
    ps=r['placements'];p=r['scenario']['pallet'];m=r['metrics'];arr=r['arrivals']
    assert r['status']=='finished' and not r['violations'] and not r['unprocessed']
    assert len(ps)+len(r['unplaced'])==len(arr)==len(r['decisions'])==72
    ids=[b['id'] for b in ps+r['unplaced']]
    assert len(set(ids))==len(ids) and set(ids)=={b['id'] for b in arr}
    assert [d['box']['id'] for d in r['decisions']]==[b['id'] for b in arr]
    accepted=[d for d in r['decisions'] if d['accepted']]
    assert len(accepted)==len(ps)
    for d in accepted:
        assert d['validDeadline']
        assert r['config']['recognitionDelaySeconds']*1000+d['decisionMs']+d['validationMs']<=r['config']['cycleSeconds']*1000+1e-7
    volume=sum(math.prod(b['size'].values()) for b in ps)
    mass=sum(b['weight'] for b in ps)
    for i,a in enumerate(ps):
        for ax,sz,limit in [('x','w',p['width']),('y','d',p['depth']),('z','h',p['maxHeight'])]:
            assert a['position'][ax]>=-1e-7 and a['position'][ax]+a['size'][sz]<=limit+1e-7
        for b in ps[:i]:
            assert not all(a['position'][ax]<b['position'][ax]+b['size'][sz]-1e-7 and b['position'][ax]<a['position'][ax]+a['size'][sz]-1e-7 for ax,sz in [('x','w'),('y','d'),('z','h')])
    close(m['volumeMm3'],volume);close(m['fill'],volume/(p['width']*p['depth']*p['maxHeight']))
    c={ax:sum(b['weight']*(b['position'][ax]+b['size'][sz]/2) for b in ps)/mass for ax,sz in [('x','w'),('y','d'),('z','h')]}
    for ax,v in c.items(): close(m['center'][ax],v)
    floor,_=area_union([b for b in ps if abs(b['position']['z'])<1e-6],p)
    _,column=area_union(ps,p)
    close(m['columnVoidMm3'],max(0,column-volume))
    contact=same=vertical=same_v=0
    for i,a in enumerate(ps):
        for b in ps[:i]:
            amounts={ax:max(0,min(a['position'][ax]+a['size'][sz],b['position'][ax]+b['size'][sz])-max(a['position'][ax],b['position'][ax])) for ax,sz in [('x','w'),('y','d'),('z','h')]}
            for ax,sz,other in [('x','w',('y','z')),('y','d',('x','z')),('z','h',('x','y'))]:
                if abs(a['position'][ax]+a['size'][sz]-b['position'][ax])<1e-5 or abs(b['position'][ax]+b['size'][sz]-a['position'][ax])<1e-5:
                    ar=math.prod(amounts[v] for v in other);contact+=ar
                    if a['typeId']==b['typeId']: same+=ar
                    if ax=='z':
                        vertical+=ar
                        if a['typeId']==b['typeId']:same_v+=ar
    f=floor/(p['width']*p['depth']);cl=same/contact if contact else 0;void=max(0,column-volume)/1e6
    balance=1-math.hypot(c['x']-p['width']/2,c['y']-p['depth']/2)/(math.hypot(p['width'],p['depth'])/2)
    clamp=lambda x:max(0,min(1,x))
    score=30*clamp(m['fill'])+25*f+30*cl+10*clamp(1-void/(volume/1e6))+5*clamp(balance)
    return {'fill':m['fill'],'floor':f,'sameSkuContact':cl,'sameSkuVertical':same_v/vertical if vertical else None,'columnVoidLiters':void,'score':score}

def handling_audit(boxes,metrics):
    # Recompute extraction with independent Python state; each ID ends at one destination.
    pallet={p['id']:p for p in boxes};buffer=set();delivered=set();extra=0;moves=0
    zone=lambda p:(int(p['typeId'][1:])-1)//2
    order=lambda p:(-(p['position']['z']+p['size']['h']),p['id'])
    def overlaps(a,b):
        return all(a['position'][ax]<b['position'][ax]+b['size'][sz]-1e-6 and b['position'][ax]<a['position'][ax]+a['size'][sz]-1e-6 for ax,sz in [('x','w'),('y','d')])
    def extract(p,current):
        nonlocal extra,moves
        if p['id'] not in pallet:return
        blockers=sorted([b for b in pallet.values() if b['id']!=p['id'] and b['position']['z']>=p['position']['z']+p['size']['h']-1e-6 and overlaps(p,b)],key=order)
        for b in blockers:extract(b,current)
        del pallet[p['id']];moves+=1
        if zone(p)==current:delivered.add(p['id'])
        else:buffer.add(p['id']);extra+=1
    for current in [0,1,2]:
        for p in sorted([p for p in boxes if zone(p)==current],key=order):
            if p['id'] in delivered:continue
            if p['id'] in buffer:buffer.remove(p['id']);delivered.add(p['id']);moves+=1
            else:extract(p,current)
    assert not pallet and not buffer and len(delivered)==len(boxes)
    assert extra==metrics['extraHandles'] and moves==metrics['totalMoves']==len(boxes)+extra
    assert metrics['totalSeconds']==moves*10
    close(metrics['secondsPer100Boxes'],moves*10/len(boxes)*100)

def main():
    old=json.loads((OLD/'index.json').read_text());audit=json.loads((OLD/'audit.json').read_text())
    for f in audit['rawFiles']:assert digest(OLD/f['path'])==f['sha256'],f['path']
    snapshot=json.loads((OLD/'source-snapshot-v2.json').read_text())
    assert digest(OLD/snapshot['path'])==snapshot['sha256']
    historical=json.loads((OLD/'summary.json').read_text())
    with zipfile.ZipFile(OLD/snapshot['path']) as z:
        for f in historical['provenance']['sourceFiles']:
            assert hashlib.sha256(z.read(f['path'])).hexdigest()==f['sha256'],f['path']
    for b in old['trials']:
        r=json.loads((ROOT/'public'/b['traceUrl'].lstrip('/')).read_text());geometry(r)
    new=json.loads((OUT/'index.json').read_text());freeze=json.loads((OUT/'freeze.json').read_text())
    for f in freeze['source']:assert digest(ROOT/f['path'])==f['sha256'],f['path']
    pairing={};raw_files=[]
    for b in new['rows']:
        path=ROOT/'public'/b['traceUrl'].lstrip('/');r=json.loads(path.read_text());derived=geometry(r)
        handling_audit(r['placements'],b['redistribution'])
        for k,v in derived.items():
            if v is None:assert b[k] is None
            else: close(v,b[k])
        pairing.setdefault(b['seed'],[]).append(r['inputFingerprint']);raw_files.append({'path':b['traceUrl'],'sha256':digest(path)})
    assert all(len(set(v))==1 for v in pairing.values())
    if new['complete']:
        assert len(new['rows'])==160 and len(pairing)==16
        assert all(len(v)==10 for v in pairing.values())
        assert all(r['eligible'] for r in new['rows'])
    sel=new['selected']
    if sel:
        ranked=sorted([s for s in new['selection'] if s['eligible']],key=lambda s:s['metrics']['score']['mean'],reverse=True)
        alps={'floor-dense','cluster-floor','cluster-layer'}
        baseline=[s for s in ranked if s['id'] not in alps|{'dispersed'}]
        assert sel['before']==baseline[0]['id'] and sel['worst']==ranked[-1]['id']
        gate=max(s['metrics']['fill']['mean'] for s in baseline)-.05
        close(gate,sel['fillGate'])
        assert sel['after']==next(s['id'] for s in ranked if s['id'] in alps and s['metrics']['fill']['mean']>=gate)
        assert not set(freeze['rule']['selectionSeeds'])&set(freeze['rule']['evaluationSeeds'])
    for s in new['evaluation']+new['selection']:
        split='evaluation' if s in new['evaluation'] else 'selection'
        for k,e in s['metrics'].items():
            vals=[r[k] for r in new['rows'] if r['algorithm']==s['id'] and r['split']==split and r[k] is not None]
            assert len(vals)==e['n']
            if vals:close(statistics.mean(vals),e['mean'])
    t_values={2:12.7062047364,3:4.3026527297,4:3.1824463053,5:2.7764451052,6:2.5705818356,7:2.4469118511,8:2.3646242510,9:2.3060041352,10:2.2621571629,11:2.2281388520,12:2.2009851601}
    for e in new['paired']:
        metric=e['metric'];a={r['seed']:r for r in new['rows'] if r['split']=='evaluation' and r['algorithm']==sel['after']};b={r['seed']:r for r in new['rows'] if r['split']=='evaluation' and r['algorithm']==sel['before']}
        vals=[(a[s][metric] or 0)-(b[s][metric] or 0) for s in sorted(a.keys()&b.keys())]
        assert vals==e['observations']
        if vals:close(statistics.mean(vals),e['mean'])
        if len(vals)>1:
            half=t_values[len(vals)]*statistics.stdev(vals)/math.sqrt(len(vals))
            close(e['ci95'][0],statistics.mean(vals)-half);close(e['ci95'][1],statistics.mean(vals)+half)
    report={'complete':new['complete'],'historicalTrialsRecalculated':len(old['trials']),'historicalDecisions':9576,'historicalRawHashesPreserved':True,'historicalSourceArchiveVerified':True,'newTrialsRecalculated':len(new['rows']),'newDecisions':len(new['rows'])*72,'newSourceFreezeVerified':True,'pairedInputVerified':True,'checks':['box IDs and counts','accepted deadlines','bounds and pairwise non-overlap','exact floor union','exact column void','mass weighted CoG','same SKU face and vertical contact','weighted decision score','independent redistribution conservation and model-time calculation','selection independent of evaluation','seed-level paired Student-t intervals'],'limitations':['Python geometry audit does not independently certify physical material limits, reach or complete arm kinematics. Shared constraint implementation and focused tests cover modeled feasibility only.'],'rawFiles':raw_files}
    (OUT/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='rawFiles'},ensure_ascii=False))
if __name__=='__main__':main()
