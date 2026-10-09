#!/usr/bin/env python3
"""Independent raw-trace validation and paired analysis (stdlib; optional SciPy)."""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist, mean, stdev

try:
    from scipy.stats import t as scipy_t
except ImportError:
    scipy_t = None

EPS = 1e-6


def js_json(value, sort_keys=False):
    # Frozen source/manifests contain finite small numbers, not exponent extremes.
    def numbers(v):
        if isinstance(v, float) and v.is_integer():
            return int(v)
        if isinstance(v, list):
            return [numbers(x) for x in v]
        if isinstance(v, dict):
            return {k: numbers(x) for k, x in v.items()}
        return v
    return json.dumps(numbers(value), ensure_ascii=False, separators=(',', ':'), sort_keys=sort_keys, allow_nan=False)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint(value):
    h = 2166136261
    # JS for...of iterates code points and charCodeAt(0) uses the first UTF16 unit.
    for c in js_json(value, sort_keys=True):
        code = ord(c)
        if code > 0xffff:
            code = 0xd800 + ((code - 0x10000) >> 10)
        h = ((h ^ code) * 16777619) & 0xffffffff
    return f'{h:08x}'


def quantile(values, probability):
    if not values:
        return None
    a = sorted(values)
    x = probability * (len(a) - 1)
    i = int(x)
    return a[i] + (a[min(i + 1, len(a) - 1)] - a[i]) * (x - i)


def beta_fraction(a, b, x):
    qab, qap, qam = a + b, a + 1, a - 1
    floor = 1e-300
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / (d if abs(d) >= floor else floor)
    h = d
    for m in range(1, 10001):
        aa = m * (b - m) * x / ((qam + 2*m) * (a + 2*m))
        d = 1 + aa*d
        c = 1 + aa/c
        d = 1 / (d if abs(d) >= floor else floor)
        c = c if abs(c) >= floor else floor
        h *= d*c
        aa = -(a + m) * (qab + m) * x / ((a + 2*m) * (qap + 2*m))
        d = 1 + aa*d
        c = 1 + aa/c
        d = 1 / (d if abs(d) >= floor else floor)
        c = c if abs(c) >= floor else floor
        delta = d*c
        h *= delta
        if abs(delta - 1) < 3e-14:
            return h
    raise ArithmeticError('Incomplete-beta continued fraction failed to converge')


def regularized_beta(x, a, b):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    factor = math.exp(math.lgamma(a+b) - math.lgamma(a) - math.lgamma(b) + a*math.log(x) + b*math.log1p(-x))
    if x < (a+1)/(a+b+2):
        return factor * beta_fraction(a, b, x) / a
    return 1 - factor * beta_fraction(b, a, 1-x) / b


def t_two_sided(statistic, df):
    if scipy_t is not None:
        return float(2 * scipy_t.sf(abs(statistic), df))
    if math.isinf(statistic):
        return 0.0
    return max(0.0, min(1.0, regularized_beta(df/(df+statistic*statistic), df/2, .5)))


def t_critical(probability, df):
    if scipy_t is not None:
        return float(scipy_t.ppf(probability, df))
    if df >= 999:
        # Cornish–Fisher expansion through df^-4; df=999 is the planned analysis.
        z = NormalDist().inv_cdf(probability)
        return (z + (z**3+z)/(4*df) + (5*z**5+16*z**3+3*z)/(96*df**2)
                + (3*z**7+19*z**5+17*z**3-15*z)/(384*df**3)
                + (79*z**9+776*z**7+1482*z**5-1920*z**3-945*z)/(92160*df**4))
    target = 2*(1-probability)
    low, high = 0.0, 1.0
    while t_two_sided(high, df) > target:
        high *= 2
    for _ in range(80):
        mid = (low+high)/2
        if t_two_sided(mid, df) > target:
            low = mid
        else:
            high = mid
    return (low+high)/2


def volume(box):
    return math.prod(box['size'][x] for x in ('w', 'd', 'h'))


