#!/usr/bin/env python3
"""Additional geometry factors from the preserved 84-row baseline; no reruns."""
from pathlib import Path
import csv
import hashlib
import json
from statistics import mean, stdev
from math import sqrt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/results'

def union_area(boxes):
    xs = sorted({x for p in boxes for x in [p['position']['x'], p['position']['x'] + p['size']['w']]})
    area = 0
    for left, right in zip(xs, xs[1:]):
        middle = (left + right) / 2
        spans = sorted((p['position']['y'], p['position']['y'] + p['size']['d']) for p in boxes if p['position']['x'] <= middle < p['position']['x'] + p['size']['w'])
        bottom = top = None
        length = 0
        for lo, hi in spans:
            if bottom is None: bottom, top = lo, hi
            elif lo <= top: top = max(top, hi)
            else: length += top - bottom; bottom, top = lo, hi
        if bottom is not None: length += top - bottom
        area += (right - left) * length
    return area

def estimate(values):
    n = len(values); center = mean(values)
    half = 2.7764451052 * stdev(values) / sqrt(n) if n == 5 else None
    return {'n': n, 'mean': center, 'ci95': [center-half,center+half] if half is not None else None, 'observations': values}

def main():
    index_path = OUT / 'index.json'; raw = index_path.read_bytes(); index = json.loads(raw)
    assert index['complete'] and len(index['trials']) == 84
    rows = []
    for item in index['trials']:
        row = json.loads((ROOT/'public'/item['traceUrl'].lstrip('/')).read_text())
        boxes, pallet, metrics = row['placements'], row['scenario']['pallet'], row['metrics']
        base = pallet['width'] * pallet['depth']
        contact = union_area([p for p in boxes if abs(p['position']['z']) <= 1e-7]) / base
        projection = union_area(boxes) / base
        assert 0 <= contact <= projection <= 1 + 1e-9
        rows.append({'id':row['id'],'algorithm':row['algorithm'],'seed':row['seed'],'split':item['split'],
                     'cycleSeconds':row['config']['cycleSeconds'],'floorContactCoverage':contact,
                     'projectedCoverage':projection,'fill':metrics['fill'],'count':metrics['count'],
                     'columnVoidLiters':metrics['columnVoidMm3']/1e6,'envelopeVoidLiters':metrics['envelopeEmptyMm3']/1e6,
                     'columnVoidFraction':metrics['columnVoidMm3']/(metrics['volumeMm3']+metrics['columnVoidMm3']),
                     'envelopeFill':metrics['envelopeFill'],'usedHeightMm':metrics['usedHeightMm']})
    keys = ['floorContactCoverage','projectedCoverage','fill','count','columnVoidLiters','envelopeVoidLiters','columnVoidFraction','envelopeFill','usedHeightMm']
    summaries=[]
    for cycle in [10,12]:
        for algorithm in dict.fromkeys(r['algorithm'] for r in rows):
            selected=sorted([r for r in rows if r['algorithm']==algorithm and r['cycleSeconds']==cycle and r['split']=='holdout'],key=lambda r:r['seed'])
            summaries.append({'algorithm':algorithm,'cycleSeconds':cycle,'n':len(selected), **{k:estimate([r[k] for r in selected]) for k in keys}})
    result={'schema':'alps-baseline-floor-factors/1','newSimulationExecuted':False,
            'sourceIndexSha256':hashlib.sha256(raw).hexdigest(),'benchmarkSourceSha256':index['provenance']['sourceSha256'],
            'definitions':{'floorContactCoverage':'Exact union of footprints of boxes directly touching pallet floor (z=0), divided by pallet footprint.',
                           'projectedCoverage':'Exact union of all box footprints projected to XY, divided by pallet footprint. Includes overhanging upper boxes.',
                           'columnVoidLiters':'Recorded exact empty volume below local highest box tops; not a trapped/accessibility proof.',
                           'caution':'These are observations of the preserved finite-search baseline. More filled floor area alone does not guarantee highest final 3D fill.'},
            'rows':rows,'summaries':summaries}
    (OUT/'factor-geometry.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    with (OUT/'factor-geometry.csv').open('w',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    assert index_path.read_bytes()==raw
    for row in summaries:
        if row['cycleSeconds']==10:
            print(row['algorithm'], 'floor',round(row['floorContactCoverage']['mean']*100,2),'projection',round(row['projectedCoverage']['mean']*100,2),'columnL',round(row['columnVoidLiters']['mean'],4),'fill',round(row['fill']['mean']*100,2))

if __name__=='__main__': main()
