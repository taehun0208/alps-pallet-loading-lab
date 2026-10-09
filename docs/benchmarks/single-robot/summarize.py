"""Summarise one single-robot run ID (schema single-robot-run/2).

Usage: python3 docs/benchmarks/single-robot/summarize.py <run-dir> <out-dir>
<run-dir> holds manifest.json and runs-*.jsonl written by scripts/single-robot-benchmark.ts.

Integrity (exit code 2, nothing written): duplicate run keys, a configuration hash that differs
from the manifest, planned runs missing, or runs not in the manifest.
Evaluation order: fitness gate -> performance -> stability/time trade-offs. No composite score.
Percentiles pool every decision sample; samples from concurrent runs are reported separately.
Unmeasured values stay null.
"""
import json, sys, glob, os, math, collections

REPORT_DEADLINE_MS = 250
# Event outcome classes. 'isolated-unplaceable' is not a correct isolation: a box that should be
# loadable was not loaded. 'placed-then-quarantined' ended on a quarantined pallet.
RECOVERED = {'placed', 'remeasured-placed', 'count-corrected', 'verified-continue'}
ISOLATED = {'isolated-damaged', 'pallet-quarantined'}
NOT_RECOVERED = {'isolated-unplaceable', 'placed-then-quarantined', 'unresolved'}

def fail(kind, detail):
    sys.stderr.write(f'{kind}: {detail}\n'); sys.exit(2)

run_dir, out_dir = sys.argv[1], sys.argv[2]
manifest = json.load(open(os.path.join(run_dir, 'manifest.json')))
runs = [json.loads(l) for f in sorted(glob.glob(os.path.join(run_dir, 'runs-*.jsonl'))) for l in open(f) if l.strip()]

# ---- integrity -------------------------------------------------------------------------------
expected = {e['key']: e['configHash'] for e in manifest['expected']}
seen = collections.Counter(r['key'] for r in runs)
dups = [k for k, n in seen.items() if n > 1]
if dups: fail('DUPLICATE', f'{len(dups)} keys, e.g. {dups[0]}')
bad = [r['key'] for r in runs if r.get('schema') != 'single-robot-run/2']
if bad: fail('SCHEMA', bad[0])
unexpected = [r['key'] for r in runs if r['key'] not in expected]
if unexpected: fail('UNEXPECTED', f'{len(unexpected)} runs not in manifest, e.g. {unexpected[0]}')
wrong_run = [r['key'] for r in runs if r.get('runId') != manifest['runId'] or r.get('phase') != manifest.get('phase', r.get('phase'))]
if wrong_run: fail('RUN MISMATCH', f'{len(wrong_run)} runs from another run ID or phase, e.g. {wrong_run[0]}')
inputs = {e['key']: e.get('inputHash') for e in manifest['expected']}
bad_input = [r['key'] for r in runs if inputs.get(r['key']) is not None and r.get('inputHash') != inputs[r['key']]]
if bad_input: fail('INPUT MISMATCH', f'{len(bad_input)} runs, e.g. {bad_input[0]}')
mismatch = [r['key'] for r in runs if r['configHash'] != expected[r['key']]]
if mismatch: fail('CONFIG MISMATCH', f'{len(mismatch)} runs, e.g. {mismatch[0]}')
missing = [k for k in expected if k not in seen]
if missing: fail('MISSING', f'{len(missing)} planned runs, e.g. {missing[0]}')

# ---- helpers ---------------------------------------------------------------------------------
def vals(rs, f):
    out = []
    for r in rs:
        v = f(r)
        if v is not None and not (isinstance(v, float) and math.isnan(v)): out.append(v)
    return out
def mean(xs): return sum(xs) / len(xs) if xs else None
def mn(xs): return min(xs) if xs else None
def mx(xs): return max(xs) if xs else None
def pct(xs, p):
    if not xs: return None
    s = sorted(xs); return s[min(len(s) - 1, max(0, math.ceil(len(s) * p) - 1))]
def worst_status(statuses):
    return 'fail' if 'fail' in statuses else 'unverified' if 'unverified' in statuses else 'pass'

by = collections.defaultdict(list)
for r in runs: by[(r['situation'], r['policy'])].append(r)
situations = list(dict.fromkeys(r['situation'] for r in runs))
policies = list(dict.fromkeys(r['policy'] for r in runs))

