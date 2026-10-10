"""Audit CPU-duty pilot traces and export a separate hardware report artifact."""
import csv
import gzip
import hashlib
import html
import json
import math
import os
from collections import defaultdict
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / 'docs/edge-hardware/pilot-v1'
OUT = ROOT / 'public/hardware-pilot'
NAMES = {'capacity-compact': 'Compact', 'floor-dense': 'ALPS Tetris', 'cluster-layer': 'ALPS 군집'}
PROFILE_NAMES = {'native': '정상 실행', 'duty25': '25% 실행 허용', 'duty10': '10% 실행 허용'}
PROFILES = list(PROFILE_NAMES)
COLORS = ['#547aa5', '#bd722d', '#218577']


def deployment_context():
    """Price references are separate from measured hardware/throughput results."""
    baseline = 1499000
    kits = [
        {'vendor': '엘레파츠', 'priceKRW': 263780,
         'url': 'https://www.eleparts.co.kr/goods/view?no=14217537',
         'components': 'Pi 5 4GB, 액티브 쿨러, 케이스, PD 27W 전원, microSD, 케이블 등',
         'componentSource': 'https://img2.eleparts.co.kr/editor/goods/1/2024/05/14217537_d6a226a63113039fe5ab829b75b1d75a0827554.jpg'},
        {'vendor': 'ICbanQ', 'priceKRW': 330000,
         'url': 'https://www.icbanq.com/P016019444',
         'components': 'Pi 5 4GB 베이직 키트. 세부 구성은 엘레파츠 키트와 동일하다고 가정하지 않음.'},
    ]
    for kit in kits:
        kit.update(savingKRW=baseline-kit['priceKRW'],
                   savingPct=100*(baseline-kit['priceKRW'])/baseline,
                   conditionalThroughputPerPurchaseCostRatio=baseline/kit['priceKRW'])
    return {'checkedOn': '2026-10-10', 'currency': 'KRW', 'tax': '소비자 표시금액, Pi 키트 VAT 포함',
            'baseline': {'name': '신규 Mac mini 시작 가격 (가격 비교용)', 'priceKRW': baseline,
                         'url': 'https://www.apple.com/kr/shop/buy-mac/mac-mini',
                         'newsSource': 'https://www.apple.com/kr/newsroom/2026/09/the-new-mac-mini-and-mac-studio-are-available-today/',
                         'isMeasuredHostPurchasePrice': False},
            'kits': kits, 'targetBoardTested': False, 'robotIntegrationTested': False,
            'exclusions': ['로봇팔·기존 로봇 제어기·카메라·그리퍼', '산업용 I/O·전원 보호·함체·설치',
                           '포팅·통신 연동·보정·유지보수·장애 비용', '전력·API 비용: 실측/실제 대체 비용 없음'],
            'conditionalEfficiency': '실제 기한 내 적재 처리량이 동일할 때만 구입비당 처리량의 산술 비율로 해석. Pi 처리량을 측정한 결과가 아님.',
            'netSavingFormula': 'N × (기준 컴퓨터 구입비 − Pi 키트비 − 대당 추가 설치비) − 일회성 개발비 − 추가 운영비',
            'edgeDefinitionSource': 'https://aws.amazon.com/what-is/edge-computing/',
            'robotInterfaceExample': 'https://docs.universal-robots.com/tutorials/communication-protocol-tutorials/rtde-guide.html'}


