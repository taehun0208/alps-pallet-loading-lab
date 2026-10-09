#!/usr/bin/env python3
"""Audit mixed-source v2 without treating reused development seeds as holdout."""
from pathlib import Path
from math import isclose, hypot
from statistics import mean
import csv
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/results'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()

def close(a,b): assert isclose(a,b,rel_tol=1e-8,abs_tol=1e-7),(a,b)

def main():
    index = json.loads((OUT/'index.json').read_text()); summary = json.loads((OUT/'summary.json').read_text())
    assert index['schema']=='alps-sim-index/2' and summary['schema']=='alps-benchmark/2'
    assert index['complete'] and summary['complete'] and len(index['trials'])==len(summary['rows'])==133
    old_audit=json.loads((OUT/'baseline-v1/audit.json').read_text())
    for f in old_audit['rawFiles']: assert sha(OUT/f['path'])==f['sha256'],f['path']
    for f in summary['provenance']['sourceFiles']: assert sha(ROOT/f['path'])==f['sha256'],f['path']
    independent=[r for r in index['trials'] if r['evaluationStatus']=='independent-evaluation']
    assert len(independent)==35 and {r['seed'] for r in independent}==set(range(12042,12047))
    assert all(r['config']['cycleSeconds']==10 for r in independent)
    groups={};raw_files=[];decisions=0
    for item in index['trials']:
        path=ROOT/'public'/item['traceUrl'].lstrip('/'); r=json.loads(path.read_text()); boxes=r['placements']; p=r['scenario']['pallet']
        raw_files.append({'path':str(path.relative_to(OUT)),'sha256':sha(path)})
        for key,value in r['metrics'].items(): assert item['metrics'][key]==value,(r['id'],key)
        assert r['status']=='finished' and not r['unprocessed'] and not r['violations']
        assert len(boxes)+len(r['unplaced'])==len(r['arrivals'])==72
        assert len({b['id'] for b in boxes+r['unplaced']})==72
        volume=sum(b['size']['w']*b['size']['d']*b['size']['h'] for b in boxes);mass=sum(b['weight'] for b in boxes)
        close(volume,r['metrics']['volumeMm3']);close(volume/(p['width']*p['depth']*p['maxHeight']),r['metrics']['fill'])
        center={a:sum(b['weight']*(b['position'][a]+b['size'][s]/2) for b in boxes)/mass for a,s in [('x','w'),('y','d'),('z','h')]}
        for key in center:close(center[key],r['metrics']['center'][key])
        close(hypot(center['x']-p['width']/2,center['y']-p['depth']/2),r['metrics']['cogHorizontalOffsetMm'])
        for i,a in enumerate(boxes):
            for axis,size,limit in [('x','w',p['width']),('y','d',p['depth']),('z','h',p['maxHeight'])]:
                assert a['position'][axis]>=-1e-7 and a['position'][axis]+a['size'][size]<=limit+1e-7
            for b in boxes[:i]:
                assert not all(a['position'][axis]<b['position'][axis]+b['size'][size]-1e-7 and b['position'][axis]<a['position'][axis]+a['size'][size]-1e-7 for axis,size in [('x','w'),('y','d'),('z','h')])
        groups.setdefault((r['seed'],r['config']['cycleSeconds']),[]).append(r['inputFingerprint'])
        decisions+=len(r['decisions'])
    assert all(len(set(v))==1 for v in groups.values())
    assert decisions==9576
    assert sum(1 for _ in csv.DictReader((OUT/'trials.csv').open()))==133
    assert sum(1 for _ in csv.DictReader((OUT/'decisions.csv').open()))==9576
    for s in summary['summaries']:
        source=[r for r in summary['rows'] if r['algorithm']==s['algorithm'] and r['analysisGroup']==s['analysisGroup'] and r['qualityEligible'] and r['deadlineEligible']]
        assert len(source)==s['n'] and s['expectedN']==5
        if source:close(mean(r['quality']['fill'] for r in source),s['metrics']['fill']['mean'])
        permitted=set(range(12042,12047)) if s['cycleSeconds']==10 else set(range(11042,11047))
        assert {r['seed'] for r in source}.issubset(permitted)
        all_group=[r for r in summary['rows'] if r['algorithm']==s['algorithm'] and r['analysisGroup']==s['analysisGroup']]
        assert {r['seed'] for r in all_group}==permitted
    report={'schema':'alps-benchmark-audit/2','completedTrials':133,'newExecutions':49,'preservedBaselineRawFiles':84,
            'independentEvaluationTrials':35,'independentEvaluationSeeds':list(range(12042,12047)),'independentOperatingCycleSeconds':10,
            'developmentReevaluationCycleSeconds':12,'recordedDecisions':decisions,'sourceHashesUnchanged':True,'baselineRawHashesUnchanged':True,
            'checks':['volume','mass-weighted CoG','quantity/identity','boundaries','pairwise overlap','identical input','no mixed evaluation seed sets','CSV row counts'],
            'indexSha256':sha(OUT/'index.json'),'summarySha256':sha(OUT/'summary.json'),'rawFiles':raw_files}
    (OUT/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='rawFiles'},ensure_ascii=False))

if __name__=='__main__':main()