def agg(rs):
    gs = sorted({g for r in rs for g in r['stability']['transport']['loose']}, key=float)
    checks = collections.defaultdict(list); violations = collections.Counter(); outcomes = collections.Counter(); feas = collections.Counter(); closes = collections.Counter()
    for r in rs:
        for k, v in r['fitness'].get('checks', {}).items(): checks[k].append(v)
        violations.update(r['fitness']['violations']); outcomes.update(r['robustness']['outcomes'] if 'outcomes' in r['robustness'] else {})
        feas.update(r['robot'].get('feasibilityRejections', {})); closes.update(r['performance'].get('closeReasons', {}))
    quiet = [r for r in rs if r['compute'].get('concurrency', r.get('environment', {}).get('concurrency')) == 1]
    busy = [r for r in rs if r not in quiet]
    def compute(sel):
        s = [x for r in sel for x in r['compute']['samplesMs']]
        first = [x for r in sel for x, k in zip(r['compute']['samplesMs'], r['compute'].get('sampleKinds', ['first'] * len(r['compute']['samplesMs']))) if k == 'first']
        return {'runs': len(sel), 'samples': len(s), 'firstDecisionSamples': len(first), 'firstDecisionP95Ms': pct(first, .95), 'p50Ms': pct(s, .5), 'p95Ms': pct(s, .95), 'p99Ms': pct(s, .99), 'maxMs': mx(s),
                'withinReportDeadlineShare': (sum(1 for x in s if x <= REPORT_DEADLINE_MS) / len(s)) if s else None, 'reportDeadlineMs': REPORT_DEADLINE_MS}
    completions = vals(rs, lambda r: r['performance']['completionRate'])
    completed = sum(r['performance'].get('placedTotal', r['performance']['completed']) for r in rs)
    recovered = sum(n for k, n in outcomes.items() if k in RECOVERED); isolated = sum(n for k, n in outcomes.items() if k in ISOLATED); not_recovered = sum(n for k, n in outcomes.items() if k in NOT_RECOVERED)
    return {
        'runs': len(rs), 'datasets': sorted(r['seeds']['dataset'] for r in rs),
        'fitness': {'pass': sum(r['fitness']['status'] == 'pass' for r in rs), 'fail': sum(r['fitness']['status'] == 'fail' for r in rs),
                    'checks': {k: worst_status(v) for k, v in checks.items()}, 'violations': dict(violations),
                    'unverified': sorted(k for k, v in checks.items() if worst_status(v) == 'unverified'),
                    'quarantinedPallets': sum(r['fitness'].get('quarantinedPallets', 0) for r in rs)},
        'performance': {'completionMean': mean(completions), 'completionMin': mn(completions), 'unplaceable': mean(vals(rs, lambda r: r['performance']['unplaceable'])),
                        'pallets': mean(vals(rs, lambda r: r['performance']['pallets'])), 'utilization': mean(vals(rs, lambda r: r['performance']['utilization'])),
                        'closedFillMean': mean(vals(rs, lambda r: r['performance']['closedFillMean'])), 'closeReasons': dict(closes)},
        'stability': {'minSupportRatio': mn(vals(rs, lambda r: r['stability']['minSupportRatio'])), 'minLocalReserveMm': mn(vals(rs, lambda r: r['stability']['minLocalReserveMm'])),
                      'meanComOffset': mean(vals(rs, lambda r: r['stability']['meanComOffset'])), 'worstComOffset': mx(vals(rs, lambda r: r['stability']['worstComOffset'])),
                      'maxComHeightMm': mx(vals(rs, lambda r: r['stability']['maxComHeightMm'])), 'maxLoadUtilization': mx(vals(rs, lambda r: r['stability'].get('maxLoadUtilization'))),
                      'transportLoose': {g: mn(vals(rs, lambda r, g=g: r['stability']['transport']['loose'].get(g))) for g in gs},
                      'transportWrapped': {g: mn(vals(rs, lambda r, g=g: r['stability']['transport'].get('wrapped', {}).get(g))) for g in gs},
                      'transportPalletUnit': None if any(r['stability']['transport'].get('palletUnit') is None for r in rs) else 'see runs'},
        'robot': {'placementSecondsPerBox': (sum(r['robot']['placementSeconds'] for r in rs) / completed) if completed else None,
                  'rehandles': mean(vals(rs, lambda r: r['robot']['rehandles'])), 'commitRejected': sum(r['robot'].get('commitRejected', 0) for r in rs),
                  'excluded': sorted({x for r in rs for x in r['robot']['excluded']}), 'feasibilityRejections': dict(feas)},
        'compute': compute(quiet), 'computeContended': compute(busy) if busy else None,
        'effort': {k: mean(vals(rs, lambda r, k=k: r.get('effort', {}).get(k))) for k in ['plannerCalls', 'candidatesChecked', 'constraintChecks', 'searchNodes', 'rolloutCalls']},
        'robustness': {'successRate': sum(bool(r['robustness'].get('success')) for r in rs) / len(rs), 'completionP5': pct(completions, .05),
                       'events': sum(r['robustness']['events'] for r in rs), 'outcomes': dict(outcomes), 'recovered': recovered, 'isolatedCorrectly': isolated,
                       'unresolved': outcomes.get('unresolved', 0), 'notRecovered': not_recovered,
                       'recoveryReplans': sum(x['replans'] for r in rs for x in r['robustness'].get('records', [])),
                       'recoveryPlannerMs': sum(x['plannerMs'] for r in rs for x in r['robustness'].get('records', []))},
    }