def edge_svg():
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="390" viewBox="0 0 1200 390" role="img" aria-labelledby="title desc">
<title id="title">ALPS 엣지 컴퓨팅 적용 제안</title><desc id="desc">입고 데이터가 현장의 라즈베리 파이 ALPS 엔진으로 전달되고, 배치 계획은 로봇 제어기를 거쳐 로봇팔이 실행한다. 실행 결과는 ALPS에 돌아온다. 실물 연동은 아직 검증하지 않았다.</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#617c8f"/></marker></defs>
<rect width="1200" height="390" rx="14" fill="#f2f6fa"/>
<g font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif" fill="#233e50">
<text x="40" y="48" font-size="26" font-weight="700">현장에서 적재를 계산하고 로봇이 실행합니다</text>
<text x="40" y="80" font-size="16" fill="#617c8f">적용 제안 · 실제 Raspberry Pi / 로봇 통신 연동은 미검증</text>
<rect x="40" y="130" width="240" height="120" rx="10" fill="white" stroke="#d0dce5"/>
<rect x="330" y="130" width="250" height="120" rx="10" fill="#e1f0ed" stroke="#218577" stroke-width="2"/>
<rect x="630" y="130" width="250" height="120" rx="10" fill="white" stroke="#d0dce5"/>
<rect x="930" y="130" width="230" height="120" rx="10" fill="white" stroke="#d0dce5"/>
<g font-size="22" font-weight="700"><text x="62" y="170">입고 데이터</text><text x="352" y="170">Pi · ALPS 엔진</text><text x="652" y="170">로봇 제어기</text><text x="952" y="170">로봇팔</text></g>
<g font-size="16"><text x="62" y="202">박스 규격 · SKU · 수량</text><text x="62" y="226">카메라/스캐너/상위 시스템</text><text x="352" y="202">적재 위치 · 방향 · 순서</text><text x="352" y="226">상태 관리 · 배치 검증</text><text x="652" y="202">좌표 확인 · 이동 궤적</text><text x="652" y="226">모터 제어 · 안전 정지</text><text x="952" y="202">파지 · 이동 · 적재</text><text x="952" y="226">성공/실패 · 실제 위치</text></g>
<g stroke="#617c8f" stroke-width="2" fill="none" marker-end="url(#arrow)"><path d="M285 190H321"/><path d="M585 190H621"/><path d="M885 190H921"/><path d="M1045 255V294H455V255"/></g>
<text x="660" y="320" font-size="16" fill="#617c8f">완료 응답 후 상태 확정 · 실패 시 재계획</text>
<text x="40" y="365" font-size="16">ALPS의 배치 좌표는 팔레트 기준입니다. 로봇 기준 좌표·그리퍼 TCP로 변환하는 연동 계층이 필요합니다.</text>
</g></svg>'''


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def q(values, fraction):
    a = sorted(values)
    rank = (len(a) - 1) * fraction
    i = int(rank)
    return a[i] + (a[min(i + 1, len(a) - 1)] - a[i]) * (rank - i)


def main():
    frozen = json.loads((ROOT / 'docs/benchmark-1000/evaluation-v2/freeze.json').read_text())
    for path, expected in json.loads((RUN / 'harness-sha256.json').read_text()).items():
        assert digest(ROOT / path) == expected, f'Harness modified: {path}'
    execution = json.loads((RUN / 'execution.json').read_text())
    assert len(execution) == 9 and all(r['exitCode'] == 0 for r in execution)
    groups, rows, all_keys = [], [], set()
    geometries = {}
    def geometry(trial):
        return [{k: box[k] for k in ['id','typeId','position','size','orientation'] if k in box} for box in trial['placements']]
    for profile in PROFILES:
        for algorithm in NAMES:
            saved = json.loads((RUN / f'{profile}-{algorithm}.json').read_text())
            assert saved['complete'] and len(saved['rows']) == 10
            assert saved['sourceSignature'] == frozen['signature'] and saved['config'] == frozen['config']
            assert saved['environment']['heapCapMiBPerIsolate'] == 64
            dec, prep, validation, timings = [], [], [], []
            for row in saved['rows']:
                key = (profile, algorithm, row['condition'], row['seed'])
                assert key not in all_keys
                all_keys.add(key)
                trace = RUN / row['trace']
                assert digest(trace) == row['traceSha256']
                raw = json.loads(gzip.decompress(trace.read_bytes()))
                trial = raw['trial']
                assert raw['sourceSignature'] == frozen['signature']
                assert len(trial['arrivals']) == len(trial['decisions']) == 30
                assert row['inputFingerprint'] == trial['inputFingerprint']
                assert row['count'] == len(trial['placements'])
                assert trial['algorithm'] == algorithm and trial['seed'] == row['seed'] and raw['profile'] == profile
                geometries[key] = geometry(trial)
                assert row['cyclePreparationMs'] == [d['recognitionMs'] + d['decisionMs'] + d['validationMs'] for d in trial['decisions']]
                assert all(d['searchBudgetMs'] == d['availableMs'] == 9000 for d in trial['decisions'])
                assert row['decisionMs'] == [d['decisionMs'] for d in trial['decisions']]
                assert all(math.isfinite(x) and x >= 0 for x in row['decisionMs'])
                dec.extend(row['decisionMs']); prep.extend(row['cyclePreparationMs']); validation.extend(row['validationMs'])
                rows.append(row)
                timings.extend({'profile': profile, 'algorithm': algorithm, 'condition': row['condition'], 'seed': row['seed'],
                                'index': d['index'], 'decisionMs': d['decisionMs'], 'validationMs': d['validationMs'],
                                'validDeadline': d['validDeadline'], 'fallback': d['fallback'], 'watchdog': d['watchdog']}
                               for d in trial['decisions'])
            controller = next(e for e in execution if e['profile'] == profile and e['algorithm'] == algorithm)
            groups.append({'profile': profile, 'algorithm': algorithm, 'trials': 10, 'decisions': len(dec),
                           'p50Ms': q(dec, .5), 'p95Ms': q(dec, .95), 'p99Ms': q(dec, .99), 'maxMs': max(dec),
                           'maxPreparationMs': max(prep), 'p95ValidationMs': q(validation, .95),
                           'peakRssMiB': saved['resource']['peakRssMiB'],
                           'startupMaxMs': max(saved['workerBootMs']),
                           'deadlineMisses': sum(r['deadlineMisses'] for r in saved['rows']),
                           'fallbacks': sum(r['fallbackCount'] for r in saved['rows']),
                           'watchdogs': sum(r['watchdogCount'] for r in saved['rows']),
                           'errors': sum(r['status'] != 'finished' or r['violations'] or r['unprocessed'] for r in saved['rows']),
                           'geometryMatchesAudited': sum(r['sameGeometryAsAudited'] for r in saved['rows']),
                           'runnableFraction': controller['measuredRunnableFraction'],
                           'conditions': [{'skus': sku, 'n': 5,
                                           'count': mean(r['count'] for r in saved['rows'] if r['condition'].endswith(f'-s{sku}')),
                                           'acceptancePct': 100 * mean(r['supplyAcceptance'] for r in saved['rows'] if r['condition'].endswith(f'-s{sku}')),
                                           'densityPct': 100 * mean(r['density'] for r in saved['rows'] if r['condition'].endswith(f'-s{sku}'))}
                                          for sku in [6, 8]], 'timings': timings})
    assert len(rows) == 90 and len(all_keys) == 90
    quality_matches = 0
    for r in rows:
        native = next(b for b in rows if b['profile'] == 'native' and all(b[k] == r[k] for k in ['algorithm', 'condition', 'seed']))
        assert r['inputFingerprint'] == native['inputFingerprint']
        same = geometries[r['profile'],r['algorithm'],r['condition'],r['seed']] == geometries['native',r['algorithm'],r['condition'],r['seed']]
        assert same == (r['geometrySha256'] == native['geometrySha256'])
        r['geometryMatchesNative'] = same
        quality_matches += same
    original = defaultdict(list)
    audited = {r['traceSha256'] for r in csv.DictReader((ROOT / 'docs/benchmark-1000/evaluation-v2/audit/trials.csv').open())}
    raw_count = 0
    original_geometry, seen_hashes = {}, set()
    for path in (ROOT / 'docs/benchmark-1000/evaluation-v2/shards').glob('*/trials/*.json.gz'):
        trace_hash = digest(path)
        assert trace_hash in audited and trace_hash not in seen_hashes
        seen_hashes.add(trace_hash)
        raw = json.loads(gzip.decompress(path.read_bytes()))
        t = raw['trial']
        key = (t['algorithm'],raw['condition'],t['seed'])
        if ('native', *key) in geometries:
            original_geometry[key] = geometry(t)
        original[t['algorithm']].extend(d['decisionMs'] for d in t['decisions'])
        raw_count += 1
    assert raw_count == 1400 and sum(len(v) for v in original.values()) == 42000
    for row in rows:
        key = (row['algorithm'],row['condition'],row['seed'])
        matches = geometries[row['profile'],*key] == original_geometry[key]
        assert matches == row['sameGeometryAsAudited']
    original_summary = [{'algorithm': a, 'decisions': len(v), 'p95Ms': q(v, .95), 'p99Ms': q(v, .99),
                         'maxMs': max(v), 'linearSlowdownTo9000msAtObservedMax': 9000 / max(v)} for a, v in original.items()]
    result = {'schema': 'alps-hardware-report/1', 'complete': True, 'targetBoardTested': False,
              'sourceSignature': frozen['signature'], 'evaluatedTrials': len(rows), 'decisionCount': 2700,
              'environment': saved['environment'], 'protocol': json.loads((RUN / 'protocol.json').read_text()),
              'sameGeometryAsNative': quality_matches, 'sameGeometryAsAudited': sum(r['sameGeometryAsAudited'] for r in rows),
              'totalDeadlineMisses': sum(g['deadlineMisses'] for g in groups),
              'totalErrors': sum(g['errors'] for g in groups), 'totalWatchdogs': sum(g['watchdogs'] for g in groups),
              'groups': [{k: v for k, v in g.items() if k != 'timings'} for g in groups],
              'original1400Latency': original_summary,
              'limitation': 'Not Pi emulation. Shared Apple CPU; 50ms SIGSTOP/SIGCONT duty window stops both planner and supervisor. Old-generation heap cap is not an RSS/device RAM cap. No camera inference, UI/GPU, actual robot, target temperature/power, or sustained factory workload measured.'}
    context = deployment_context()
    result['deploymentContext'] = context
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'cost-reference.json').write_text(json.dumps(context, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'edge-architecture.svg').write_text(edge_svg())
    (OUT / 'summary.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    with (OUT / 'decisions.csv').open('w', newline='') as f:
        timings = [d for g in groups for d in g['timings']]
        writer = csv.DictWriter(f, fieldnames=list(timings[0]), lineterminator='\n')
        writer.writeheader(); writer.writerows(timings)
    lines = ['# ALPS 저자원 환경 내성 검사', '', '**결론 범위: 라즈베리 파이 실측이 아니라, Mac에서 배치 엔진의 CPU 실행 기회를 줄인 파일럿이다.**', '',
             f"평가 90회·판단 2,700개. 정상 대비 동일 배치 {quality_matches}/90, 기존 검산 원자료와 동일 배치 {result['sameGeometryAsAudited']}/90, 기한 초과 {result['totalDeadlineMisses']}, 오류 {result['totalErrors']}, watchdog {result['totalWatchdogs']}.", '',
             '## 시험 조건', '',
             '- Compact·ALPS Tetris·ALPS 군집. 정책·조건별 5개 입고 순서, 3개 실행 조건.',
             '- 6/8 SKU 각각 박스 30개, 팔레트 1200×1000mm, 높이 1200mm. 동결한 100개 순서 중 위치 0·24·49·74·99를 결과 확인 전에 고정했다.',
             '- 동일 evaluation-v2 엔진·입고·설정. 검색 9초, 인지 0초, reserve 1초, 전체 cycle 10초. 예열은 집계에서 제외했다.',
             '- Apple M5 arm64·호스트 24GiB·Node v24.14.1. 실행 조건: 정상, 25%, 10% 시간창 허용.',
             '- 50ms 주기로 우리 Node 자식 프로세스만 SIGSTOP/SIGCONT한다. 실제 runnable 비율은 아래에 기록했다. CPU 클럭·코어 수·Pi 등가 사양을 지정한 것이 아니다.',
             '- V8 old-generation 64MiB 제한은 메인/플래너 isolate 각각 적용한다. OS 프로세스 전체 메모리나 64MiB RAM을 제한한 것이 아니다. RSS는 두 isolate·코드·네이티브 할당을 포함한 실측 최대다.',
             '- 타이머도 함께 멈추므로 watchdog 통지는 off-window만큼 늦을 수 있다. 기존 경과시간 검사와 commit 기한은 변경하지 않았다. Linux cgroup 결과와 동등하지 않다.', '',
             '## 계산시간·메모리', '',
             '각 행은 6/8 SKU의 10회·판단 300개를 합친 기술통계다. 적재 성능은 SKU 조건별로 별도 비교한다.', '',
             '| 실행 조건 | 정책 | 실제 runnable | P95 ms | P99 ms | 최대 ms | 최대 RSS MiB | 기한 초과 | watchdog |',
             '|---|---|---:|---:|---:|---:|---:|---:|---:|']
    for g in groups:
        lines.append(f"| {PROFILE_NAMES[g['profile']]} | {NAMES[g['algorithm']]} | {g['runnableFraction']*100:.1f}% | {g['p95Ms']:.1f} | {g['p99Ms']:.1f} | {g['maxMs']:.1f} | {g['peakRssMiB']:.1f} | {g['deadlineMisses']} | {g['watchdogs']} |")
    lines += ['', '## 적재 성능 보존', '', '| 실행 조건 | 정책 | SKU | n | 적재 수 /30 | 부피 수용률 | 사용 높이 밀도 |', '|---|---|---:|---:|---:|---:|---:|']
    for g in groups:
        for c in g['conditions']:
            lines.append(f"| {PROFILE_NAMES[g['profile']]} | {NAMES[g['algorithm']]} | {c['skus']} | {c['n']} | {c['count']:.2f} | {c['acceptancePct']:.2f}% | {c['densityPct']:.2f}% |")
    lines += ['', '## 1,400회 기존 시간 기록의 계산 여유', '',
              '기존 공유 CPU·4프로세스 평가의 42,000개 판단을 다시 읽었다. 새 직렬 파일럿과 측정 부하가 다르다. 마지막 열은 9000/관측 최대시간이라는 산술 여유이며 Pi의 예상 감속 배율이 아니다.', '',
              '| 정책 | 판단 수 | P95 ms | 최대 ms | 관측 최댓값 기준 9초까지의 선형 시간 배율 |', '|---|---:|---:|---:|---:|']
    for g in original_summary:
        lines.append(f"| {NAMES.get(g['algorithm'],g['algorithm'])} | {g['decisions']} | {g['p95Ms']:.1f} | {g['maxMs']:.1f} | {g['linearSlowdownTo9000msAtObservedMax']:.2f}× |")
    lines += ['', '## 공장 장비에 적용하기 위한 다음 검사', '',
              '1. 실제 Pi 4/5에서 같은 headless 엔진을 실행하고 동일 입력 100개씩 측정한다. Mac 감속 배율로 Pi 시간을 단정하지 않는다.',
              '2. 냉각·정격 전원을 갖춘 상태에서 온도, CPU 주파수, `vcgencmd get_throttled`, 전원 저하, 프로세스 RSS, swap을 함께 기록한다.',
              '3. 카메라·SKU 인식·통신을 실제로 켜고 인지 지연을 측정해 config에 반영한다. 현재 인지 0초 가정을 공장 보장값으로 쓰지 않는다.',
              '4. 실제 생산 박스 수·SKU·크기로 반복하고, 적재 성능·P95/P99/최대·watchdog·기한 초과를 함께 확인한다. 필요하면 최소 30분 연속 시험으로 발열 후 성능을 확인한다.', '',
              '## 구체적 개선 후보', '',
              '- 공장 장치에서는 headless 배치 엔진을 돌리고 3D 시연 화면은 별도 표시 장치에 둔다. 이번 RSS에는 브라우저·3D·영상 인식이 포함되지 않는다.',
              '- 한 팔레트 판단에는 현재 단일 플래너 worker를 사용한다. 벤치마크 4프로세스는 서로 독립인 시행을 병렬 실행한 것이며 판단 하나를 4코어로 가속한 것이 아니다.',
              '- 더 많은 박스에서 기하/지지 검사를 반복하는 비용과 Tetris 잔량 rollout을 실제 CPU 프로파일로 확인한 뒤 캐시·중복 검사 제거·후보 예산을 검토한다. 후보 축소는 적재 성능을 재검증해야 한다.',
              '- 장비별 검색 예산 조절이나 fallback 정책을 도입할 때는 실제 인지·통신 시간을 남겨 두고 원자료 기준 성능 보존을 확인한다. 이번 검사에서는 엔진·후보 수·정책을 변경하지 않았다.', '',
              '## 재현', '', '프로젝트 루트(alps-simulator)에서 Node 24와 Python 3으로 실행한다. 실제 Pi에서는 우선 실행 제한 없이 측정한다.', '',
              '```sh', 'python3 scripts/edge-hardware-run.py --profiles native --out docs/edge-hardware/target-board-pilot', '```', '',
              '기본은 5개 순서다. `--indices`에 0~99 인덱스를 쉼표로 나열하면 전체 100개씩 검사가 가능하다. 자체 생성 파일을 평가 원본 evaluation-v2 폴더에 덮어쓰지 않는다.', '',
              '## 공식 근거', '',
              '- [Raspberry Pi 5 사양·냉각·전원](https://www.raspberrypi.com/products/raspberry-pi-5/)',
              '- [Raspberry Pi 온도·주파수 제어](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#frequency-management-and-thermal-control)',
              '- [Node resourceUsage: maxRSS는 KiB](https://nodejs.org/docs/latest-v24.x/api/process.html#processresourceusage)',
              '- [V8 old-generation 제한](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib)',
              '- [Docker CPU/RAM 제한과의 구별](https://docs.docker.com/engine/containers/resource_constraints/)', '',
              '모델/메모리는 아직 미정이며 실제 Raspberry Pi를 연결해 실행하지 않았다. 특정 보드에서 무문제로 동작한다는 결론은 남겨 두었다.', '']
    lines += ['## 엣지 컴퓨팅 적용 구조 — 제안', '',
              '라즈베리 파이처럼 현장 가까이에 있는 장치에서 입고 데이터를 받아 ALPS의 배치 위치·방향·순서를 계산하면 엣지 컴퓨팅 구조에 해당한다. 현장 Mac의 로컬 실행도 엣지에 해당하며 Pi 전환의 추가 가치는 소형화·저가 장치 배포에 있다. ALPS는 휴리스틱 최적화 엔진이므로 이 구조만으로 학습 모델 기반 Edge AI라고 부르지는 않는다. [AWS의 엣지 컴퓨팅 설명](https://aws.amazon.com/what-is/edge-computing/)', '',
              '```mermaid', 'flowchart LR', '  A[입고 규격 · SKU · 수량] --> B[Pi의 ALPS 배치 엔진]',
              '  B -->|배치 계획| C[로봇 제어기]', '  C -->|궤적 · 모터 제어| D[로봇팔]',
              '  D -->|실행 성공/실패 · 위치| B', '```', '',
              '- Pi: 입력 수신, 배치 계획, 기하·지지 검증, 팔레트 상태 관리와 재계획.',
              '- 로봇 제어기: 해당 모델이 지원하는 명령으로 목표를 받고 이동·모터 제어·안전 정지를 수행한다. Pi가 기존 제어기나 안전 회로를 대체하는 설계가 아니다.',
              '- UR의 경우 외부 애플리케이션과 제어기를 TCP/IP로 연결하는 RTDE가 공식 제공된다. RTDE 일반 레지스터에 목표 데이터를 넣고 로봇 쪽 프로그램이 해석하는 방식은 연동 후보이며, RTDE 자체가 ALPS 좌표를 바로 실행하는 동작 명령은 아니다. 다른 제조사는 해당 모델의 공식 인터페이스를 확인해야 한다. [UR RTDE 가이드](https://docs.universal-robots.com/tutorials/communication-protocol-tutorials/rtde-guide.html)',
              '- 현재 출력은 팔레트 기준 박스 배치다. 로봇 기준 좌표, 박스 기준점, 그리퍼 TCP와 단위(mm↔m 등), 회전 표현을 보정·변환해야 한다. 실제 관절 도달성·충돌·파지 검증은 이번 적재 계산 검사에 포함되지 않았다.',
              '- 명령에는 작업 ID·상태 버전·유효 기한을 두고, 로봇의 완료 응답과 파지/배치 확인 후에만 실제 팔레트 상태를 갱신한다. 중복 명령·지연된 응답은 재실행하지 않도록 설계한다.',
              '- 현장 루프에 외부 Claude/API 호출을 넣을 필요는 없다. 이번 headless ALPS 검사는 로컬 계산만 사용했다. 클라우드는 선택적으로 기록 수집·오프라인 분석·버전 배포에 활용할 수 있다. 로컬 인식과 제어 경로까지 구성하면 인터넷 단절 중의 계속 운전도 검사할 수 있다.', '',
              '발표용 문장: **“현장의 소형 컴퓨터에서 혼합 SKU 적재 계획을 계산하고 로봇 제어기에 전달하는 엣지 컴퓨팅 기반 팔레타이징 구조를 제안한다. 저자원 내성 파일럿을 완료했으며, 실제 Pi·로봇 연동 검증을 후속 단계로 둔다.”**', '',
              '## 원가 대비 절감 — 신규 계산 장치 구입비의 조건부 비교', '',
              '2026-10-10 확인한 소비자 표시가격을 비교했다. 현재 시험 Mac의 실제 구입가격은 모르므로 신규 Mac mini 시작 가격 1,499,000원을 **가격 기준**으로만 삼았다. 이 Mac mini의 성능을 시험한 것이 아니다. [Apple 가격](https://www.apple.com/kr/shop/buy-mac/mac-mini)', '',
              '| 신규 장치 가격 참조 | 구입비 | 기준 대비 차액 | 구입비 절감률 | 동일 실처리량일 때만: 구입비당 처리량 비율 |',
              '|---|---:|---:|---:|---:|']
    for kit in context['kits']:
        lines.append(f"| [Pi 5 4GB 키트 · {kit['vendor']}]({kit['url']}) | {kit['priceKRW']:,}원 | {kit['savingKRW']:,}원 | {kit['savingPct']:.1f}% | {kit['conditionalThroughputPerPurchaseCostRatio']:.2f}× |")
    lines += ['',
              '- 엘레파츠 구성 안내에는 보드·액티브 쿨러·케이스·27W 전원·microSD·케이블 등이 포함된다. 보드 단품 가격으로 전체 장치 비용을 비교한 것은 아니다. ICbanQ는 별도 베이직 키트이며 구성 동일성을 가정하지 않았다. [엘레파츠 구성 이미지](https://img2.eleparts.co.kr/editor/goods/1/2024/05/14217537_d6a226a63113039fe5ab829b75b1d75a0827554.jpg)',
              '- 대당 약 116.9만~123.5만원, 신규 10대면 약 1,169만~1,235만원의 단순 구매 차액이다. 산업용 I/O·함체·설치·연동 개발·유지보수 비용은 추가로 반영해야 한다.',
              '- 전체 로봇 설비의 78~82%를 절감한다는 뜻이 아니다. 기존 로봇 제어기는 유지하며 로봇·카메라·그리퍼 비용도 그대로 비교 분모에 포함해야 한다.',
              '- 이미 보유한 Mac을 계속 쓸 수 있다면 Pi 구매는 신규 지출이다. 위 절감액은 앞으로 계산 장치를 새로 구입하는 경우의 비교다.',
              '- 구입비당 처리량 4.54~5.68배는 **Pi에서도 적재 품질과 기한 내 실처리량이 같다는 전제의 산술값**이다. 실제 Pi 처리량, 공장 생산량 또는 비용 효율을 측정한 결과가 아니다. 판단 시간이 길어져도 로봇의 허용 cycle 안에 들어오면 처리량이 유지될 수 있으므로 판단시간 비율을 생산량 비율로 쓰지 않는다.',
              '- 순절감액 = N × (기준 장치비 − Pi 키트비 − 대당 추가 설치비) − 일회성 개발비 − 추가 운영비. 동일 적재 성능을 만족하는 저가 PC·산업용 PC 견적이 확보되면 그 가격으로 기준을 다시 계산해야 한다.',
              '- 전기료·API 비용 절감은 계측 및 실제 대체 비용이 없어서 계산하지 않았다. 현재 ALPS의 배치 판단은 로컬 실행이므로 Mac→Pi 변경만으로 기존 Claude API 비용이 감소하는 구조는 아니다.', '']
    report = '\n'.join(lines)
    (OUT / 'report.md').write_text(report)
    (RUN / 'REPORT.md').write_text(report)
    table = ''.join(f"<tr><td>{PROFILE_NAMES[g['profile']]}</td><th>{NAMES[g['algorithm']]}</th><td>{g['p95Ms']:.1f}</td><td>{g['maxMs']:.1f}</td><td>{g['peakRssMiB']:.1f}</td><td>{g['deadlineMisses']}</td></tr>" for g in groups)
    page = f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ALPS 저자원 환경 검사</title><style>body{{margin:0;background:#f2f6fa;color:#233e50;font:15px/1.8 system-ui,sans-serif}}main{{max-width:1160px;margin:auto;padding:40px 24px}}h1{{font-size:30px;letter-spacing:-1px}}p{{max-width:1000px}}.note{{padding:18px;background:#e7eff5;border-left:3px solid #547aa5}}img{{width:100%;height:auto;background:white;border:1px solid #dce5eb}}table{{border-collapse:collapse;width:100%;background:white;font-variant-numeric:tabular-nums}}td,th{{padding:12px;text-align:right;border-bottom:1px solid #dce5eb;white-space:nowrap}}td:first-child,th{{text-align:left}}.wrap{{overflow:auto}}a{{color:#27799b}}nav{{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0}}</style><main><h1>ALPS 저자원 환경 검사</h1><p class="note"><b>라즈베리 파이 실측이 아닙니다.</b> Apple M5에서 프로세스 실행 기회를 줄인 배치 엔진 파일럿입니다. CPU 종류·캐시·발열·전원·OS·장치 RAM은 Pi와 다릅니다.</p><p>90회 · 판단 2,700개 · 각 SKU 조건의 고정 입고 순서 5개 · 기존 엔진/9초 검색 예산 유지</p><img src="hardware-comparison.png" alt="실행 제한별 판단시간과 메모리 비교"><h2>계산시간과 프로세스 메모리</h2><div class="wrap"><table><thead><tr><th>실행 조건</th><th>정책</th><th>P95 ms</th><th>최대 ms</th><th>최대 RSS MiB</th><th>기한 초과</th></tr></thead><tbody>{table}</tbody></table></div><p>정상 대비 동일 배치 {quality_matches}/90 · 기존 원자료와 동일 배치 {result['sameGeometryAsAudited']}/90 · 오류 {result['totalErrors']} · watchdog {result['totalWatchdogs']}. 이 비율은 검사한 5개 입고 순서의 결과입니다.</p><p>V8 old-generation은 isolate별 64MiB로 제한했습니다. 프로세스 전체 메모리나 장치 RAM 제한과는 다릅니다. CPU 제어는 50ms 주기이며 플래너와 supervisor 타이머를 함께 멈춥니다. 3D 화면·카메라 인식·실제 로봇·장시간 온도/전원은 포함하지 않았습니다.</p><nav><a href="hardware-comparison.png" download>비교 차트 PNG</a><a href="report.md" download>전체 검사 보고서</a><a href="summary.json" download>검산 요약 JSON</a><a href="decisions.csv" download>판단 2,700개 CSV</a><a href="../?benchmark=six#compare">6축 벤치마크로 돌아가기</a></nav><p><b>장비 채택 판단:</b> 실제 Pi에서 같은 입력을 실행하고, 인식·통신을 함께 켠 상태의 기한 준수와 발열 후 성능을 확인해야 합니다. <a href="https://www.raspberrypi.com/products/raspberry-pi-5/">공식 Pi 5 사양·냉각·전원 안내</a></p></main></html>'''
    cost_rows = ''.join(f"<tr><th><a href=\"{k['url']}\">Pi 5 4GB · {html.escape(k['vendor'])}</a></th><td>{k['priceKRW']:,}원</td><td>{k['savingKRW']:,}원</td><td>{k['savingPct']:.1f}%</td></tr>" for k in context['kits'])
    deployment_html = f'''<section id="edge"><h2>엣지 컴퓨팅으로 적용한다면</h2><img src="edge-architecture.svg" alt="입고 데이터 → Pi의 ALPS → 로봇 제어기 → 로봇팔, 실행 결과는 ALPS로 피드백"><p>현장의 Pi가 적재 위치·방향·순서를 계산하고, 로봇 제어기가 이동과 모터 제어·안전 정지를 수행하는 구조입니다. 현장 Mac의 로컬 실행도 엣지에 해당하며, Pi는 소형·저가 장치로 배포하기 위한 선택입니다. 현재는 적용 제안이며 실제 Pi·로봇 연동 검사는 하지 않았습니다. <a href="https://aws.amazon.com/what-is/edge-computing/">엣지 컴퓨팅 설명</a> · <a href="{context['robotInterfaceExample']}">공식 외부 통신 예시: UR RTDE</a></p><p>ALPS의 팔레트 기준 좌표를 로봇·그리퍼 기준으로 변환하고, 실제 도달성·충돌·파지를 확인하는 연동 계층이 필요합니다. 실행 완료를 확인한 뒤에 실제 적재 상태를 갱신합니다. 배치 판단에는 외부 Claude/API가 필요하지 않습니다.</p></section>
<section id="cost"><h2>신규 계산 장치 구매비: 약 78~82% 절감 가능</h2><p><a href="{context['baseline']['url']}">Mac mini 시작 가격 1,499,000원</a>을 비교 기준으로 삼았습니다. 현재 시험 Mac의 실제 구입가격과는 다릅니다. 2026-10-10 확인 · Pi 키트 VAT 포함 · 전체 로봇 설비 원가 절감률이 아닙니다.</p><div class="wrap"><table><thead><tr><th>구입비 참조</th><th>판매가</th><th>기준 대비 차액</th><th>절감률</th></tr></thead><tbody>{cost_rows}</tbody></table></div><p>엘레파츠 구성 안내: 보드·쿨러·케이스·27W 전원·microSD·케이블 등. 키트 간 구성은 다를 수 있습니다. 산업용 I/O·함체·연동·설치·유지보수는 별도이며, 보유 Mac을 계속 사용하는 경우 위 신규 구입비 절감을 적용할 수 없습니다.</p><p><b>비용 효율 판단:</b> 실제 Pi에서도 적재 품질과 기한 내 실처리량이 같다면 구입비당 처리량은 산술적으로 4.54~5.68배가 됩니다. 이 값은 조건부 계산이며 Pi 성능 실측 결과가 아닙니다. 전력·공장 생산량·API 비용 절감은 아직 측정하지 않았습니다.</p></section>'''
    page = page.replace('<h2>계산시간과 프로세스 메모리</h2>', deployment_html + '<h2>계산시간과 프로세스 메모리</h2>')
    page = page.replace('<a href="hardware-comparison.png" download>', '<a href="edge-architecture.svg" download>엣지 구조 SVG</a><a href="cost-reference.json" download>가격 근거 JSON</a><a href="hardware-comparison.png" download>')
    (OUT / 'report.html').write_text(page)
    plot(result)
    print(json.dumps({k: result[k] for k in ['evaluatedTrials', 'decisionCount', 'sameGeometryAsNative', 'sameGeometryAsAudited', 'totalDeadlineMisses', 'totalErrors', 'totalWatchdogs']}, ensure_ascii=False))


