"""Export measured replays and aggregate evidence for the existing three screens."""
import gzip
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/benchmark-1000'
OUT = ROOT / 'public/presentation-evidence'
audit = json.loads((SOURCE / 'evaluation-v2/audit/audit.json').read_text())
freeze = json.loads((SOURCE / 'evaluation-v2/freeze.json').read_text())
scores = json.loads((SOURCE / 'score-summary.json').read_text())
assert audit['complete'] and not audit['auditErrors']
assert scores['complete'] and scores['actualTrials'] == 1400
OUT.mkdir(parents=True, exist_ok=True)
algorithms = ['capacity-compact', 'floor-dense', 'cluster-layer']
studies = []
for manifest in freeze['manifests']:
    condition = manifest['condition']
    cid = condition['id']
    # Fixed manifest positions, selected without inspecting outcome quality.
    orders = [manifest['orders'][i] for i in (0, 24, 49, 74, 99)]
    replays = []
    for order in orders:
        seed = order['seed']
        pair_inputs = []
        for algorithm in algorithms:
            paths = list((SOURCE / 'evaluation-v2/shards').glob(f'*/trials/{cid}-{seed}-{algorithm}.json.gz'))
            assert len(paths) == 1
            raw = json.loads(gzip.decompress(paths[0].read_bytes()))
            trial = raw['trial']
            assert trial['status'] == 'finished' and not trial['violations']
            assert trial['seed'] == seed and trial['algorithm'] == algorithm
            pair_inputs.append(trial['arrivals'])
            name = f'{cid}-{seed}-{algorithm}.json'
            (OUT / name).write_text(json.dumps(trial, ensure_ascii=False, separators=(',', ':')))
            replays.append({'seed': seed, 'algorithm': algorithm, 'inputFingerprint': trial['inputFingerprint'], 'url': f'/presentation-evidence/{name}'})
        assert all(arrivals == pair_inputs[0] for arrivals in pair_inputs)
    studies.append({
        'id': cid, 'kind': 'measured', 'label': f"우리 검사 · {condition['skus']} SKU",
        'skus': condition['skus'], 'boxes': 30, 'height': 1200, 'width': 1200, 'depth': 1000,
        'n': 100, 'runs': 700, 'variation': 'SKU 규격·재고 고정, 서로 다른 입고 순서 100개',
        'summary': [r for r in scores['summary'] if r['condition'] == cid],
        'seeds': [o['seed'] for o in orders], 'replays': replays,
    })
index = {
    'schema': 'alps-presentation-evidence/1', 'auditedRuns': 1400,
    'sourceGitCommit': freeze['sourceGitCommit'], 'freezeSignature': freeze['signature'],
    'auditSha256': hashlib.sha256((SOURCE / 'evaluation-v2/audit/audit.json').read_bytes()).hexdigest(),
    'replaySelection': '동결 입력 목록의 1·25·50·75·100번째 실행. 결과의 좋고 나쁨을 기준으로 선정하지 않음.',
    'scoreWeights': [['공급 부피 수용률', 60], ['바닥 접촉', 15], ['동일 SKU 접촉', 15], ['기한 준수', 10]],
    'studies': studies,
}
(OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
for filename in ('scores.csv', 'score-summary.json'):
    shutil.copy2(SOURCE / filename, OUT / filename)
for filename in ('audit.json', 'paired-effects.csv', 'summary.md'):
    shutil.copy2(SOURCE / 'evaluation-v2/audit' / filename, OUT / filename)
for filename in ('packing-density.png', 'operational-score.png'):
    shutil.copy2(SOURCE / 'figures' / filename, OUT / filename)
guide = ROOT / 'docs/ALPS-군집-재현-가이드.md'
if guide.exists():
    shutil.copy2(guide, OUT / 'reproduction-guide.md')
print(json.dumps({'studies': len(index['studies']), 'measuredRuns': 1400, 'replays': sum(len(s['replays']) for s in studies)}))