table = {s: {p: agg(by[(s, p)]) for p in policies if by[(s, p)]} for s in situations}

# ---- evaluation order: fitness gate -> performance -> trade-offs --------------------------------
INF = float('inf')
def neg(x): return -x if x is not None else INF
def pos(x): return x if x is not None else INF
def g03(d): return d.get('0.3') if d else None
VIEWS = {
    'performance': ('성과(완료·팔레트)', lambda a: (a['fitness']['fail'], neg(a['performance']['completionMean']), pos(a['performance']['unplaceable']), pos(a['performance']['pallets']), neg(a['performance']['utilization']))),
    'stability': ('안정성', lambda a: (a['fitness']['fail'], len(a['fitness']['unverified']), neg(a['stability']['minLocalReserveMm']), neg(g03(a['stability']['transportLoose'])), pos(a['stability']['worstComOffset']), pos(a['stability']['meanComOffset']))),
    'time': ('작업·계산시간', lambda a: (a['fitness']['fail'], pos(a['robot']['placementSecondsPerBox']), pos(a['compute']['p95Ms'] if a['compute']['samples'] else a['computeContended']['p95Ms'] if a['computeContended'] else None))),
}
rankings = {s: {v: [p for p, _ in sorted(table[s].items(), key=lambda kv: f(kv[1]))] for v, (_, f) in VIEWS.items()} for s in situations}
def pareto(rows):
    ok = {p: a for p, a in rows.items() if a['fitness']['fail'] == 0}
    keys = [lambda a: neg(a['performance']['completionMean']), lambda a: pos(a['performance']['pallets']), lambda a: pos(a['stability']['worstComOffset']),
            lambda a: neg(a['stability']['minLocalReserveMm']), lambda a: pos(a['robot']['placementSecondsPerBox'])]
    front = []
    for p, a in ok.items():
        if not any(all(k(b) <= k(a) for k in keys) and any(k(b) < k(a) for k in keys) for q, b in ok.items() if q != p): front.append(p)
    return front
fronts = {s: pareto(table[s]) for s in situations}

pair = {(r['situation'], r['seeds']['dataset'], r['policy']): r for r in runs}
def paired(a, b):
    """Pallet counts are compared only for pairs that completed the same number of boxes."""
    out = {'pairs': 0, 'sameCompleted': 0, 'fewerPallets': 0, 'samePallets': 0, 'morePallets': 0, 'completionDiffers': 0, 'dPallets': [], 'dWorstCom': [], 'dCompletion': [], 'dBoxesPerPallet': []}
    for s in situations:
        for d in sorted({r['seeds']['dataset'] for r in runs if r['situation'] == s}):
            x, y = pair.get((s, d, a)), pair.get((s, d, b))
            if not x or not y: continue
            out['pairs'] += 1
            px, py = x['performance'], y['performance']
            if px['completionRate'] is not None and py['completionRate'] is not None: out['dCompletion'].append(px['completionRate'] - py['completionRate'])
            if x['stability']['worstComOffset'] is not None and y['stability']['worstComOffset'] is not None: out['dWorstCom'].append(x['stability']['worstComOffset'] - y['stability']['worstComOffset'])
            if px['pallets'] and py['pallets']: out['dBoxesPerPallet'].append(px['completed'] / px['pallets'] - py['completed'] / py['pallets'])
            if px['completed'] != py['completed']: out['completionDiffers'] += 1; continue
            out['sameCompleted'] += 1; dp = px['pallets'] - py['pallets']; out['dPallets'].append(dp)
            out['fewerPallets' if dp < 0 else 'morePallets' if dp > 0 else 'samePallets'] += 1
    return {'pairs': out['pairs'], 'sameCompleted': out['sameCompleted'], 'fewerPallets': out['fewerPallets'], 'samePallets': out['samePallets'], 'morePallets': out['morePallets'],
            'completionDiffers': out['completionDiffers'], 'meanDeltaPalletsSameCompleted': mean(out['dPallets']), 'meanDeltaBoxesPerPallet': mean(out['dBoxesPerPallet']),
            'meanDeltaWorstCom': mean(out['dWorstCom']), 'meanDeltaCompletion': mean(out['dCompletion'])}
