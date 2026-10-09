"""Populate the inline comparison from audited raw results and frozen score CSV."""
from pathlib import Path
from statistics import mean, stdev
import argparse
import csv
import gzip
import json
import math
import runpy

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,required=True)
parser.add_argument('--template',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
root=args.root.resolve()
freeze=json.loads((root/'freeze.json').read_text())
audit=json.loads((root/'audit/audit.json').read_text())
assert audit['complete'] and not audit['auditErrors']
api=runpy.run_path(str(root/'source-snapshot/scripts/benchmark-1000-audit.py'))
rows=list(csv.DictReader((root.parent/'scores.csv').open()))
times={}
for p in sorted(root.glob('shards/**/trials/*.json.gz')):
    raw=json.loads(gzip.decompress(p.read_bytes()))
    r=raw['trial'];times[(raw['condition'],r['algorithm'],r['seed'])]=[d['decisionMs'] for d in r['decisions']]

def dist(values):
    center=mean(values)
    half=api['t_critical'](.975,len(values)-1)*stdev(values)/math.sqrt(len(values)) if len(values)>1 else 0
    return center,[center-half,center+half]

data={}
for n in (50,100):
    entry={'trials':0,'conditions':[],'effects':[]}
    for manifest in freeze['manifests']:
        cid=manifest['condition']['id']
        seeds={o['seed'] for o in manifest['orders'][:n]}
        label=f"{manifest['condition']['skus']} SKU"
        group=[r for r in rows if r['condition']==cid and int(r['seed']) in seeds]
        assert len(group)==n*len(freeze['algorithms'])
        panel={'id':cid,'label':label,'rows':[]}
        for algorithm in freeze['algorithms']:
            rr=[r for r in group if r['algorithm']==algorithm]
            score,ci=dist([float(r['score']) for r in rr])
            acceptance,acceptance_ci=dist([float(r['supplyAcceptance'])*100 for r in rr])
            tt=[t for r in rr for t in times[cid,algorithm,int(r['seed'])]]
            panel['rows'].append({'algorithm':algorithm,'n':len(rr),'score':score,'scoreCi':ci,
                'acceptance':acceptance,'acceptanceCi':acceptance_ci,
                'count':mean(float(r['count']) for r in rr),
                'envelopeFill':mean(float(r['envelopeFill']) for r in rr)*100,
                'columnVoidLiters':mean(float(r['columnVoidLiters']) for r in rr),
                'usedHeightMm':mean(float(r['usedHeightMm']) for r in rr),
                'floor':mean(float(r['floor']) for r in rr)*100,
                'cluster':mean(float(r['sameSkuContact']) for r in rr)*100,
                'p95':api['quantile'](tt,.95)})
        entry['conditions'].append(panel)
        indexed={(r['algorithm'],int(r['seed'])):float(r['supplyAcceptance']) for r in group}
        diffs=[indexed['floor-dense',seed]-indexed['capacity-compact',seed] for seed in sorted(seeds)]
        delta=mean(diffs);half=api['t_critical'](1-.05/(2*freeze['protocol']['familySize']),n-1)*stdev(diffs)/math.sqrt(n)
        entry['effects'].append({'label':label,'n':n,'delta':delta*100,'low':(delta-half)*100,'high':(delta+half)*100})
        entry['trials']+=len(group)
    data[str(n)]=entry
template=args.template.read_text()
assert '__BENCHMARK_DATA__' in template
html=template.replace('__BENCHMARK_DATA__',json.dumps(data,ensure_ascii=False,allow_nan=False))
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(html)
args.output.with_suffix('.data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'output':str(args.output),'fullTrials':data['100']['trials'],'prefixTrials':data['50']['trials']}))
