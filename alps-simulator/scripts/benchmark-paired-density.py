#!/usr/bin/env python3
"""Prespecified density/CoG contrasts on the NEW independent evaluation only."""
from pathlib import Path
from statistics import mean, stdev
from math import sqrt
import hashlib
import json
import csv

OUT=Path(__file__).resolve().parents[1]/'public/results'
T95={1:12.7062047364,2:4.3026527297,3:3.1824463053,4:2.7764451052}

def main():
    raw=(OUT/'summary.json').read_bytes();data=json.loads(raw)
    assert data['schema']=='alps-benchmark/2' and data['complete']
    evaluation=[r for r in data['rows'] if r['evaluationStatus']=='independent-evaluation' and r['cycleSeconds']==10]
    assert len(evaluation)==35
    comparable=[r for r in evaluation if r['qualityEligible'] and r['deadlineEligible']]
    before={r['seed']:r for r in comparable if r['algorithm']=='capacity-compact'}
    after={r['seed']:r for r in comparable if r['algorithm']=='floor-dense'}
    seeds=sorted(before.keys() & after.keys())
    definitions=[('fill','quality',100,'percentage-points','higher'),('floorContactCoverage','geometry',100,'percentage-points','higher'),
                 ('columnVoidLiters','quality',1,'L','lower'),('voidLiters','quality',1,'L','lower'),('count','quality',1,'boxes','higher'),
                 ('cogOffsetMm','quality',1,'mm','lower'),('cogHeightMm','quality',1,'mm','lower')]
    contrasts=[]
    for metric,section,scale,unit,preferred in definitions:
        pairs=[{'seed':s,'compact':before[s][section][metric]*scale,'alpsTetris':after[s][section][metric]*scale,
                'difference':(after[s][section][metric]-before[s][section][metric])*scale} for s in seeds]
        diffs=[p['difference'] for p in pairs];center=mean(diffs) if diffs else None
        half=T95[len(diffs)-1]*stdev(diffs)/sqrt(len(diffs)) if len(diffs)>1 else None
        contrasts.append({'metric':metric,'unit':unit,'preferred':preferred,'n':len(pairs),'seeds':seeds,
                          'compactMean':mean(p['compact'] for p in pairs) if pairs else None,'alpsTetrisMean':mean(p['alpsTetris'] for p in pairs) if pairs else None,
                          'differenceMean':center,'ci95':None if half is None else [center-half,center+half],
                          'direction':'ALPS Tetris minus Compact','multipleComparisonAdjusted':False,'pairs':pairs})
    timing=[]
    for algorithm in data['config']['algorithms']:
        rows=[r for r in evaluation if r['algorithm']==algorithm];decisions=[d for r in rows for d in r['timing']]
        timing.append({'algorithm':algorithm,'trials':len(rows),'decisions':len(decisions),
                       'maxDecisionReadyMs':max(d['decisionReadyMs'] for d in decisions),'maxWorkerRoundTripMs':max(d['workerRoundTripMs'] for d in decisions),
                       'cycleDeadlineMisses':sum(not d['validCycleDeadline'] for d in decisions),
                       'workerWatchdogs':sum(d['workerTimedOut'] for d in decisions),'fallbacks':sum(d['fallbackUsed'] for d in decisions)})
    output={'schema':'alps-independent-density-contrast/1','sourceSummarySha256':hashlib.sha256(raw).hexdigest(),
            'cycleSeconds':10,'evaluationStatus':'independent-evaluation','seeds':list(range(12042,12047)),
            'contrasts':contrasts,'timing':timing,'notes':['Paired Student t 95% intervals over five input seeds; exploratory, no multiple-comparison adjustment.',
            'Decision-ready time = assumed recognition delay + measured worker round trip + measured commit validation; actual sensor/communications/full robot motion are unmeasured.',
            'Static CoG and geometric void are not vibration or physical transport safety measurements.']}
    (OUT/'independent-improvement.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    flat=[{k:v for k,v in r.items() if k not in ['pairs','seeds','ci95']}|{'ci95Low':r['ci95'][0] if r['ci95'] else None,'ci95High':r['ci95'][1] if r['ci95'] else None} for r in contrasts]
    with (OUT/'independent-improvement.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(flat[0]));w.writeheader();w.writerows(flat)
    assert (OUT/'summary.json').read_bytes()==raw
    print(json.dumps({'contrasts':flat,'timing':timing},ensure_ascii=False))

if __name__=='__main__':main()