def close(a, b):
    return isinstance(a, (int, float)) and math.isfinite(a) and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-6)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def audit_trial(raw, freeze, manifests, path):
    require(raw['signature'] == freeze['signature'], 'Freeze signature mismatch')
    trial = raw['trial']
    condition, algorithm, seed = raw['condition'], trial['algorithm'], trial['seed']
    require(condition in manifests, 'Unexpected condition')
    require(algorithm in freeze['algorithms'], 'Unexpected algorithm')
    manifest = manifests[condition]
    order = manifest['by_seed'].get(seed)
    require(order is not None, 'Seed absent from frozen manifest')
    require(path.name == f'{condition}-{seed}-{algorithm}.json.gz', 'Filename identity mismatch')
    require(trial['id'] == f"cycle-{freeze['config']['cycleSeconds']}:{seed}:{algorithm}", 'Trial ID mismatch')
    require(trial['config'] == freeze['config'], 'Trial configuration differs from freeze')
    scenario = trial['scenario']
    expected_scenario = dict(manifest['scenario'])
    expected_scenario['pallet'] = {**expected_scenario['pallet'], 'maxHeight': freeze['config']['maxHeightMm']}
    expected_scenario['arrival'] = {'seed': seed, 'pattern': 'random-draw'}
    expected_scenario['supplyMode'] = 'arrival'
    require(scenario == expected_scenario, 'Trial scenario differs from frozen workload')
    arrivals, placed = trial['arrivals'], trial['placements']
    unplaced, unprocessed, decisions = trial['unplaced'], trial['unprocessed'], trial['decisions']
    require([a['typeId'] for a in arrivals] == order['sequence'], 'Arrival sequence mismatch')
    require(len(arrivals) == manifest['condition']['boxes'], 'Dynamic box count mismatch')
    arrival_ids = [a['id'] for a in arrivals]
    require(len(set(arrival_ids)) == len(arrivals), 'Duplicate arrival IDs')
    by_id = {a['id']: a for a in arrivals}
    types = {t['id']: t for t in scenario['types']}
    require(Counter(a['typeId'] for a in arrivals) == Counter({k: v['quantity'] for k, v in types.items()}), 'SKU inventory mismatch')
    for a in arrivals:
        require(a['typeId'] in types and a['size'] == types[a['typeId']]['size'], 'Arrival geometry differs from SKU')
        require(a['weight'] == types[a['typeId']]['weight'], 'Arrival mass differs from SKU')
        require(all(isinstance(v, (int,float)) and math.isfinite(v) and v > 0 for v in a['size'].values()), 'Invalid arrival dimensions')
    partition = placed + unplaced + unprocessed
    require(Counter(a['id'] for a in partition) == Counter(arrival_ids), 'Box conservation failure')
    require(len(decisions) + len(unprocessed) == len(arrivals), 'Processed count mismatch')
    require([d['box'] for d in decisions] == arrivals[:len(decisions)], 'Decision arrival identity/order mismatch')
    require(unprocessed == arrivals[len(decisions):], 'Unprocessed suffix mismatch')
    require([d['index'] for d in decisions] == list(range(len(decisions))), 'Decision index mismatch')
    require([d['box'] for d in decisions if not d['accepted']] == unplaced, 'Rejected boxes mismatch')
    require([d['box']['id'] for d in decisions if d['accepted']] == [p['id'] for p in placed], 'Accepted boxes mismatch')
    require(trial['status'] in ('finished','error','cancelled'), 'Unknown trial status')
    require(trial['status'] != 'finished' or not unprocessed, 'Finished trial has unprocessed cargo')
    pending = {k: t['quantity'] for k, t in types.items()}
    times = []
    for d in decisions:
        pending[d['box']['typeId']] -= 1
        require(d['remaining'] == pending, 'Decision remaining-inventory mismatch')
        for field in ('decisionMs','planningMs','validationMs','availableMs','searchBudgetMs'):
            require(isinstance(d[field], (int,float)) and math.isfinite(d[field]) and d[field] >= 0, f'Invalid {field}')
        times.append(d['decisionMs'])
        require(not d['accepted'] or d['validDeadline'], 'Accepted box missed deadline')
        if d['accepted']:
            p = d['placement']
            require(p['id'] == d['box']['id'], 'Decision placement identity mismatch')
            require(d['recognitionMs'] + d['decisionMs'] + d['validationMs'] <= trial['config']['cycleSeconds']*1000 + EPS, 'Accepted placement outside cycle deadline')
    pallet = scenario['pallet']
    axes = [('x','w','width'),('y','d','depth'),('z','h','maxHeight')]
    for i, p in enumerate(placed):
        original = by_id[p['id']]
        require(p['typeId'] == original['typeId'] and p['weight'] == original['weight'], 'Placed box identity/mass differs')
        require(sorted(p['size'].values()) == sorted(original['size'].values()), 'Placed box changed dimensions/volume')
        for axis, dimension, bound in axes:
            require(all(isinstance(x,(int,float)) and math.isfinite(x) for x in [p['position'][axis],p['size'][dimension]]), 'Nonfinite placement')
            require(p['position'][axis] >= -EPS and p['position'][axis] + p['size'][dimension] <= pallet[bound]+EPS, 'Placement outside pallet bounds')
        for q in placed[:i]:
            overlap = all(p['position'][a]+p['size'][d] > q['position'][a]+EPS and q['position'][a]+q['size'][d] > p['position'][a]+EPS for a,d,_ in axes)
            require(not overlap, f"Placement overlap {p['id']} / {q['id']}")
    supplied = sum(volume(a) for a in arrivals)
    placed_volume = sum(volume(p) for p in placed)
    capacity = pallet['width']*pallet['depth']*pallet['maxHeight']
    metrics = trial['metrics']
    misses = sum(not d['validDeadline'] for d in decisions)
    fallbacks = sum(bool(d['fallback']) for d in decisions)
    for field, expected in {'count':len(placed),'total':len(arrivals),'volumeMm3':placed_volume,'fill':placed_volume/capacity,
                            'deadlineMisses':misses,'fallbackCount':fallbacks,'computeMs':sum(times)}.items():
        require(close(metrics[field], expected), f'Metric {field} mismatch')
    # The engine canonicalizer writes undefined optional observation fields as null.
    # JSON traces omit them; restore the documented ArrivalEnvironment fields.
    canonical_arrivals = [{**{k: None for k in ('packaging','maxLoadKg','maxLoadSource','maxLoadByAxis','handling','material','strengthFactor','friction')}, **a} for a in arrivals]
    require(trial['inputFingerprint'] == fingerprint({'scenario':scenario,'config':trial['config'],'arrivals':canonical_arrivals}), 'Input fingerprint mismatch')
    require(isinstance(raw['wallMs'],(int,float)) and math.isfinite(raw['wallMs']) and raw['wallMs'] >= 0, 'Invalid wall time')
    return {'condition':condition,'algorithm':algorithm,'seed':seed,'id':trial['id'],'status':trial['status'],
            'violations':len(trial['violations']),'count':len(placed),'total':len(arrivals),'unplaced':len(unplaced),'unprocessed':len(unprocessed),
            'suppliedVolumeMm3':supplied,'placedVolumeMm3':placed_volume,'supplyAcceptance':placed_volume/supplied if supplied else 0,
            'acceptedBoxFraction':len(placed)/len(arrivals) if arrivals else 0,'fill':placed_volume/capacity,'deadlineMisses':misses,
            'fallbackCount':fallbacks,'computeMs':sum(times),'wallMs':raw['wallMs'],'decisionCount':len(times),
            'inputFingerprint':trial['inputFingerprint'],'trace':str(path),'traceSha256':sha(path.read_bytes()),'_times':times,
            '_pairHash':sha(js_json({'scenario':scenario,'config':trial['config'],'arrivals':arrivals}, sort_keys=True).encode())}


