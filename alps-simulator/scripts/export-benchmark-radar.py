"""Derive six-axis presentation scores from the audited 1,400 saved trials.

This is a post-evaluation presentation score. It never replaces the frozen
four-component score, primary paired analysis, or an algorithm's decisions.
"""
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import mean, stdev

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/benchmark-1000'
RUN = SOURCE / 'evaluation-v2'
OUT = ROOT / 'public/benchmark-radar'
AXES = [
    {'id': 'acceptance', 'label': '적재량', 'weight': 40,
     'formula': '적재한 박스 부피 / 공급된 전체 박스 부피 × 100'},
    {'id': 'density', 'label': '밀도', 'weight': 25,
     'formula': '적재 부피 / (팔레트 면적 × 실제 사용 높이) × 100'},
    {'id': 'void', 'label': '내부 공극 효율', 'weight': 10,
     'formula': '적재 부피 / (적재 부피 + 기둥별 최상단 아래 공극) × 100'},
    {'id': 'floor', 'label': '바닥 활용', 'weight': 10,
     'formula': '바닥에 직접 닿는 박스 면적의 합집합 / 팔레트 면적 × 100'},
    {'id': 'sku', 'label': 'SKU 접촉', 'weight': 10,
     'formula': '같은 SKU끼리 맞닿은 면적 / 모든 박스 간 접촉 면적 × 100. 접촉이 없으면 0점'},
    {'id': 'speed', 'label': '계산 속도', 'weight': 5,
     'formula': 'max(0, 1 − 실행별 판단시간 P95 / 판단 예산 9,000ms) × 100'},
]
NAMES = {'blb': 'Bottom-Left-Back', 'capacity-compact': 'Compact',
         'strategy-greedy': 'Greedy', 'lookahead': 'Lookahead',
         'future-hybrid': 'Future-Aware Hybrid', 'floor-dense': 'ALPS Tetris',
         'cluster-layer': 'ALPS 군집'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quantile(values, q):
    values = sorted(values)
    x = q * (len(values) - 1)
    lo = int(x)
    return values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (x - lo)


def estimate(values):
    assert len(values) == 100 and all(math.isfinite(v) for v in values)
    center = mean(values)
    half = 1.9842169515086827 * stdev(values) / math.sqrt(len(values))
    return {'mean': center, 'ci95Low': center - half, 'ci95High': center + half}


def sku_contact(boxes):
    total = same = 0
    axes = [('x', 'w'), ('y', 'd'), ('z', 'h')]
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            for axis, size in axes:
                touching = (abs(a['position'][axis] + a['size'][size] - b['position'][axis]) < 1e-5
                            or abs(b['position'][axis] + b['size'][size] - a['position'][axis]) < 1e-5)
                if not touching:
                    continue
                area = 1
                for other, dimension in axes:
                    if other != axis:
                        area *= max(0, min(a['position'][other] + a['size'][dimension],
                                           b['position'][other] + b['size'][dimension])
                                    - max(a['position'][other], b['position'][other]))
                total += area
                if a['typeId'] == b['typeId']:
                    same += area
    return same / total if total else 0


def main():
    audit = json.loads((RUN / 'audit/audit.json').read_text())
    freeze = json.loads((RUN / 'freeze.json').read_text())
    previous = json.loads((SOURCE / 'score-summary.json').read_text())
    assert audit['complete'] and audit['auditedTrials'] == 1400
    assert not audit['auditErrors'] and audit['missingTrials'] == 0
    assert audit['freezeSignature'] == previous['freezeSignature'] == freeze['signature']
    scores = list(csv.DictReader((SOURCE / 'scores.csv').open()))
    audited = {(r['condition'], r['algorithm'], int(r['seed'])): r
               for r in csv.DictReader((RUN / 'audit/trials.csv').open())}
    by_key = {(r['condition'], r['algorithm'], int(r['seed'])): r for r in scores}
    assert len(scores) == len(by_key) == len(audited) == 1400
    grouped, times, input_hashes = defaultdict(list), defaultdict(list), {}
    trials = []
    paths = sorted((RUN / 'shards').glob('*/trials/*.json.gz'))
    assert len(paths) == 1400
    for path in paths:
        raw = json.loads(gzip.decompress(path.read_bytes()))
        trial = raw['trial']
        condition = raw['condition']['id'] if isinstance(raw['condition'], dict) else raw['condition']
        key = (condition, trial['algorithm'], trial['seed'])
        row = by_key[key]
        assert raw['signature'] == freeze['signature']
        assert sha(path) == row['traceSha256'] == audited[key]['traceSha256']
        assert trial['status'] == 'finished' and not trial['violations'] and not trial['unprocessed']
        assert len(trial['arrivals']) == len(trial['decisions']) == 30
        assert trial['config']['maxHeightMm'] == 1200
        pair = (condition, trial['seed'])
        input_hash = hashlib.sha256(json.dumps(trial['arrivals'], sort_keys=True).encode()).hexdigest()
        if pair in input_hashes:
            assert input_hashes[pair] == input_hash
        input_hashes[pair] = input_hash
        placements, metrics, pallet = trial['placements'], trial['metrics'], trial['scenario']['pallet']
        supplied = sum(b['size']['w'] * b['size']['d'] * b['size']['h'] for b in trial['arrivals'])
        volume = sum(b['size']['w'] * b['size']['d'] * b['size']['h'] for b in placements)
        height = max((b['position']['z'] + b['size']['h'] for b in placements), default=0)
        area = pallet['width'] * pallet['depth']
        floor = sum(b['size']['w'] * b['size']['d'] for b in placements if abs(b['position']['z']) < 1e-5) / area
        contact = sku_contact(placements)
        void = metrics['columnVoidMm3']
        decision_times = [d['decisionMs'] for d in trial['decisions']]
        assert all(d['searchBudgetMs'] == d['availableMs'] == 9000 for d in trial['decisions'])
        p95 = quantile(decision_times, .95)
        acceptance = volume / supplied
        density = volume / (area * height) if height else 0
        for field, value in [('supplyAcceptance', acceptance), ('envelopeFill', density),
                             ('floor', floor), ('sameSkuContact', contact),
                             ('columnVoidLiters', void / 1e6), ('count', len(placements))]:
            assert math.isclose(float(row[field]), value, rel_tol=1e-8, abs_tol=1e-7), (key, field)
        values = dict(acceptance=100 * acceptance, density=100 * density,
                      void=100 * volume / (volume + void) if volume + void else 0,
                      floor=100 * floor, sku=100 * contact,
                      speed=100 * max(0, min(1, 1 - p95 / 9000)))
        assert all(0 <= v <= 100 for v in values.values())
        total = sum(values[a['id']] * a['weight'] / 100 for a in AXES)
        item = {'condition': condition, 'algorithm': trial['algorithm'], 'seed': trial['seed'],
                'count': len(placements), 'volumeL': volume / 1e6, 'heightMm': height,
                'columnVoidL': void / 1e6, 'trialP95Ms': p95, 'frozenScore': float(row['score']),
                'sixAxisScore': total, **values}
        trials.append(item)
        grouped[key[:2]].append(item)
        times[key[:2]].extend(decision_times)
    assert len(input_hashes) == len(set(input_hashes.values())) == 200
    conditions = []
    for manifest in freeze['manifests']:
        condition = manifest['condition']
        rows = []
        for algorithm in freeze['algorithms']:
            group = grouped[condition['id'], algorithm]
            assert len(group) == 100 and len({r['seed'] for r in group}) == 100
            old = next(r for r in previous['summary'] if r['condition'] == condition['id'] and r['algorithm'] == algorithm)
            assert math.isclose(mean(r['frozenScore'] for r in group), old['score']['mean'], abs_tol=1e-8)
            rows.append({'algorithm': algorithm, 'name': NAMES[algorithm], 'n': len(group),
                         'axes': {a['id']: estimate([r[a['id']] for r in group]) for a in AXES},
                         'score': estimate([r['sixAxisScore'] for r in group]),
                         'frozenScore': old['score'],
                         'raw': {k: mean(r[k] for r in group) for k in
                                 ['count', 'volumeL', 'heightMm', 'columnVoidL', 'trialP95Ms']},
                         'pooledP95Ms': quantile(times[condition['id'], algorithm], .95)})
        conditions.append({**condition, 'width': 1200, 'depth': 1000, 'n': 100, 'runs': 700, 'rows': rows})
    result = {'schema': 'alps-six-axis-benchmark/1', 'complete': True, 'auditedRuns': 1400,
              'sourceCommit': freeze['sourceGitCommit'], 'freezeSignature': freeze['signature'],
              'sourceHashes': {str(p.relative_to(ROOT)): sha(p) for p in
                               [RUN / 'audit/audit.json', RUN / 'audit/trials.csv', SOURCE / 'scores.csv']},
              'plan': {'postEvaluation': True, 'range': [0, 100], 'axes': AXES,
                       'aggregation': 'Score each trial, then average 100 independent arrival orders within each condition and policy.',
                       'uncertainty': 'Unadjusted descriptive Student t 95% intervals across 100 arrival orders. Not primary superiority inference.',
                       'timing': 'Per-trial P95 uses linear interpolation over 30 observed decisionMs values; score uses fixed 9000ms budget. Shared CPU measurement.',
                       'frozenScore': 'Original score remains acceptance 60 + floor 15 + SKU 15 + deadline compliance 10.',
                       'interpretation': 'Post-evaluation presentation index with packing-first weights, not an industry standard or evidence of universal optimality.'},
              'conditions': conditions}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'index.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    with (OUT / 'trials.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(trials[0]), lineterminator='\n')
        writer.writeheader(); writer.writerows(sorted(trials, key=lambda r: (r['condition'], r['algorithm'], r['seed'])))
    (OUT / 'score-plan.json').write_text(json.dumps(result['plan'], ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'verifiedTrials': len(trials), 'sameInputSets': len(input_hashes), 'conditions': len(conditions),
                      'rows': sum(len(c['rows']) for c in conditions), 'scoreWeights': {a['id']: a['weight'] for a in AXES}}))


if __name__ == '__main__':
    main()
