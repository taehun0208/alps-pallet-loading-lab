#!/usr/bin/env python3
"""Read-only numerical audit of completed new benchmark, then write a manifest."""
from pathlib import Path
import csv
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/results'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()

def close(a, b):
    assert math.isclose(a, b, rel_tol=1e-8, abs_tol=1e-7), (a, b)

def main():
    index = json.loads((OUT / 'index.json').read_text())
    summary = json.loads((OUT / 'summary.json').read_text())
    assert index['complete'] and summary['complete']
    assert len(index['trials']) == len(summary['rows']) == 84
    for source in summary['provenance']['sourceFiles']:
        assert sha(ROOT / source['path']) == source['sha256'], source['path']
    decision_count = 0
    groups, streams, placements = {}, {}, {}
    raw_files = []
    for brief in index['trials']:
        path = ROOT / 'public' / brief['traceUrl'].lstrip('/')
        row = json.loads(path.read_text())
        raw_files.append({'path': str(path.relative_to(OUT)), 'sha256': sha(path)})
        assert row['id'] == brief['id'] and row['metrics'] == brief['metrics']
        assert row['status'] == 'finished' and not row['violations'] and not row['unprocessed']
        assert len(row['arrivals']) == len(row['placements']) + len(row['unplaced']) == 72
        assert len({p['id'] for p in row['placements'] + row['unplaced']}) == 72
        p = row['scenario']['pallet']; boxes = row['placements']
        volume = sum(b['size']['w'] * b['size']['d'] * b['size']['h'] for b in boxes)
        mass = sum(b['weight'] for b in boxes)
        close(row['metrics']['fill'], volume / (p['width'] * p['depth'] * p['maxHeight']))
        for axis, size in [('x','w'),('y','d'),('z','h')]:
            close(row['metrics']['center'][axis], sum(b['weight'] * (b['position'][axis] + b['size'][size] / 2) for b in boxes) / mass)
        for i, a in enumerate(boxes):
            assert a['position']['x'] >= 0 and a['position']['y'] >= 0 and a['position']['z'] >= 0
            for axis, dimension, limit in [('x','w',p['width']),('y','d',p['depth']),('z','h',p['maxHeight'])]:
                assert a['position'][axis] + a['size'][dimension] <= limit + 1e-6
            for b in boxes[:i]:
                intersects = all(a['position'][axis] < b['position'][axis] + b['size'][dimension] - 1e-7 and b['position'][axis] < a['position'][axis] + a['size'][dimension] - 1e-7 for axis,dimension in [('x','w'),('y','d'),('z','h')])
                assert not intersects
        decision_count += len(row['decisions'])
        key = (row['config']['cycleSeconds'], row['seed'])
        groups.setdefault(key, []).append(row['algorithm'])
        streams.setdefault(key, []).append(row['inputFingerprint'])
        placements[(row['algorithm'], row['seed'], row['config']['cycleSeconds'])] = [{'id':b['id'],'position':b['position'],'size':b['size']} for b in boxes]
    assert len(groups) == 14 and all(len(set(a)) == 6 for a in groups.values())
    assert all(len(set(a)) == 1 for a in streams.values())
    assert decision_count == 6048
    assert sum(1 for _ in csv.DictReader((OUT/'trials.csv').open())) == 84
    assert sum(1 for _ in csv.DictReader((OUT/'decisions.csv').open())) == 6048
    identical = sum(placements[(a,s,10)] == placements[(a,s,12)] for a in summary['config']['algorithms'] for s in summary['config']['selectionSeeds'] + summary['config']['evaluationSeeds'])
    audit = {'schema':'alps-benchmark-audit/1', 'completedTrials':84, 'recordedDecisions':decision_count,
             'independentChecks':['volume/fill','mass-weighted CoG','box identity/count conservation','pallet boundary','pairwise axis-aligned overlap','identical input fingerprints per seed/cycle','source hashes unchanged','CSV/JSON row counts'],
             'samePlacementsAcrossCyclePairs':identical, 'cyclePairs':42,
             'summarySha256':sha(OUT/'summary.json'),'indexSha256':sha(OUT/'index.json'),'rawFiles':raw_files,
             'limitations':['No dynamic transport stability, physical robot, sensing, communication, full IK or global optimality certificate.']}
    (OUT/'audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k:v for k,v in audit.items() if k!='rawFiles'}, ensure_ascii=False))

if __name__ == '__main__': main()