def write_csv(path, rows):
    with path.open('w', newline='') as f:
        if rows:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


def run(args):
    root = args.root.resolve()
    output = (args.output or root/'audit').resolve()
    repo = Path(__file__).resolve().parents[1]
    errors, warnings = [], []
    freeze_path = root/'freeze.json'
    if not freeze_path.exists():
        choices = sorted(root.glob('shards/**/freeze.json'))
        require(bool(choices), 'No freeze.json found')
        freeze_path = choices[0]
    freeze = json.loads(freeze_path.read_text())
    require(freeze['schema'] in ('alps-paired-1000/1','alps-paired-1000/2'), 'Unsupported freeze schema')
    signature_keys = ('source','manifests','config','algorithms','execution') if freeze['schema'].endswith('/2') else ('source','manifests','config','algorithms')
    expected_signature = sha(js_json({k:freeze[k] for k in signature_keys}).encode())
    if freeze['signature'] != expected_signature:
        errors.append('Freeze signature does not hash source/manifests/config/algorithms/execution')
    source_paths = set()
    for item in freeze['source']:
        current_path = repo/item['path']
        snapshot_path = root/'source-snapshot'/item['path']
        path = snapshot_path if snapshot_path.exists() else current_path
        if snapshot_path.exists() and (not current_path.is_file() or sha(current_path.read_bytes()) != item['sha256']):
            warnings.append(f"Current working source differs from archived frozen snapshot: {item['path']}")
        if item['path'] in source_paths:
            errors.append(f"Duplicate frozen source path: {item['path']}")
        source_paths.add(item['path'])
        if not path.is_file() or sha(path.read_bytes()) != item['sha256']:
            errors.append(f"Frozen source hash mismatch: {item['path']}")
    for path in root.glob('shards/**/freeze.json'):
        other = json.loads(path.read_text())
        if other.get('signature') != freeze['signature']:
            errors.append(f'Shard freeze mismatch: {path}')
    manifests = {}
    for m in freeze['manifests']:
        cid = m['condition']['id']
        require(cid not in manifests, 'Duplicate condition manifest')
        seeds = [o['seed'] for o in m['orders']]
        sequences = [tuple(o['sequence']) for o in m['orders']]
        require(len(seeds) == freeze['n'] and len(set(seeds)) == len(seeds), 'Manifest seeds are not unique/count differs')
        require(len(set(sequences)) == len(sequences), 'Manifest SKU arrival sequences are not unique')
        counts = Counter({t['id']:t['quantity'] for t in m['scenario']['types']})
        require(sum(counts.values()) == m['condition']['boxes'], 'Manifest box count mismatch')
        require(len(counts) == m['condition']['skus'], 'Manifest SKU count mismatch')
        for order in m['orders']:
            require(Counter(order['sequence']) == counts, 'Manifest sequence inventory mismatch')
        manifests[cid] = {**m,'by_seed':dict(zip(seeds,m['orders']))}
    family = len(manifests)*(len(freeze['algorithms'])-1)
    require(freeze['protocol']['familySize'] == family, 'Frozen comparison-family size mismatch')
    require(freeze['protocol']['practicalThreshold'] == .02, 'Unexpected practical threshold')
    require('floor-dense' in freeze['algorithms'] and len(set(freeze['algorithms'])) == len(freeze['algorithms']), 'Duplicate policy or absent primary policy')
    expected = {(cid,a,o['seed']) for cid,m in manifests.items() for a in freeze['algorithms'] for o in m['orders']}
    paths = sorted(set(root.glob('trials/*.json.gz')) | set(root.glob('shards/**/trials/*.json.gz')))
    rows, seen, pair_hashes = [], set(), {}
    for path in paths:
        try:
            raw = json.loads(gzip.decompress(path.read_bytes()))
            row = audit_trial(raw,freeze,manifests,path)
            key = (row['condition'],row['algorithm'],row['seed'])
            require(key not in seen, f'Duplicate trial: {key}')
            pair = (row['condition'],row['seed'])
            require(pair not in pair_hashes or pair_hashes[pair] == row['_pairHash'], 'Cross-policy paired input mismatch')
            pair_hashes[pair] = row['_pairHash']
            seen.add(key)
            rows.append(row)
        except (KeyError,ValueError,TypeError,ArithmeticError,OverflowError,OSError) as exc:
            errors.append(f'{path.relative_to(root)}: {exc}')
    missing = expected - seen
    # Missing/corrupt records stay explicit; no zero imputation or success-only filter.
    complete = not missing and not errors
    if missing:
        warnings.append(f'{len(missing)} expected trials missing or unauditable; all summaries are preliminary')
    groups = defaultdict(list)
    for row in rows:
        groups[row['condition'],row['algorithm']].append(row)
    summary = []
    for cid in manifests:
        for algorithm in freeze['algorithms']:
            group = groups[cid,algorithm]
            times = [v for r in group for v in r['_times']]
            status = Counter(r['status'] for r in group)
            result = {'condition':cid,'algorithm':algorithm,'expectedTrials':freeze['n'],'auditedTrials':len(group),
                      'missingTrials':freeze['n']-len(group),'finishedTrials':status['finished'],'errorTrials':status['error'],
                      'cancelledTrials':status['cancelled'],'violationTrials':sum(r['violations']>0 for r in group),
                      'deadlineMissTrials':sum(r['deadlineMisses']>0 for r in group),'deadlineMisses':sum(r['deadlineMisses'] for r in group),
                      'decisionCount':len(times),'fallbackCount':sum(r['fallbackCount'] for r in group)}
            for field in ('supplyAcceptance','acceptedBoxFraction','fill','count','total','unprocessed','wallMs','computeMs'):
                result['mean'+field[0].upper()+field[1:]] = mean(r[field] for r in group) if group else None
            result.update({f'decision{q}Ms':quantile(times,p) for q,p in [('P50',.5),('P95',.95),('P99',.99)]})
            result['decisionMaxMs'] = max(times) if times else None
            summary.append(result)
    by_key = {(r['condition'],r['algorithm'],r['seed']):r for r in rows}
    effects = []
    for cid,m in manifests.items():
        for baseline in freeze['algorithms']:
            if baseline == 'floor-dense':
                continue
            differences = []
            pair_failures = 0
            for order in m['orders']:
                p = by_key.get((cid,'floor-dense',order['seed']))
                b = by_key.get((cid,baseline,order['seed']))
                if p is not None and b is not None:
                    differences.append(p['supplyAcceptance']-b['supplyAcceptance'])
                    pair_failures += any(r['status']!='finished' or r['violations'] or r['deadlineMisses'] for r in (p,b))
            n = len(differences)
            delta = mean(differences) if n else None
            se = stdev(differences)/math.sqrt(n) if n>1 else None
            half = t_critical(.975,n-1)*se if se is not None else None
            adjusted_half = t_critical(1-.05/(2*family),n-1)*se if se is not None else None
            statistic = delta/se if se else (math.copysign(math.inf,delta) if n>1 and delta else (0 if n>1 else None))
            pvalue = t_two_sided(statistic,n-1) if statistic is not None else None
            effects.append({'condition':cid,'primaryPolicy':'floor-dense','baseline':baseline,'expectedPairs':freeze['n'],'pairedN':n,
                            'missingPairs':freeze['n']-n,'pairsWithFailureOrMiss':pair_failures,'complete':complete and n==freeze['n'],
                            'meanDifference':delta,'standardError':se,'ci95Low':delta-half if half is not None else None,
                            'ci95High':delta+half if half is not None else None,'familySize':family,
                            'bonferroniCi95Low':delta-adjusted_half if adjusted_half is not None else None,
                            'bonferroniCi95High':delta+adjusted_half if adjusted_half is not None else None,
                            'twoSidedPValue':pvalue,'bonferroniPValue':min(1,family*pvalue) if pvalue is not None else None,
                            'practicalThreshold':.02})
    output.mkdir(parents=True,exist_ok=True)
    public_rows = [{k:v for k,v in r.items() if not k.startswith('_')} for r in rows]
    report = {'schema':'alps-independent-audit/1','createdAt':datetime.now(timezone.utc).isoformat(),'root':str(root),
              'freezeSignature':freeze['signature'],'complete':complete,'expectedTrials':len(expected),'rawFiles':len(paths),
              'auditedTrials':len(rows),'missingTrials':len(missing),'auditErrors':errors,'warnings':warnings,
              'statisticsBackend':'scipy.stats.t' if scipy_t else 'stdlib: CF t quantiles df>=999; beta-CDF quantiles df<999; beta-CDF pvalues',
              'primary':'placed volume / supplied volume; errors/cancelled/deadline misses retained',
              'timing':'Raw decisionMs pooled per condition/policy, first startup decision included; not per-trial quantile averages. Parallel shared-machine latency is contention-dependent.',
              'familySize':family,'practicalThreshold':.02,'summary':summary,'pairedEffects':effects,
              'missingTrialKeys':[list(k) for k in sorted(missing)]}
    (output/'audit.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    write_csv(output/'trials.csv',public_rows)
    write_csv(output/'summary.csv',summary)
    write_csv(output/'paired-effects.csv',effects)
    def fmt(v,scale=1):
        return '—' if v is None else f'{v*scale:.3f}'
    lines = ['# Independent benchmark audit','',f"Status: {'COMPLETE' if complete else 'INCOMPLETE'} — {len(rows):,}/{len(expected):,} independently audited raw trials; {len(errors)} audit errors.",'',
             'Primary outcome: placed volume / supplied volume. All auditable error, cancelled, rejected-box and deadline-miss trials remain in descriptive means and available matched pairs. Missing/corrupt trials are explicit and prevent a complete claim.',
             '', f"Unique SKU sequences and unique seeds are checked within each condition; policies receive identical frozen inputs. Frozen n={freeze['n']} per condition. The fixed inventory differs between conditions; these are arrival-order experiments.", '',
             '| Condition | Policy | n / expected | Acceptance % | Fill % | Mean placed | Error / cancelled | Misses | Decision P50 / P95 / P99 / max ms |',
             '|---|---|---:|---:|---:|---:|---:|---:|---:|']
    for s in summary:
        lines.append(f"| {s['condition']} | {s['algorithm']} | {s['auditedTrials']}/{s['expectedTrials']} | {fmt(s['meanSupplyAcceptance'],100)} | {fmt(s['meanFill'],100)} | {fmt(s['meanCount'])} | {s['errorTrials']} / {s['cancelledTrials']} | {s['deadlineMisses']} | {' / '.join(fmt(s[k]) for k in ('decisionP50Ms','decisionP95Ms','decisionP99Ms','decisionMaxMs'))} |")
    lines += ['', f'Paired effects below are floor-dense minus baseline in percentage points. Ordinary t 95% CIs and Bonferroni simultaneous 95% CIs use the predeclared {family}-comparison family. The practical superiority threshold is +2 percentage points. Intervals and p-values describe evidence; they do not establish a universal optimum.', '',
              '| Condition | Baseline | Pairs | Mean effect pp | 95% CI pp | Bonferroni 95% CI pp | Adjusted p |',
              '|---|---|---:|---:|---:|---:|---:|']
    for e in effects:
        lines.append(f"| {e['condition']} | {e['baseline']} | {e['pairedN']}/{e['expectedPairs']} | {fmt(e['meanDifference'],100)} | [{fmt(e['ci95Low'],100)}, {fmt(e['ci95High'],100)}] | [{fmt(e['bonferroniCi95Low'],100)}, {fmt(e['bonferroniCi95High'],100)}] | {fmt(e['bonferroniPValue'])} |")
    lines += ['', report['timing'], '', f"Statistics backend: {report['statisticsBackend']}.", '', 'Audit validates identities, conservation, dimensions/volumes, overlaps/bounds, manifest pairing, decision counts/deadlines, source hashes and freeze signature. It does not independently prove robot reach, gripper collision clearance, material/load models, or real-world transport safety.']
    if errors:
        lines += ['', 'Audit errors:'] + [f'- {e}' for e in errors[:50]]
    (output/'summary.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'complete':complete,'expectedTrials':len(expected),'auditedTrials':len(rows),'missingTrials':len(missing),'auditErrors':len(errors),'output':str(output)}))
    return 1 if errors else (0 if complete or args.allow_incomplete else 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path('docs/benchmark-1000/evaluation-v1'))
    parser.add_argument('--output',type=Path)
    parser.add_argument('--allow-incomplete',action='store_true',help='Allow partial snapshots; still fails on corruption')
    args = parser.parse_args()
    try:
        return run(args)
    except (ValueError,KeyError,OSError,TypeError,ArithmeticError) as exc:
        print(json.dumps({'fatalAuditError':str(exc)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
