#!/usr/bin/env python3
"""Render only newly executed simulator results as exact 4K PNG + vector SVG."""
from pathlib import Path
import hashlib
import json
import os
import math

os.environ.setdefault('MPLCONFIGDIR', '/tmp/alps-charts-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/results'
BG, PANEL, INK, MUTED, GRID = '#101922', '#16232f', '#f4f5f4', '#b3c1cd', '#334451'
COLORS = {'blb': '#9db6ce', 'capacity-compact': '#5cdbc0', 'strategy-greedy': '#ffd079', 'lookahead': '#b4a1ff', 'future-hybrid': '#f49c98', 'mcts': '#69b9ff', 'floor-dense':'#ff9e5e'}
LABELS = {'blb': 'Bottom-Left-Back', 'capacity-compact': 'Compact', 'strategy-greedy': 'Greedy', 'lookahead': 'Lookahead', 'future-hybrid': 'Future Hybrid', 'mcts': 'UCT MCTS', 'floor-dense':'ALPS Tetris'}

def font_setup():
    paths = [os.environ.get('ALPS_FONT', ''), '/System/Library/Fonts/AppleSDGothicNeo.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
    path = next((p for p in paths if p and Path(p).is_file()), None)
    if not path:
        raise RuntimeError('Set ALPS_FONT to a Korean font file')
    font_manager.fontManager.addfont(path)
    plt.rcParams.update({'font.family': font_manager.FontProperties(fname=path).get_name(), 'font.size': 11,
                         'figure.facecolor': BG, 'axes.facecolor': PANEL, 'text.color': INK,
                         'axes.labelcolor': MUTED, 'xtick.color': MUTED, 'ytick.color': MUTED,
                         'axes.edgecolor': GRID, 'axes.unicode_minus': False, 'svg.fonttype': 'path', 'savefig.facecolor': BG})

def panel_style(ax):
    ax.set_axisbelow(True)
    ax.grid(axis='x', color=GRID, lw=.7)
    for side in ['top', 'right', 'left']:
        ax.spines[side].set_visible(False)
    ax.tick_params(axis='y', length=0)

def save(fig, stem):
    fig.savefig(OUT / f'{stem}.png', dpi=240)
    fig.savefig(OUT / f'{stem}.svg')
    fig.savefig(OUT / f'{stem}-preview.png', dpi=100)
    plt.close(fig)

def factors(data, cycle):
    rows = [r for r in data['summaries'] if r['cycleSeconds'] == cycle]
    assert len(rows) in [6, 7]
    revised = data['schema'] == 'alps-benchmark/2'
    fig = plt.figure(figsize=(16, 9))
    budget = cycle - data['config']['recognitionDelaySeconds'] - data['config']['reserveSeconds']
    fig.text(.045, .945, 'ALPS / 동일 공통 엔진 · 신규 실험', color='#5cdbc0', fontsize=12, weight='bold')
    limits = f'기본 후보 {data["config"]["maxCandidates"]} · MCTS 최대 {data["config"]["mcts"]["maxIterations"]}회 · 최적해 보장 없음'
    if revised: limits = f'기본 후보 {data["config"]["maxCandidates"]} / Tetris 후보 확장 / MCTS {data["config"]["mcts"]["maxIterations"]}회·깊이 {data["config"]["mcts"]["depth"]} · 동일 계산 기한'
    fig.text(.955, .945, limits, color=MUTED, fontsize=10, ha='right')
    fig.text(.045, .884, f'{cycle}초 로봇 운영 목표에서 적재 품질 비교', fontsize=28, weight='bold')
    evaluation = '독립 신규 입력 5개' if revised and cycle == 10 else '개발 후 재평가 5개 (설계에 일부 사용)' if revised else f'평가 시드 {len(data["config"]["evaluationSeeds"])}개'
    fig.text(.045, .836, f'최고 높이 1,200 mm · 입고 72개 · 버퍼 0 · 계산 기한 {budget:g}초 · {evaluation} · 실제 로봇 검증 아님', color=MUTED, fontsize=12)
    specs = [('fill', '부피 적재율 (%)', 100, 1), ('cogOffsetMm', '중심에서 수평 CoG 거리 (mm)', 1, 1),
             ('cogHeightMm', '적재물 CoG 높이 (mm)', 1, 1), ('count', '적재한 상자 수 (개)', 1, 1),
             ('voidLiters', '사용 높이 안 비점유 공간 (L)', 1, 1)]
    if revised:
        specs = [('fill', '부피 적재율 (%)', 100, 1), ('floorContactCoverage', '바닥 직접 접촉 점유율 (%)', 100, 1),
                 ('columnVoidLiters', '상자 아래 수직 공극 (L)', 1, 1), ('cogOffsetMm', '중심에서 수평 CoG 거리 (mm)', 1, 1),
                 ('cogHeightMm', '적재물 CoG 높이 (mm)', 1, 1)]
    positions = [[.155, .48, .215, .255], [.46, .48, .215, .255], [.765, .48, .19, .255],
                 [.155, .125, .215, .255], [.46, .125, .215, .255], [.765, .125, .19, .255]]
    for panel, (metric, title, scale, decimals) in enumerate(specs):
        ax = fig.add_axes(positions[panel]); panel_style(ax)
        for i, row in enumerate(rows):
            m, color = row['metrics'][metric], COLORS[row['algorithm']]
            if m['mean'] is None:
                continue
            values = m['observations']
            jitter = [(j - (len(values) - 1) / 2) * .07 for j in range(len(values))]
            ax.scatter([v * scale for v in values], [i + j for j in jitter], s=13, color=color, alpha=.45, edgecolors='none', zorder=3)
            ci = m['ci95']
            if ci:
                ax.plot([ci[0] * scale, ci[1] * scale], [i, i], lw=2, color=color, alpha=.9, zorder=3)
            ax.scatter([m['mean'] * scale], [i], s=54, color=color, edgecolors=BG, linewidth=1, zorder=4)
        ax.set_yticks(range(len(rows)), [LABELS[r['algorithm']] if panel in [0, 3] else '' for r in rows], fontsize=10)
        ax.set_ylim(len(rows) - .4, -.6)
        ax.set_title(title, loc='left', fontsize=13, pad=17, weight='bold')
        if metric in ['fill','floorContactCoverage']: ax.set_xlim(0, 100)
        else:
            lower, upper = ax.get_xlim(); ax.set_xlim(min(0, lower), max(1, upper) * 1.08)
    ax = fig.add_axes(positions[5]); panel_style(ax)
    for i, row in enumerate(rows):
        t, color = row['timing'], COLORS[row['algorithm']]
        values = [t['workerMeanMs'], t['workerP95Ms'], t['workerMaxMs']]
        if all(v is not None and v > 0 for v in values):
            ax.plot(values, [i] * 3, color=color, lw=1, alpha=.65)
            for value, marker in zip(values, ['o', 'D', '|']):
                ax.scatter([value], [i], marker=marker, s=35 if marker != '|' else 130, color=color, zorder=4)
    ax.axvline(budget * 1000, color=INK, ls='--', lw=1)
    ax.set_xscale('log'); ax.set_xlim(.1, max(budget * 1500, max((r['timing']['workerMaxMs'] or 0) * 1.2 for r in rows)))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f'{value:g}'))
    ax.set_ylim(len(rows) - .4, -.6); ax.set_yticks([])
    ax.set_title('계산 지연 (ms · 로그 축)', loc='left', fontsize=13, pad=17, weight='bold')
    ax.legend([Line2D([], [], marker=m, color=MUTED, ls='') for m in ['o', 'D', '|']], ['평균', 'P95', '최대'], fontsize=8, frameon=False, loc='upper left', bbox_to_anchor=(-.02, 1.11), ncol=3, handletextpad=.3, columnspacing=.9)
    passes = ' · '.join(f'{LABELS[r["algorithm"]]} {r["deadlinePassN"]}/{r["expectedN"]}' for r in rows)
    fig.text(.045, .07, f'기한 충족 실행: {passes}', fontsize=10, color=MUTED)
    fig.text(.045, .044, '작은 점: 시드별 관측 · 큰 점: 평균 · 선: Student t 95% CI(탐색적, 다중비교 보정 없음) · 기한/물리 통과 실행만 품질 집계', fontsize=9.5, color=MUTED)
    note = 'CoG는 상자 내부 균일 질량 가정의 정적 지표입니다. 비점유 공간은 갇힌 빈틈이 아니며, 적재량·사용 높이와 함께 해석해야 합니다.'
    if revised: note = '수직 공극은 각 위치의 최상단 상자 아래 빈 체적이며, 로봇으로 채울 수 있는지의 증명이 아닙니다. 바닥 점유율만으로 최종 적재율을 보장하지 않습니다.'
    fig.text(.045, .02, note, fontsize=9.5, color=MUTED)
    save(fig, f'benchmark-{cycle}s-quality')