def plot(result):
    os.environ.setdefault('MPLCONFIGDIR', '/tmp/alps-radar-matplotlib')
    os.environ.setdefault('XDG_CACHE_HOME', '/tmp/alps-radar-cache')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    import numpy as np
    font = Path('/System/Library/Fonts/AppleSDGothicNeo.ttc')
    if font.exists():
        font_manager.fontManager.addfont(str(font))
        plt.rcParams['font.family'] = font_manager.FontProperties(fname=font).get_name()
    plt.rcParams['axes.unicode_minus'] = False
    fig, axes = plt.subplots(1, 2, figsize=(14, 7), gridspec_kw={'width_ratios': [1.25, 1]}, facecolor='#f2f6fa')
    fig.subplots_adjust(left=.07, right=.96, top=.74, bottom=.26, wspace=.25)
    fig.text(.07, .92, 'ALPS 저자원 환경 검사', fontsize=25, color='#233e50', weight='bold')
    fig.text(.07, .861, 'Pi 실측 아님 · Apple M5 프로세스 실행 제한 · 90회 / 판단 2,700개', fontsize=13, color='#617c8f')
    fig.text(.07, .811, '동일 입력·엔진·9초 검색 예산 · 6/8 SKU 각각 5개 순서 · V8 old-generation 64MiB / isolate', fontsize=11, color='#617c8f')
    x = np.arange(3)
    for i, profile in enumerate(PROFILES):
        groups = [next(g for g in result['groups'] if g['profile'] == profile and g['algorithm'] == a) for a in NAMES]
        positions = x + (i - 1) * .24
        bars = axes[0].bar(positions, [g['p95Ms'] for g in groups], width=.22, color=COLORS[i], label=PROFILE_NAMES[profile])
        axes[0].scatter(positions, [g['maxMs'] for g in groups], color=COLORS[i], marker='D', s=24, zorder=4)
        for px, g in zip(positions, groups):
            axes[0].plot([px, px], [g['p95Ms'], g['maxMs']], color=COLORS[i], linewidth=1)
        axes[1].bar(positions, [g['peakRssMiB'] for g in groups], width=.22, color=COLORS[i])
    axes[0].set_yscale('log')
    axes[0].set_ylim(5, 17000)
    axes[0].axhline(9000, color='#b34f47', linestyle='--', linewidth=1)
    axes[0].text(2.5, 10200, '검색 예산 9,000ms', color='#b34f47', ha='right', fontsize=10)
    axes[0].set_title('판단시간 · 막대 P95 / ◆ 관측 최댓값', fontsize=13, loc='left', color='#233e50')
    axes[0].set_ylabel('ms · 로그 눈금', color='#617c8f')
    axes[1].set_title('프로세스 전체 최대 메모리', fontsize=13, loc='left', color='#233e50')
    axes[1].set_ylabel('RSS · MiB', color='#617c8f')
    axes[1].set_ylim(0, max(g['peakRssMiB'] for g in result['groups']) * 1.25)
    for ax in axes:
        ax.set_facecolor('white'); ax.set_xticks(x); ax.set_xticklabels(list(NAMES.values()), fontsize=11)
        ax.spines[['top', 'right']].set_visible(False)
        ax.spines[['left', 'bottom']].set_color('#dbe5ec')
        ax.grid(axis='y', color='#e6edf2', linewidth=.7, zorder=0)
        ax.set_axisbelow(True)
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc='center', bbox_to_anchor=(.5, .19), ncol=3, frameon=False, fontsize=10)
    fig.text(.07, .135, f"정상 대비 동일 배치 {result['sameGeometryAsNative']}/90 · 기한 초과 {result['totalDeadlineMisses']} · 오류 {result['totalErrors']} · watchdog {result['totalWatchdogs']}", fontsize=13, color='#233e50')
    fig.text(.07, .082, 'CPU 모델·캐시·장치 RAM·발열을 재현한 시험이 아닙니다. 프로세스 타이머도 함께 멈춥니다.', fontsize=10, color='#617c8f')
    fig.text(.07, .043, '3D 화면·카메라 인식·통신·실제 로봇·장시간 운전은 별도 측정 대상입니다. 실제 Pi에서 같은 원자료로 재검사해야 합니다.', fontsize=10, color='#617c8f')
    fig.savefig(OUT / 'hardware-comparison.png', dpi=180, facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == '__main__':
    main()
