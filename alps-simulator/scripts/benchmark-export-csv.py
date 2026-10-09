#!/usr/bin/env python3
"""Export compact metric tables without mixing independent and reused inputs."""
from pathlib import Path
import csv
import json

OUT=Path(__file__).resolve().parents[1]/'public/results'

def main():
    raw=(OUT/'summary.json').read_bytes();data=json.loads(raw)
    assert data['complete'] and data['schema']=='alps-benchmark/2'
    records=[]
    for row in data['summaries']:
        result={k:row[k] for k in ['algorithm','cycleSeconds','evaluationStatus','analysisGroup','n','expectedN','allPassed','pareto']}
        for metric,scale in [('fill',100),('count',1),('floorContactCoverage',100),('projectedCoverage',100),('columnVoidLiters',1),('voidLiters',1),('cogOffsetMm',1),('cogHeightMm',1),('minSupport',100),('maxLoadRatio',100)]:
            m=row['metrics'][metric];label=metric+'Percent' if scale==100 else metric
            result[label+'Mean']=None if m['mean'] is None else m['mean']*scale
            result[label+'CI95Low']=None if m['ci95'] is None else m['ci95'][0]*scale
            result[label+'CI95High']=None if m['ci95'] is None else m['ci95'][1]*scale
        result.update(row['timing']);records.append(result)
    with (OUT/'algorithm-summary.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(records[0]));w.writeheader();w.writerows(records)
    with (OUT/'trials.csv').open() as f:trials=list(csv.DictReader(f))
    independent=[r for r in trials if r['evaluationStatus']=='independent-evaluation']
    assert len(independent)==35
    with (OUT/'independent-10s-trials.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(independent[0]));w.writeheader();w.writerows(independent)
    assert (OUT/'summary.json').read_bytes()==raw
    print(json.dumps({'summaryRows':len(records),'independentTrialRows':len(independent)}))

if __name__=='__main__':main()