def pareto(data):
    revised = data['schema'] == 'alps-benchmark/2'
    x_upper = max(165, max((r['metrics']['cogOffsetMm']['ci95'] or [0,r['metrics']['cogOffsetMm']['mean'] or 0])[1] for r in data['summaries'] if r['allPassed']) * 1.05)
    fig, axes = plt.subplots(1, 2, figsize=(16, 9))
    fig.subplots_adjust(left=.07, right=.955, bottom=.245, top=.745, wspace=.22)
    fig.text(.05, .936, 'ALPS / 품질 간 관계', color='#5cdbc0', fontsize=12, weight='bold')
    limits = f'기본 후보 {data["config"]["maxCandidates"]} · MCTS 최대 {data["config"]["mcts"]["maxIterations"]}회 / 깊이 {data["config"]["mcts"]["depth"]} / 시나리오 {data["config"]["mcts"]["scenarios"]}'
    if revised: limits = f'기본 후보 {data["config"]["maxCandidates"]} / Tetris 후보 확장 / MCTS {data["config"]["mcts"]["maxIterations"]}회·깊이 {data["config"]["mcts"]["depth"]} · 최적해 보장 없음'
    fig.text(.955, .936, limits, color=MUTED, fontsize=10, ha='right')
    fig.text(.05, .87, '많이 적재하면서 중심도 유지하는가', fontsize=29, weight='bold')
    sub = '관측 평균의 Pareto 관계 · 세 번째 기준은 CoG 높이 · 통계적 우월성이나 운송 안전 보증이 아닙니다'
    if revised: sub = '왼쪽: 독립 신규 평가 · 오른쪽: 개발 후 재평가 · 서로 다른 입력 집합이므로 두 패널 차이는 시간 예산 효과가 아닙니다'
    fig.text(.05, .815, sub, fontsize=12, color=MUTED)
    for cycle, ax in zip([10, 12], axes):
        panel_style(ax); ax.grid(axis='y', color=GRID, lw=.7)
        rows = [r for r in data['summaries'] if r['cycleSeconds'] == cycle and r['allPassed']]
        for i, row in enumerate(rows):
            x, y = row['metrics']['cogOffsetMm'], row['metrics']['fill']; color = COLORS[row['algorithm']]
            if x['mean'] is None or y['mean'] is None: continue
            ax.errorbar(x['mean'], y['mean'] * 100,
                        xerr=None if not x['ci95'] else [[x['mean'] - x['ci95'][0]], [x['ci95'][1] - x['mean']]],
                        yerr=None if not y['ci95'] else [[(y['mean'] - y['ci95'][0]) * 100], [(y['ci95'][1] - y['mean']) * 100]],
                        color=color, alpha=.35, fmt='none', lw=1.3, capsize=2)
            ax.scatter(x['mean'], y['mean'] * 100, s=115, color=color, edgecolors=INK if row['pareto'] else BG, linewidth=1.8, zorder=4)
            label_positions = {'capacity-compact': (31, 68.6), 'mcts': (88, 66.8), 'blb': (103, 63.7),
                               'future-hybrid': (107, 61.0), 'strategy-greedy': (103, 56.0), 'lookahead': (29, 56.4), 'floor-dense':(14,74.5)}
            if revised and cycle == 10: label_positions['capacity-compact'] = (22, 64.8)
            ax.annotate(LABELS[row['algorithm']], (x['mean'], y['mean'] * 100), xytext=label_positions[row['algorithm']],
                        textcoords='data', fontsize=11, color=color,
                        arrowprops={'arrowstyle':'-', 'color':color, 'lw':.7, 'alpha':.7})
        ax.set_title(f'{cycle}초 운영 목표 / 계산 기한 {cycle - 1}초', fontsize=16, loc='left', pad=18, weight='bold')
        ax.set_xlabel('수평 CoG 거리 (mm)  ← 작을수록 중심에 가까움', labelpad=15)
        ax.set_ylabel('부피 적재율 (%)  → 높을수록 더 적재', labelpad=12)
        ax.margins(y=.3); ax.set_xlim(0, x_upper)
    fig.text(.05, .108, '흰 테두리: 적재율↑·수평 CoG 거리↓·CoG 높이↓의 세 기준에서 다른 관측 평균에 지배되지 않는 알고리즘', fontsize=11, color=INK)
    fig.text(.05, .076, '가로·세로 선은 시드 평균의 95% CI입니다. 세 기준 사이에 상충 관계가 있으므로 임의 가중 종합점수나 절대 1위를 부여하지 않습니다.', fontsize=10.5, color=MUTED)
    fig.text(.05, .04, f'평가 시드 {len(data["config"]["evaluationSeeds"])}개 · 동일 입력·물리 검사·인지 0초·검증/통신 여유 1초(가정) · 자중 순서 금지 제외 · 버퍼 0', fontsize=10.5, color=MUTED)
    save(fig, 'benchmark-pareto')

def main():
    source = OUT / 'summary.json'; raw = source.read_bytes(); data = json.loads(raw)
    assert data['schema'] in ['alps-benchmark/1','alps-benchmark/2']
    assert data['complete'] is True, 'Never render partial runs as final benchmark figures'
    assert data['provenance']['newSimulationExecuted'] is True
    font_setup()
    for cycle in [10, 12]: factors(data, cycle)
    pareto(data)
    assert source.read_bytes() == raw
    manifest = {'schema': 'alps-benchmark-figures/1', 'source': 'summary.json', 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                'render': 'Matplotlib; 16×9 inch ×240 dpi; SVG text converted to paths for Korean font portability',
                'files': [{'path': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.glob('benchmark-*')) if p.suffix in ['.png', '.svg']]}
    (OUT / 'figures.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'figures': len(manifest['files']), 'sourceSha256': manifest['sourceSha256']}))

if __name__ == '__main__': main()