cog = {p: paired(p + '+cog', p) for p in policies if not p.endswith('+cog') and p + '+cog' in policies}
vs_greedy = {p: paired(p, 'strategy-greedy') for p in policies if p != 'strategy-greedy'} if 'strategy-greedy' in policies else {}

os.makedirs(out_dir, exist_ok=True)
summary = {'runId': manifest['runId'], 'phase': manifest.get('phase'), 'source': manifest.get('source'), 'cogWeights': manifest.get('cogWeights'), 'runs': len(runs),
           'situations': situations, 'policies': policies, 'table': table, 'rankings': rankings, 'pareto': fronts, 'cogPaired': cog, 'vsStrategyGreedy': vs_greedy,
           'views': {k: v[0] for k, v in VIEWS.items()}}
json.dump(summary, open(os.path.join(out_dir, 'summary.json'), 'w'), ensure_ascii=False, indent=1)

def f(x, n=2):
    return '—' if x is None else (f'{x:.{n}f}' if isinstance(x, (int, float)) else str(x))
L = [f"# 단일 로봇 비교 표 · {manifest['runId']} (자동 생성)", '',
     '평가 순서: 적합성(실패 정책은 순위에서 뒤로) → 성과 → 안정성·시간 상충. 종합 점수 없음. "—"는 미측정/해당 없음.',
     '무게중심 = 중심 대비 치우침(반폭 대비). 국부 여유 = 정적 기준 최소 국부 무게중심 여유(mm). 묶지 않은 운반 여유 = 0.3g 접촉면별 최소 전도 여유(mm). 경로 = 박스당 배치 경로 시간(모델값).', '']
for s in situations:
    L += [f'## {s}', '', '| 정책 | 적합성 통과/실패 | 완료율 평균(최저) | 못 놓음 | 팔레트 | 적재율 | 최소 지지율 | 국부 여유 | 운반 0.3g 묶지 않음 | 무게중심 최악 | 경로 s/박스 | 재취급 | p95 ms(단독) | 사건 복구/정상 격리/미복구 |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|']
    for p in rankings[s]['performance']:
        a = table[s][p]; pf = a['performance']; st = a['stability']; rb = a['robustness']
        L.append(f"| {p} | {a['fitness']['pass']}/{a['fitness']['fail']} | {f(pf['completionMean'],3)} ({f(pf['completionMin'],3)}) | {f(pf['unplaceable'],1)} | {f(pf['pallets'],1)} | {f(pf['utilization'],3)} | {f(st['minSupportRatio'],2)} | {f(st['minLocalReserveMm'],0)} | {f(g03(st['transportLoose']),0)} | {f(st['worstComOffset'],3)} | {f(a['robot']['placementSecondsPerBox'],2)} | {f(a['robot']['rehandles'],1)} | {f(a['compute']['p95Ms'],1)} | {rb['recovered']}/{rb['isolatedCorrectly']}/{rb['notRecovered']} |")
    L += ['', ' / '.join(f"{VIEWS[v][0]} 1~3위: {', '.join(rankings[s][v][:3])}" for v in VIEWS), '', f"파레토(적합성 통과 정책 중 어느 지표에서도 다른 정책에 지지 않음): {', '.join(fronts[s]) or '없음'}", '']
if cog:
    L += ['## 무게중심 보완 전후 (같은 상황·데이터 짝)', '', '팔레트 수는 완료 박스 수가 같은 짝에서만 비교한다.', '', '| 정책 | 짝 | 완료 수 다름 | 팔레트 감소/같음/증가 | 팔레트 변화(같은 완료) | 팔레트당 박스 변화 | 최악 무게중심 변화 | 완료율 변화 |', '|---|---:|---:|---|---:|---:|---:|---:|']
    for p, d in cog.items(): L.append(f"| {p} | {d['pairs']} | {d['completionDiffers']} | {d['fewerPallets']}/{d['samePallets']}/{d['morePallets']} | {f(d['meanDeltaPalletsSameCompleted'])} | {f(d['meanDeltaBoxesPerPallet'])} | {f(d['meanDeltaWorstCom'],3)} | {f(d['meanDeltaCompletion'],3)} |")
open(os.path.join(out_dir, 'tables.md'), 'w').write('\n'.join(L) + '\n')
print(f"OK {len(runs)} runs · {len(situations)} situations · {len(policies)} policies -> {out_dir}")
