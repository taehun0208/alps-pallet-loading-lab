"""Export presentation-ready radar figures from the audited six-axis JSON.

Run with a Python environment containing matplotlib. No simulation is rerun.
"""
import json
import os
from pathlib import Path

os.environ.setdefault('MPLCONFIGDIR', '/tmp/alps-radar-matplotlib')
os.environ.setdefault('XDG_CACHE_HOME', '/tmp/alps-radar-cache')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/benchmark-radar'
FONT = Path('/System/Library/Fonts/AppleSDGothicNeo.ttc')
if FONT.exists():
    font_manager.fontManager.addfont(str(FONT))
    plt.rcParams['font.family'] = font_manager.FontProperties(fname=FONT).get_name()
plt.rcParams.update({'axes.unicode_minus': False, 'svg.fonttype': 'path', 'font.size': 12})
POLICIES = ['capacity-compact', 'floor-dense', 'cluster-layer']
COLORS = ['#547aa5', '#bd722d', '#218577']


def main():
    data = json.loads((OUT / 'index.json').read_text())
    assert data['auditedRuns'] == 1400 and data['complete']
    axes = data['plan']['axes']
    theta = np.linspace(0, 2 * np.pi, 6, endpoint=False)
    closed_theta = np.append(theta, theta[0])
    for condition in data['conditions']:
        rows = [next(r for r in condition['rows'] if r['algorithm'] == p) for p in POLICIES]
        fig = plt.figure(figsize=(14, 8.7), facecolor='#f2f6fa')
        fig.text(.06, .94, f"ALPS 성능 비교  /  {condition['skus']} SKU", fontsize=25, weight='bold', color='#233e50')
        fig.text(.06, .897, '우리 1,400회 시험에서 추출 · 정책별 무작위 입고 순서 100개 전체 평균', fontsize=13, color='#617c8f')
        fig.text(.06, .86, '팔레트 1,200 × 1,000mm · 높이 제한 1,200mm · 박스 30개 · 같은 입력으로 비교', fontsize=12, color='#617c8f')
        ax = fig.add_axes([.055, .22, .48, .55], projection='polar', facecolor='white')
        ax.set_theta_offset(np.pi / 2)
        ax.set_theta_direction(-1)
        ax.set_ylim(0, 100)
        ax.set_yticks([20, 40, 60, 80, 100])
        ax.set_yticklabels(['20', '40', '60', '80', '100'], color='#8196a4', fontsize=9)
        ax.set_rlabel_position(2)
        ax.set_xticks(theta)
        ax.set_xticklabels([])
        ax.spines['polar'].set_visible(False)
        ax.grid(False)
        for level in [20, 40, 60, 80, 100]:
            ax.plot(closed_theta, [level] * 7, color='#dbe5ec', linewidth=.8, zorder=0)
        for i, (angle, axis) in enumerate(zip(theta, axes)):
            ax.plot([angle, angle], [0, 100], color='#dbe5ec', linewidth=.8, zorder=0)
            ax.text(angle, 117, f"{axis['label']}\n가중치 {axis['weight']}%",
                    ha='left' if i in [1, 2] else 'right' if i in [4, 5] else 'center',
                    va='center', fontsize=12, color='#35596d', clip_on=False)
        for i, (row, color) in enumerate(zip(rows, COLORS)):
            values = [row['axes'][a['id']]['mean'] for a in axes]
            ax.plot(closed_theta, values + values[:1], color=color, linewidth=2.1,
                    linestyle=['-', '--', ':'][i], marker=['o', 's', '^'][i], markersize=5, label=row['name'])
            ax.fill(closed_theta, values + values[:1], color=color, alpha=.05)
        for i, (row, color) in enumerate(zip(rows, COLORS)):
            y = .75 - i * .158
            fig.text(.64, y, row['name'], color=color, fontsize=15, weight='bold')
            fig.text(.64, y - .053, f"{row['score']['mean']:.2f}", color='#233e50', fontsize=30, weight='bold')
            fig.text(.77, y - .049, '/ 100점', color='#8196a4', fontsize=12)
            fig.text(.64, y - .09,
                     f"평균의 95% 구간  {row['score']['ci95Low']:.2f}–{row['score']['ci95High']:.2f}  ·  n = 100",
                     color='#617c8f', fontsize=10)
        fig.text(.62, .234, '바깥쪽일수록 높은 점수', color='#35596d', fontsize=12)
        fig.text(.62, .203, '6축 원점수는 각각 0~100점으로 표시합니다.', color='#617c8f', fontsize=10)
        fig.text(.06, .125, '종합 점수  =  적재량 40 + 밀도 25 + 내부 공극 효율 10 + 바닥 활용 10 + SKU 접촉 10 + 계산 속도 5', fontsize=12, color='#35596d')
        fig.text(.06, .083, '사후 표시용 가중치 · 기존 사전 점수와 구별 · 미보정 기술통계 구간 · 팀원 시험 제외', fontsize=11, color='#617c8f')
        fig.text(.06, .047, '공극: 기둥별 최상단 아래의 빈 부피 / 속도: 실행별 판단 P95의 9,000ms 예산 대비 여유 / 정적 모델 시험', fontsize=10, color='#617c8f')
        stem = OUT / f"radar-{condition['skus']}sku"
        fig.savefig(stem.with_suffix('.png'), dpi=180, facecolor=fig.get_facecolor())
        fig.savefig(stem.with_suffix('.svg'), facecolor=fig.get_facecolor())
        svg = stem.with_suffix('.svg')
        svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()) + '\n')
        plt.close(fig)
        print(f"Exported {stem.name}.png and .svg")


if __name__ == '__main__':
    main()
