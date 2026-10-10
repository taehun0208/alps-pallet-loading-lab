#!/usr/bin/env python3
"""Publish explicitly selected, audited individual examples; do not change averages."""
import csv
import gzip
import hashlib
import json
from pathlib import Path

root=Path.cwd()
run=root/'docs/benchmark-1000/evaluation-v2'
out=root/'public/benchmark-best'
audit=json.loads((run/'audit/audit.json').read_text())
freeze=json.loads((run/'freeze.json').read_text())
if not audit['complete'] or audit['auditErrors'] or audit['missingTrials']:
    raise SystemExit('A complete independent audit is required before selecting examples.')
records=list(csv.DictReader((run/'audit/trials.csv').open()))
traces={}
for record in records:
    if record['algorithm'] not in ('floor-dense','capacity-compact'):
        continue
    path=Path(record['trace'])
    raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=record['traceSha256']:
        raise SystemExit('Audited trace hash mismatch')
    saved=json.loads(gzip.decompress(raw))
    t=saved['trial']
    if saved['signature']!=freeze['signature']:
        raise SystemExit('Frozen source signature mismatch')
    if t['status']=='finished' and not t['violations'] and not t['metrics']['deadlineMisses'] and not t['unprocessed']:
        traces[(record['condition'],int(record['seed']),record['algorithm'])]=(t,record)

pairs=[]
for (condition,seed,algorithm),(trial,record) in traces.items():
    if algorithm!='floor-dense':
        continue
    baseline=traces.get((condition,seed,'capacity-compact'))
    if not baseline:
        continue
    b,br=baseline
    if trial['inputFingerprint']!=b['inputFingerprint'] or trial['arrivals']!=b['arrivals']:
        raise SystemExit('Selected pair does not share the exact same input')
    pairs.append({'condition':condition,'seed':seed,'alps':trial,'baseline':b,'alpsRecord':record,'baselineRecord':br})
if not pairs:
    raise SystemExit('No eligible audited matched pair')
full=[p for p in pairs if p['alps']['metrics']['count']==p['alps']['metrics']['total']==30]
density=min(full or pairs,key=lambda p:(-p['alps']['metrics']['envelopeFill'],p['alps']['metrics']['columnVoidMm3'],p['alps']['metrics']['usedHeightMm'],p['seed'],p['condition']))
improvements=[p for p in pairs if p['alps']['metrics']['count']>=p['baseline']['metrics']['count'] and p['alps']['metrics']['envelopeFill']>=p['baseline']['metrics']['envelopeFill'] and p['alps']['metrics']['volumeMm3']>p['baseline']['metrics']['volumeMm3']]
improvement=min(improvements,key=lambda p:(-(p['alps']['metrics']['volumeMm3']-p['baseline']['metrics']['volumeMm3'])/sum(x['size']['w']*x['size']['d']*x['size']['h'] for x in p['alps']['arrivals']),-(p['alps']['metrics']['envelopeFill']-p['baseline']['metrics']['envelopeFill']),p['alps']['metrics']['columnVoidMm3'],p['seed'],p['condition'])) if improvements else None
out.mkdir(parents=True,exist_ok=True)
cases=[]
for case_id,pair in [('density',density),('improvement',improvement)]:
    if pair is None:
        continue
    case={'id':case_id,'title':'전량 적재 · 관측 밀도 우수 사례' if case_id=='density' else 'Compact 대비 관측 개선 사례','condition':pair['condition'],'seed':pair['seed'],'inputFingerprint':pair['alps']['inputFingerprint'],'selection':('전량 30개 적재한 floor-dense 실행 중 사용 높이 기준 밀도 내림차순, 내부 빈틈·사용 높이·시드 오름차순.' if case_id=='density' and full else 'floor-dense 실행 중 사용 높이 기준 밀도 내림차순, 내부 빈틈·사용 높이·시드 오름차순.') if case_id=='density' else 'Compact보다 적재 수와 밀도가 낮지 않은 실행 중 공급 부피 수용률 증가 최대, 밀도 증가 최대, 내부 빈틈·시드 오름차순. 개선이 큰 개별 사례를 의도적으로 선택했습니다.','trials':[]}
    for role in ('baseline','alps'):
        trial=pair[role]
        filename=f'{case_id}-{role}.json'
        (out/filename).write_text(json.dumps(trial,ensure_ascii=False,separators=(',',':'))+'\n')
        case['trials'].append({'role':role,'algorithm':trial['algorithm'],'traceUrl':f'/benchmark-best/{filename}','traceSha256':pair[role+'Record']['traceSha256'],'sourceTrace':str(Path(pair[role+'Record']['trace']).relative_to(run)),'metrics':trial['metrics']})
    cases.append(case)
index={'schema':'alps-observed-showcase/1','label':'관측 우수 사례 · 전체 평균과 구분','nPerCondition':freeze['n'],'conditionCount':len(freeze['manifests']),'auditedTrials':audit['auditedTrials'],'eligiblePairs':len(pairs),'full30Candidates':len(full),'sourceGitCommit':freeze['sourceGitCommit'],'freezeSignature':freeze['signature'],'auditSha256':hashlib.sha256((run/'audit/audit.json').read_bytes()).hexdigest(),'summaryUrl':'/benchmark-best/summary.md','cases':cases}
(out/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
(out/'summary.md').write_text((run/'audit/summary.md').read_text())
print(json.dumps({'cases':[{k:c[k] for k in ('id','condition','seed')} for c in cases],'eligiblePairs':len(pairs),'full30Candidates':len(full)},ensure_ascii=False))
