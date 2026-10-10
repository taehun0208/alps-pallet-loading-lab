#!/usr/bin/env python3
"""Render fixed-plan descriptive scores and scientific benchmark charts."""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import runpy
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, stdev

os.environ.setdefault('MPLCONFIGDIR', '/tmp/alps-benchmark-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

LABELS = {'blb':'BLB','capacity-compact':'Capacity compact','strategy-greedy':'Strategy greedy',
          'lookahead':'Lookahead','future-hybrid':'Future hybrid','floor-dense':'ALPS Tetris','cluster-layer':'ALPS cluster'}
COLORS = {'floor-dense':'#067A79','cluster-layer':'#A84A8A'}
NEUTRAL = '#83909A'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def floor_coverage(placements,pallet):
    boxes = [p for p in placements if abs(p['position']['z'])<=1e-7]
    xs = sorted({x for p in boxes for x in (p['position']['x'],p['position']['x']+p['size']['w'])})
    area = 0
    for lo,hi in zip(xs,xs[1:]):
        mid = (lo+hi)/2
        intervals = sorted((p['position']['y'],p['position']['y']+p['size']['d']) for p in boxes if p['position']['x']<=mid<p['position']['x']+p['size']['w'])
        bottom,top,length = None,0,0
        for a,b in intervals:
            if bottom is None:
                bottom,top = a,b
            elif a<=top:
                top = max(top,b)
            else:
                length += top-bottom
                bottom,top = a,b
        if bottom is not None:
            length += top-bottom
        area += (hi-lo)*length
    return area/(pallet['width']*pallet['depth'])


def sku_contact(placements):
    total,same = 0,0
    axes = [('x','w'),('y','d'),('z','h')]
    for i,a in enumerate(placements):
        for b in placements[i+1:]:
            overlaps = [max(0,min(a['position'][x]+a['size'][d],b['position'][x]+b['size'][d])-max(a['position'][x],b['position'][x])) for x,d in axes]
            contact = 0
            for index,(x,d) in enumerate(axes):
                touching = abs(a['position'][x]+a['size'][d]-b['position'][x])<1e-5 or abs(b['position'][x]+b['size'][d]-a['position'][x])<1e-5
                if touching:
                    contact += math.prod(value for j,value in enumerate(overlaps) if j!=index)
            total += contact
            if a['typeId']==b['typeId']:
                same += contact
    return same/total if total else None


def packing_density(placements,pallet):
    volume_mm3 = sum(math.prod(p['size'][d] for d in ('w','d','h')) for p in placements)
    used_height = max((p['position']['z']+p['size']['h'] for p in placements),default=0)
    xs = sorted({0,pallet['width']} | {x for p in placements for x in (p['position']['x'],p['position']['x']+p['size']['w'])})
    ys = sorted({0,pallet['depth']} | {y for p in placements for y in (p['position']['y'],p['position']['y']+p['size']['d'])})
    beneath_roofs = 0
    for xlo,xhi in zip(xs,xs[1:]):
        for ylo,yhi in zip(ys,ys[1:]):
            mx,my = (xlo+xhi)/2,(ylo+yhi)/2
            local_height = max((p['position']['z']+p['size']['h'] for p in placements if p['position']['x']<=mx<p['position']['x']+p['size']['w'] and p['position']['y']<=my<p['position']['y']+p['size']['d']),default=0)
            beneath_roofs += (xhi-xlo)*(yhi-ylo)*local_height
    envelope = pallet['width']*pallet['depth']*used_height
    return {'volumeL':volume_mm3/1e6,'usedHeightMm':used_height,'envelopeFill':volume_mm3/envelope if envelope else 0,'columnVoidLiters':max(0,beneath_roofs-volume_mm3)/1e6}


def distribution(values,t_critical):
    n = len(values)
    center = mean(values) if n else None
    se = stdev(values)/math.sqrt(n) if n>1 else None
    half = t_critical(.975,n-1)*se if se is not None else None
    return {'n':n,'mean':center,'ci95Low':center-half if half is not None else None,'ci95High':center+half if half is not None else None}


def run(args):
    repo = Path(__file__).resolve().parents[1]
    root = args.root.resolve()
    output = (args.output or root.parent).resolve()
    freeze = json.loads((root/'freeze.json').read_text())
    frozen = {x['path']:x['sha256'] for x in freeze['source']}
    plan_path = root/'source-snapshot/docs/benchmark-1000/score-plan.json'
    if not plan_path.exists():
        plan_path = repo/'docs/benchmark-1000/score-plan.json'
    if sha(plan_path)!=frozen.get('docs/benchmark-1000/score-plan.json'):
        raise ValueError('Score-plan differs from frozen source hash')
    plan = json.loads(plan_path.read_text())
    if plan['weights']!={'supplyAcceptance':60,'floor':15,'sameSkuContact':15,'deadlineCompliance':10}:
        raise ValueError('Unsupported score plan; refusing to invent weights')
    auditor_path = root/'source-snapshot/scripts/benchmark-1000-audit.py'
    if not auditor_path.exists():
        auditor_path = repo/'scripts/benchmark-1000-audit.py'
    if 'scripts/benchmark-1000-audit.py' in frozen and sha(auditor_path)!=frozen['scripts/benchmark-1000-audit.py']:
        raise ValueError('Auditor source hash mismatch')
    auditor = runpy.run_path(str(auditor_path))
    manifests = {m['condition']['id']:{**m,'by_seed':{o['seed']:o for o in m['orders']}} for m in freeze['manifests']}
    policies = freeze['algorithms']
    expected = len(manifests)*len(policies)*freeze['n']
    audit_path = root/'audit/audit.json'
    audit = json.loads(audit_path.read_text()) if audit_path.exists() else None
    if not args.allow_incomplete:
        if audit is None or not audit['complete'] or audit['freezeSignature']!=freeze['signature']:
            raise ValueError('Final charts require a complete independent audit matching this freeze; run auditor first or use --allow-incomplete')
    progress_path = root/'progress.json'
    progress = json.loads(progress_path.read_text()) if progress_path.exists() else {}
    progress_rows = {(r['condition'],r['algorithm'],r['seed']):r for r in progress.get('rows',[])}
    rows,times,seen = [],defaultdict(list),set()
    paths = sorted(set(root.glob('trials/*.json.gz')) | set(root.glob('shards/**/trials/*.json.gz')))
    pair_hashes = {}
    for path in paths:
        raw = json.loads(gzip.decompress(path.read_bytes()))
        checked = auditor['audit_trial'](raw,freeze,manifests,path)
        trial = raw['trial']
        key = (checked['condition'],checked['algorithm'],checked['seed'])
        if key in seen:
            raise ValueError(f'Duplicate trial {key}')
        seen.add(key)
        pair = (checked['condition'],checked['seed'])
        if pair in pair_hashes and pair_hashes[pair]!=checked['_pairHash']:
            raise ValueError('Paired input mismatch')
        pair_hashes[pair] = checked['_pairHash']
        density = packing_density(trial['placements'],trial['scenario']['pallet'])
        for raw_name,recomputed in [('usedHeightMm',density['usedHeightMm']),('envelopeFill',density['envelopeFill']),('columnVoidMm3',density['columnVoidLiters']*1e6)]:
            if not math.isclose(trial['metrics'][raw_name],recomputed,rel_tol=1e-8,abs_tol=1e-6):
                raise ValueError(f'Raw packing metric mismatch: {raw_name}')
        floor = floor_coverage(trial['placements'],trial['scenario']['pallet'])
        contact = sku_contact(trial['placements'])
        contact_score = contact if contact is not None else plan['undefinedContactContribution']
        compliance = 1-checked['deadlineMisses']/checked['decisionCount'] if checked['decisionCount'] else 0
        components = {'supplyAcceptance':checked['supplyAcceptance'],'floor':floor,'sameSkuContact':contact_score,'deadlineCompliance':compliance}
        score = sum(plan['weights'][name]*max(0,min(1,value)) for name,value in components.items())
        previous = progress_rows.get(key)
        if previous:
            for name,value in [('floor',floor),('sameSkuContact',contact_score),('supplyAcceptance',checked['supplyAcceptance'])]:
                if not math.isclose(previous[name],value,abs_tol=1e-8):
                    raise ValueError(f'Raw/progress {name} mismatch {key}')
        row = {k:checked[k] for k in ('condition','algorithm','seed','status','violations','count','total','unprocessed','deadlineMisses','decisionCount','fill','supplyAcceptance','acceptedBoxFraction','wallMs','traceSha256','placedVolumeMm3','suppliedVolumeMm3')}
        row.update(density)
        row.update({'floor':floor,'sameSkuContact':contact_score,'contactDefined':contact is not None,'deadlineCompliance':compliance,'score':score})
        rows.append(row)
        times[key[:2]].extend(checked['_times'])
    complete = len(rows)==expected and audit is not None and audit.get('complete',False) and audit.get('freezeSignature')==freeze['signature']
    if not complete and not args.allow_incomplete:
        raise ValueError('Raw-trace sample is incomplete')
    grouped = defaultdict(list)
    for r in rows:
        grouped[r['condition'],r['algorithm']].append(r)
    summary = []
    for cid in manifests:
        for algorithm in policies:
            group = grouped[cid,algorithm]
            item = {'condition':cid,'algorithm':algorithm,'label':LABELS.get(algorithm,algorithm),'n':len(group),'expectedN':freeze['n'],
                    'missingN':freeze['n']-len(group),'errorN':sum(r['status']=='error' for r in group),
                    'cancelledN':sum(r['status']=='cancelled' for r in group),'deadlineMisses':sum(r['deadlineMisses'] for r in group),
                    'violationN':sum(r['violations']>0 for r in group),'contactUndefinedN':sum(not r['contactDefined'] for r in group)}
            for metric in ('score','supplyAcceptance','floor','sameSkuContact','deadlineCompliance','fill','count','acceptedBoxFraction','volumeL','usedHeightMm','envelopeFill','columnVoidLiters'):
                item[metric] = distribution([r[metric] for r in group],auditor['t_critical'])
            raw_times = times[cid,algorithm]
            item['rawDecisionTiming'] = {'n':len(raw_times),'p50Ms':auditor['quantile'](raw_times,.5),'p95Ms':auditor['quantile'](raw_times,.95),
                                         'p99Ms':auditor['quantile'](raw_times,.99),'maxMs':max(raw_times) if raw_times else None}
            summary.append(item)
    output.mkdir(parents=True,exist_ok=True)
    figures = output/'figures'
    figures.mkdir(exist_ok=True)
    with (output/'scores.csv').open('w',newline='') as f:
        writer = csv.DictWriter(f,fieldnames=list(rows[0]) if rows else ['condition','algorithm','seed','score'])
        writer.writeheader()
        writer.writerows(rows)
    report = {'schema':'alps-descriptive-scores/1','createdAt':datetime.now(timezone.utc).isoformat(),'freezeSignature':freeze['signature'],
              'scorePlanSha256':sha(plan_path),'complete':complete,'expectedTrials':expected,'actualTrials':len(rows),
              'execution':freeze.get('execution',{}),'plan':plan,'summary':summary,
              'cautions':['Unadjusted descriptive 95% t intervals; primary paired Bonferroni inference lives in the independent audit.',
                          'Density adoption priority: read placed count and volume first, then envelope fill and column void; grouping and the frozen score are secondary.',
                          'Envelope fill is placed volume / pallet-footprint envelope at used height; compare with load size because a smaller load may look denser.',
                          'Column void is empty volume below local highest box roofs, not a proof of trapped or irrecoverable void; floor coverage is not 3D gaplessness.',
                          'Fixed score weights declared before evaluation; score is secondary and not a density-optimality certificate; no outcome-dependent ranking or pooling across conditions.',
                          'Same-SKU contact is physical shared face area purity; undefined contacts contribute zero by frozen plan.',
                          'Decision timing pools raw observed decisions; shared-machine process contention affects latency.']}
    (output/'score-summary.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,
                         'axes.labelcolor':'#263238','text.color':'#263238','axes.titleweight':'bold',
                         'svg.fonttype':'none','savefig.facecolor':'white','figure.facecolor':'white'})
    indexed = {(r['condition'],r['algorithm']):r for r in summary}
    cids = list(manifests)
    positions = np.arange(len(policies))
    colors = [COLORS.get(a,NEUTRAL) for a in policies]
    expected_n = freeze['n']
    concurrency = freeze.get('execution',{}).get('concurrency',progress.get('concurrency',4))
    status = 'COMPLETE' if complete else 'PRELIMINARY — INCOMPLETE'
    subtitle = f'{status} · {len(rows):,}/{expected:,} trials · expected n={expected_n}/condition/policy · {concurrency} process workers, shared machine'
    footer = '1200 mm height · 30 supplied boxes · Fixed inventories, unique paired arrival orders · Whiskers: descriptive unadjusted 95% t CI'

    def condition_title(cid):
        c = manifests[cid]['condition']
        return f"{c['skus']} SKU · {c['boxes']} boxes · {c['height']} mm"

    def labels(ax):
        ax.set_yticks(positions,[LABELS.get(a,a) for a in policies])
        ax.invert_yaxis()
        ax.grid(axis='x',alpha=.17)
        ax.set_axisbelow(True)

    def draw_metric(ax,cid,metric,title,scale=100,limit=(0,100)):
        entries = [indexed[cid,a] for a in policies]
        centers = [e[metric]['mean']*scale if e[metric]['mean'] is not None else np.nan for e in entries]
        low = [(e[metric]['mean']-e[metric]['ci95Low'])*scale if e[metric]['ci95Low'] is not None else 0 for e in entries]
        high = [(e[metric]['ci95High']-e[metric]['mean'])*scale if e[metric]['ci95High'] is not None else 0 for e in entries]
        ax.barh(positions,centers,color=colors,height=.63,zorder=2)
        ax.errorbar(centers,positions,xerr=[low,high],fmt='none',ecolor='#263238',elinewidth=1,capsize=3,zorder=3)
        labels(ax)
        ax.set_xlim(*limit)
        ax.set_xlabel(title)
        for y,(value,e) in enumerate(zip(centers,entries)):
            if math.isfinite(value):
                short = value < limit[1]*.25
                text_x = ((e[metric]['ci95High'] or e[metric]['mean'])*scale+limit[1]*.02) if short else limit[1]*.02
                ax.text(text_x,y,f"{value:.1f}  (n={e['n']})",va='center',ha='left',fontsize=8,color='#263238' if short else 'white')
        ax.set_title(condition_title(cid),loc='left',pad=10)

    def draw_contacts(ax,cid):
        for metric,offset,color,label in [('floor',-.17,'#416C85','Floor contact coverage'),('sameSkuContact',.17,'#D29743','Same-SKU face contact')]:
            entries = [indexed[cid,a][metric] for a in policies]
            centers = [e['mean']*100 if e['mean'] is not None else np.nan for e in entries]
            low = [(e['mean']-e['ci95Low'])*100 if e['ci95Low'] is not None else 0 for e in entries]
            high = [(e['ci95High']-e['mean'])*100 if e['ci95High'] is not None else 0 for e in entries]
            ax.barh(positions+offset,centers,height=.29,color=color,label=label)
            ax.errorbar(centers,positions+offset,xerr=[low,high],fmt='none',ecolor='#263238',elinewidth=.8,capsize=2)
        labels(ax)
        ax.set_xlim(0,100)
        ax.set_xlabel('Mean coverage / contact share (%)')
        ax.set_title(condition_title(cid),loc='left',pad=10)
        ax.legend(loc='upper center',bbox_to_anchor=(.5,-.22),ncol=2,fontsize=8,frameon=False)

    def draw_latency(ax,cid):
        entries = [indexed[cid,a]['rawDecisionTiming'] for a in policies]
        p95 = [e['p95Ms'] if e['p95Ms'] is not None else np.nan for e in entries]
        ax.scatter(p95,positions,c=colors,s=80,zorder=3)
        labels(ax)
        positive = [v for v in p95 if math.isfinite(v) and v>0]
        if positive and max(positive)/min(positive)>10:
            ax.set_xscale('log')
            ax.set_xlim(max(.01,min(positive)*.6),max(positive)*2)
        else:
            ax.set_xlim(0,max(positive)*1.3 if positive else 1)
        ax.set_xlabel('P95 raw decision latency (ms; pooled decisions)')
        ax.set_title(condition_title(cid),loc='left',pad=10)
        for y,value in enumerate(p95):
            if math.isfinite(value):
                ax.text(value*1.06,y,f'{value:.1f}',va='center',fontsize=8)

    def save(fig,name,title,description):
        fig.suptitle(title+'\n'+subtitle,fontsize=13,y=.995)
        fig.text(.02,.008,description,fontsize=8,color='#455A64')
        fig.tight_layout(rect=(0,.035,1,.94),h_pad=3,w_pad=3)
        for ext in ('svg','png'):
            fig.savefig(figures/f'{name}.{ext}',dpi=190,metadata={'Creator':'ALPS fixed-plan benchmark charts'} if ext=='svg' else {'Software':'ALPS fixed-plan benchmark charts'})
        plt.close(fig)

    configs = [('acceptance','Supply acceptance','supplyAcceptance','Placed volume / supplied volume (%)'),
               ('operational-score','Frozen operational score','score','Descriptive score (0–100; fixed weights)')]
    for name,title,metric,xlabel in configs:
        fig,axes = plt.subplots(1,len(cids),figsize=(14,5.6),squeeze=False)
        for ax,cid in zip(axes[0],cids):
            draw_metric(ax,cid,metric,xlabel,scale=1 if metric=='score' else 100)
        save(fig,name,title,footer if metric!='score' else footer+' · Score = 60 acceptance + 15 floor + 15 same-SKU + 10 deadline compliance')
    for name,title,draw,description in [('contact-metrics','Floor contact and SKU grouping',draw_contacts,footer),
                                         ('decision-latency','Observed decision latency under concurrent load',draw_latency,'P95 pools raw decisions including startup and misses; no CI shown · Worker loading excluded · Not isolated CPU or measured robot latency')]:
        fig,axes = plt.subplots(1,len(cids),figsize=(14,5.6),squeeze=False)
        for ax,cid in zip(axes[0],cids):
            draw(ax,cid)
        save(fig,name,title,description)
    fig,axes = plt.subplots(3,len(cids),figsize=(14,13),squeeze=False)
    void_max = max((item['columnVoidLiters']['ci95High'] or item['columnVoidLiters']['mean'] or 0 for item in summary),default=1)
    for column,cid in enumerate(cids):
        draw_metric(axes[0,column],cid,'count','Accepted boxes (count; supplied = 30)',scale=1,limit=(0,manifests[cid]['condition']['boxes']))
        draw_metric(axes[1,column],cid,'envelopeFill','Volume / used-height envelope (%)')
        draw_metric(axes[2,column],cid,'columnVoidLiters','Empty volume below local box roofs (L)',scale=1,limit=(0,max(1,void_max*1.12)))
    save(fig,'packing-density','Accepted load first, then packing density',
         'Read count and placed volume first; less void alone may reflect a smaller load · Column void is geometric, not certified trapped void · Whiskers: descriptive 95% t CI')
    fig,axes = plt.subplots(4,len(cids),figsize=(14,17),squeeze=False)
    for column,cid in enumerate(cids):
        draw_metric(axes[0,column],cid,'supplyAcceptance','Supply acceptance (%)')
        draw_metric(axes[1,column],cid,'score','Frozen descriptive score (0–100)',scale=1)
        draw_contacts(axes[2,column],cid)
        draw_latency(axes[3,column],cid)
    save(fig,'benchmark-overview','ALPS pallet loading benchmark',footer+' · Score is secondary; inspect packing-density before grouping; primary inference uses paired Bonferroni CIs')
    print(json.dumps({'complete':complete,'actualTrials':len(rows),'expectedTrials':expected,'output':str(output),'figures':str(figures)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path('docs/benchmark-1000/evaluation-v2'))
    parser.add_argument('--output',type=Path)
    parser.add_argument('--allow-incomplete',action='store_true')
    args = parser.parse_args()
    try:
        run(args)
    except (ValueError,KeyError,OSError,TypeError,ArithmeticError) as exc:
        parser.exit(1,f'Chart generation failed: {exc}\n')


if __name__=='__main__':
    main()
