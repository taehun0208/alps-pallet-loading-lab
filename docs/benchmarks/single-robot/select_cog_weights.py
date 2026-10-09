"""Select one CoG weight per base policy from development sweep runs (rule fixed before use).

Usage: python3 docs/benchmarks/single-robot/select_cog_weights.py <run-dir> [<run-dir> ...]
Rule, per base policy, comparing each weight w with w=0 on identical development cases:
  qualifies if  (a) completion rate >= the w=0 completion rate in every case,
                (b) total pallets <= 1.05 x the w=0 total, and
                (c) no fitness failure.
  choose the qualifying w with the smallest mean worst-pallet CoG offset; ties -> smaller w.
  If only w=0 qualifies, the policy gets no CoG term.
"""
import json, sys, glob, os, collections

rows = [json.loads(l) for d in sys.argv[1:] for f in sorted(glob.glob(os.path.join(d, 'runs-*.jsonl'))) for l in open(f) if l.strip()]
by = collections.defaultdict(dict)
for r in rows:
    base, w = r['policy'].rsplit('@', 1)
    key = (r['situation'], r['seeds']['dataset'])
    if key in by[(base, float(w))]: sys.exit(f'DUPLICATE {r["policy"]} {key}')
    by[(base, float(w))][key] = r
choice, report = {}, {}
for base in sorted({b for b, _ in by}):
    zero = by.get((base, 0.0))
    if not zero: sys.exit(f'{base}: no w=0 runs')
    p0 = sum(r['performance']['pallets'] for r in zero.values()); rows_out = []; ok = []
    for w in sorted(w for b, w in by if b == base):
        rs = by[(base, w)]
        if set(rs) != set(zero): sys.exit(f'{base}@{w}: cases differ from w=0')
        comp = all((rs[k]['performance']['completionRate'] or 0) >= (zero[k]['performance']['completionRate'] or 0) - 1e-9 for k in zero)
        pallets = sum(r['performance']['pallets'] for r in rs.values())
        worst = [r['stability']['worstComOffset'] for r in rs.values() if r['stability']['worstComOffset'] is not None]
        fails = sum(r['fitness']['status'] == 'fail' for r in rs.values())
        q = comp and pallets <= 1.05 * p0 and fails == 0
        rows_out.append({'weight': w, 'pallets': pallets, 'palletChange': pallets / p0 - 1, 'completionNotWorse': comp,
                         'meanWorstCom': sum(worst) / len(worst) if worst else None, 'fitnessFailures': fails, 'qualifies': q})
        if q: ok.append((round(sum(worst) / len(worst), 6), w))
    choice[base] = min(ok)[1] if ok else 0.0
    report[base] = rows_out
print(json.dumps({'rule': __doc__.strip().splitlines()[2:9], 'cases': len(next(iter(by.values()))), 'choice': choice, 'detail': report}, ensure_ascii=False, indent=1))
