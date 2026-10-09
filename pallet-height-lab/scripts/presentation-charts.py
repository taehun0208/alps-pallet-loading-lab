#!/usr/bin/env python3
"""Render presentation figures from recorded capacity trials; never recompute timings.

Usage: python scripts/presentation-charts.py
Dependency: matplotlib (tested with 3.11.2). Korean font required, or set ALPS_FONT.
Every line/whisker is an observed min--max over the two held-out arrival seeds,
not a confidence interval. Incomplete groups have no comparative mean.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import shutil
import zipfile
from collections import Counter
from pathlib import Path
from statistics import mean

os.environ.setdefault("MPLCONFIGDIR", "/tmp/alps-charts-matplotlib")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.ticker import MultipleLocator

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/capacity/results.json"
OUT = ROOT / "docs/presentation/charts"
OUT.mkdir(parents=True, exist_ok=True)
D = json.loads(SOURCE.read_text())
ROWS = D["rows"]
HOLDOUT = D["config"]["holdoutSeeds"]
BG, PANEL, INK, MUTED, GRID = "#101922", "#16232f", "#f4f5f4", "#b3c1cd", "#334451"
COLORS = {"blb": "#9db6ce", "capacity-compact": "#5cdbc0", "strategy-greedy": "#ffd079", "lookahead": "#b4a1ff", "future-hybrid": "#f49c98"}
LABELS = {"blb": "Bottom-Left-Back", "capacity-compact": "Compact", "strategy-greedy": "Greedy", "lookahead": "Lookahead", "future-hybrid": "Future-Aware Hybrid"}
ORDER = ["capacity-compact", "blb", "strategy-greedy", "lookahead"]
FONT_PATHS = [os.environ.get("ALPS_FONT", ""), "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
font = next((p for p in FONT_PATHS if p and Path(p).exists()), None)
if not font:
    raise SystemExit("Korean font missing. Set ALPS_FONT to a Korean font file.")
font_manager.fontManager.addfont(font)
plt.rcParams.update({"font.family": font_manager.FontProperties(fname=font).get_name(), "font.size": 12,
                     "figure.facecolor": BG, "axes.facecolor": PANEL, "text.color": INK,
                     "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.edgecolor": GRID, "svg.fonttype": "path", "axes.unicode_minus": False,
                     "savefig.facecolor": BG})


def good(r):
    return r["status"] == "finished" and not r["violations"] and r["deadlineMisses"] == 0


def group(algorithm, height=1200, mode="robot", split="holdout"):
    rr = [r for r in ROWS if r["algorithm"] == algorithm and r["height"] == height and r["mode"] == mode and r["split"] == split]
    seeds = D["config"]["holdoutSeeds" if split == "holdout" else "discoverySeeds"]
    assert len(rr) == len(seeds) and sorted(r["seed"] for r in rr) == sorted(seeds)
    return rr


def values(algorithm, field, height=1200, mode="robot"):
    rr = group(algorithm, height, mode)
    assert all(good(r) for r in rr), "Do not plot a partial-result comparative average"
    return [r[field] for r in rr]


def derive(r):
    placements = r["placements"]
    mass = sum(p["weight"] for p in placements)
    xyz = [sum(p["weight"] * (p["position"][axis] + p["size"][dim] / 2) for p in placements) / mass
           for axis, dim in [("x", "w"), ("y", "d"), ("z", "h")]] if mass else [None] * 3
    pallet = D["config"]["scenario"]["pallet"]
    r["placedCount"] = len(placements)
    r["utilizationPct"] = r["utilization"] * 100
    r["cogHeightMm"] = xyz[2]
    r["cogOffsetMm"] = math.hypot(xyz[0] - pallet["width"] / 2, xyz[1] - pallet["depth"] / 2) if mass else None
    r["placedMassKg"] = mass
    r["robotSecondsPerPlacedBox"] = r["robotSeconds"] / len(placements) if r["robotSeconds"] is not None and placements else None
    r["minSupportPct"] = min(p["supportRatio"] for p in placements) * 100 if placements else None
    r["robotAuditCount"] = len(r["robotAudit"])


for row in ROWS:
    derive(row)


def check_data():
    checks = {"trials": len(ROWS), "status": dict(Counter(r["status"] for r in ROWS)), "checks": []}
    assert len({r["id"] for r in ROWS}) == len(ROWS)
    for r in ROWS:
        p = r["placements"]
        v = sum(b["size"]["w"] * b["size"]["d"] * b["size"]["h"] for b in p)
        assert math.isclose(r["volume"], v, rel_tol=1e-12)
        assert math.isclose(r["utilization"], v / (1200 * 1000 * r["height"]), rel_tol=1e-12)
        assert len(p) + len(r["unplaced"]) + len(r["unprocessed"]) == r["total"]
        assert len({b["id"] for b in p}) == len(p)
        if r["meanMs"] is not None:
            assert math.isclose(r["computeMs"], r["meanMs"] * r["decisions"], rel_tol=1e-10)
        if good(r):
            assert not r["unprocessed"]
    checks["checks"] = ["unique trial IDs", "volume from placements", "utilization denominator", "item conservation", "unique placement IDs", "mean planner latency", "complete means use all held-out seeds"]
    return checks


def base(number, factor, title, subtitle):
    fig = plt.figure(figsize=(16, 9), dpi=120)
    fig.text(.05, .94, f"{number:02d}  /  ALPS BENCHMARK  ·  {factor}", fontsize=12, color=COLORS["capacity-compact"], weight="bold")
    fig.text(.05, .865, title, fontsize=28, weight="bold")
    fig.text(.05, .809, subtitle, fontsize=12.5, color=MUTED)
    fig.add_artist(Line2D([.05, .95], [.783, .783], transform=fig.transFigure, color=GRID, lw=1))
    return fig


def panel(fig, pos, title, subtitle=None):
    ax = fig.add_axes(pos)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.tick_params(axis="both", length=0, pad=10)
    ax.grid(axis="x", color=GRID, lw=.7, alpha=.75)
    ax.set_axisbelow(True)
    x, y, w, h = pos
    fig.text(x, y + h + .036, title, fontsize=15, weight="bold")
    if subtitle:
        fig.text(x, y + h + .005, subtitle, fontsize=10.5, color=MUTED)
    return ax


def note(fig, text, y=.157, color=MUTED, size=11.1):
    fig.text(.05, y, text, fontsize=size, color=color, linespacing=1.5)


def footer(fig, source_note="1200 mm · 로봇 제약 적용 · 검증 시드 2개"):
    fig.add_artist(Line2D([.05, .95], [.066, .066], transform=fig.transFigure, color=GRID, lw=.8))
    fig.text(.05, .032, f"내부 시뮬레이션 관측치  |  {source_note}  |  점: 평균 · 선: 관측 최솟값~최댓값 (신뢰구간 아님)", fontsize=9.4, color=MUTED)
    fig.text(.95, .032, "2026.10.10  /  capacity v1", fontsize=9.4, color=MUTED, ha="right")


def finish(fig, name):
    fig.savefig(OUT / f"{name}.png", dpi=240)
    fig.savefig(OUT / f"{name}.svg", metadata={"Title": name, "Description": "ALPS internal capacity simulation, held-out seeds 1042 and 1043. See CAPTIONS.md for methodology and limitations."})
    fig.savefig(OUT / f"{name}-preview.png", dpi=100)
    plt.close(fig)


def interval(ax, vals, y, color, marker="o", size=60, label=False, fmt=".2f", pad=1):
    avg = mean(vals)
    ax.plot([min(vals), max(vals)], [y, y], color=color, lw=4, alpha=.6, solid_capstyle="round")
    ax.scatter(vals, [y] * len(vals), s=22, marker="|", color=color, linewidths=1.8, zorder=3)
    ax.scatter([avg], [y], s=size, marker=marker, color=color, edgecolors=PANEL, linewidths=.7, zorder=4)
    if label:
        ax.text(max(vals) + pad, y, format(avg, fmt), color=color, va="center", fontsize=12, weight="bold")


def chart_space_speed():
    fig = base(1, "공간 효율 / 계산 속도", "적재율과 판단 속도를 같은 조건에서 비교", "1,200 × 1,000 mm 팔레트 1개 · 최고 높이 1,200 mm · 로봇 제약 적용 · 동일 72개 입고")
    left = panel(fig, [.20, .285, .305, .425], "부피 적재율  ↑", "적재 부피 / 허용 부피 × 100")
    right = panel(fig, [.61, .285, .34, .425], "한 번의 배치 판단 계산시간  ↓", "원: 평균  /  마름모: 실행별 P95의 평균")
    for ax in (left, right):
        ax.set_ylim(-.5, 4.5)
        ax.set_yticks([])
    left.set_xlim(0, 85)
    left.set_xticks([0, 20, 40, 60, 80], ["0", "20", "40", "60", "80%"])
    right.set_xlim(0, 75)
    right.set_xticks([0, 15, 30, 45, 60, 75], ["0", "15", "30", "45", "60", "75 ms"])
    for i, a in enumerate(ORDER):
        y = 4 - i
        color = COLORS[a]
        left.text(-.49, y, LABELS[a], transform=left.get_yaxis_transform(), color=color, weight="bold", va="center", fontsize=13)
        if a == "capacity-compact":
            left.text(-.49, y - .29, "현재 입고 전용 변형", transform=left.get_yaxis_transform(), color=MUTED, fontsize=9.2, va="center")
        if a == "strategy-greedy":
            left.text(-.49, y - .29, "선택 시드에서 사전 채택", transform=left.get_yaxis_transform(), color=MUTED, fontsize=9.2, va="center")
        interval(left, values(a, "utilizationPct"), y, color, label=True, pad=2)
        interval(right, values(a, "meanMs"), y + .13, color, label=True, pad=1.5)
        interval(right, values(a, "p95Ms"), y - .13, color, marker="D", size=44, label=True, pad=1.5)
    for ax in (left, right):
        ax.axhline(.5, color=GRID, lw=.8)
    left.text(-.49, 0, "Future-Aware\nHybrid", transform=left.get_yaxis_transform(), color=COLORS["future-hybrid"], va="center", fontsize=12.5, weight="bold")
    left.text(3, 0, "완주 0 / 2 · 비교 평균 제외", color=COLORS["future-hybrid"], va="center", fontsize=12)
    right.text(3, 0, "2 / 2 실행에서 판단 기한 초과", color=COLORS["future-hybrid"], va="center", fontsize=12)
    note(fig, "해석  |  Compact의 검증 평균 적재율은 60.30%. Greedy는 4.21 ms, Lookahead는 20.29 ms의 평균 판단시간을 기록.", y=.199, size=11.5)
    note(fig, "주의  |  시드 2개만의 결과이며 전역 최적·통계적 우월성은 입증하지 않습니다. 알고리즘마다 같은 두 입고 순서를 사용했습니다.\n계산시간은 계획기와 구역 선호만 측정합니다. 검사·장면 렌더링·로봇 동작은 제외하며, 공유 개발 컴퓨터의 관측값입니다.", y=.111, size=10.7)
    footer(fig)
    finish(fig, "01-packing-and-compute")


def chart_height():
    fig = base(2, "높이 민감도 / 수량", "높이 제한이 달라지면 적재율과 적재 개수도 달라집니다", "검증 시드 1042 / 1043 · 높이마다 동일 72개 주문 · 로봇 제약 적용 · 각 점은 두 실행의 평균")
    left = panel(fig, [.09, .29, .385, .425], "허용 높이 기준 부피 적재율", "단위: %  /  얇은 세로선: 두 시드의 관측 범위")
    right = panel(fig, [.57, .29, .38, .425], "한 팔레트 적재 개수", "단위: 개  /  팔레트를 교체하지 않은 결과")
    for ax in (left, right):
        ax.grid(axis="y", color=GRID, lw=.7)
        ax.grid(axis="x", visible=False)
        ax.set_xlim(730, 1770)
        ax.set_xticks([800, 1200, 1600], ["800", "1,200", "1,600 mm"])
    left.set_ylim(40, 102)
    left.set_yticks([40, 50, 60, 70, 80, 90, 100], ["40", "50", "60", "70", "80", "90", "100%"])
    right.set_ylim(20, 60)
    right.set_yticks([20, 30, 40, 50, 60], ["20", "30", "40", "50", "60개"])
    heights = [800, 1200, 1600]
    for i, a in enumerate(ORDER):
        color = COLORS[a]
        marker, dash = [("o", "-"), ("s", "--"), ("D", "-"), ("^", "--")][i]
        for ax, field in [(left, "utilizationPct"), (right, "placedCount")]:
            vv = [values(a, field, h) for h in heights]
            av = [mean(v) for v in vv]
            ax.plot(heights, av, color=color, marker=marker, lw=2.2, markersize=7, ls=dash, zorder=3, label=LABELS[a])
            # Slight offsets on range stems separate overlapping seeds without moving the mean points.
            for h, v in zip(heights, vv):
                ax.vlines(h + (i - 1.5) * 9, min(v), max(v), color=color, lw=1.4, alpha=.38)
        endpoint = mean(values(a, "utilizationPct", 1600))
        # Close endpoints are explicitly separated vertically, preserving the point with leaders.
        label_y = {"capacity-compact": 58, "strategy-greedy": 49, "lookahead": 53.5, "blb": 43.5}[a]
        left.annotate(f"{endpoint:.1f}", (1600, endpoint), (1650, label_y), color=color, fontsize=11,
                      arrowprops={"arrowstyle": "-", "color": color, "lw": .7})
    bounds = [group("blb", h)[0]["supplyBound"] * 100 for h in heights]
    left.plot(heights, bounds, color=MUTED, ls=":", lw=1.2)
    left.text(820, 94.5, "공급 부피 상한 (느슨한 상한)", fontsize=10, color=MUTED)
    left.text(1620, bounds[-1] - 3, f"{bounds[-1]:.1f}%", fontsize=10, color=MUTED)
    handles = [Line2D([0], [0], color=COLORS[a], lw=2.2, marker=["o", "s", "D", "^"][i], label=LABELS[a]) for i, a in enumerate(ORDER)]
    fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(.52, .237), ncol=4, frameon=False, fontsize=12, labelcolor=INK, columnspacing=3)
    note(fig, "해석  |  최고 높이가 커지면 분모도 커집니다. 적재 개수가 늘어도 적재율은 낮아질 수 있어 두 지표를 함께 봅니다.", y=.155, size=11.1)
    note(fig, "사전 선택: 800 mm Compact · 1,200 / 1,600 mm Greedy.  Hybrid는 각 높이의 검증 0/2 완주로 선그래프에서 제외했습니다.", y=.106, size=10.5)
    footer(fig, "800 / 1200 / 1600 mm · 검증 시드 각 2개")
    finish(fig, "02-height-sensitivity")


def chart_time_cog():
    fig = base(3, "로봇 작업 / 정적 무게중심", "로봇 작업시간과 무게중심을 별도 지표로 평가", "1,200 mm · 로봇 제약 적용 · 적재된 상자의 질량과 좌표로 계산 · 동적 운송 진동 시험은 미수행")
    panels = [
        panel(fig, [.19, .30, .22, .405], "상자당 로봇 경로시간  ↓", "경로 추정 합계 / 적재 개수 · s/개"),
        panel(fig, [.47, .30, .20, .405], "화물 무게중심 높이", "질량 가중 정적 무게중심 · mm"),
        panel(fig, [.73, .30, .22, .405], "중심에서의 수평 편심", "팔레트 중심과의 거리 · mm"),
    ]
    fields = ["robotSecondsPerPlacedBox", "cogHeightMm", "cogOffsetMm"]
    for ax in panels:
        ax.set_ylim(-.6, 3.6)
        ax.set_yticks([])
    panels[0].set_xlim(0, 14)
    panels[0].set_xticks([0, 5, 10, 14], ["0", "5", "10", "14 s"])
    panels[1].set_xlim(0, 750)
    panels[1].set_xticks([0, 250, 500, 750], ["0", "250", "500", "750"])
    panels[2].set_xlim(0, 200)
    panels[2].set_xticks([0, 50, 100, 150, 200], ["0", "50", "100", "150", "200"])
    for i, a in enumerate(ORDER):
        y = 3 - i
        panels[0].text(-.64, y + .08, LABELS[a], transform=panels[0].get_yaxis_transform(), color=COLORS[a], fontsize=12.5, weight="bold", va="center")
        count, sec = mean(values(a, "placedCount")), mean(values(a, "robotSeconds"))
        panels[0].text(-.64, y - .23, f"{count:.1f}개 · 총 {sec:.1f}s", transform=panels[0].get_yaxis_transform(), color=MUTED, fontsize=9.7, va="center")
        for ax, field, pad, fmt in zip(panels, fields, [.35, 20, 5], [".2f", ".1f", ".1f"]):
            interval(ax, values(a, field), y, COLORS[a], label=True, pad=pad, fmt=fmt)
    note(fig, "해석  |  작업시간은 실제 로봇 실측이 아닌 경로 모델의 추정값입니다. 적재 수량·품목 구성이 달라 전체 소요시간 순위로 볼 수 없습니다.", y=.209, size=11)
    note(fig, "무게중심은 각 상자 내부 질량이 균일하다는 가정의 화물 기준 정적 지표입니다. 팔레트 자체 질량은 제외했습니다.\n편심·높이만으로 진동 저항성이나 운송 안전을 판정할 수 없습니다. 재분배·보류대 이동·래핑·차량 이송시간도 포함하지 않습니다.", y=.117, size=10.8)
    footer(fig, "1200 mm · 검증 시드 2개 · Hybrid 0/2 완주로 제외")
    finish(fig, "03-robot-time-and-static-cog")


def seed_row(algorithm, seed=1043):
    return next(r for r in group(algorithm) if r["seed"] == seed)


def seed_footer(fig):
    fig.add_artist(Line2D([.05, .95], [.066, .066], transform=fig.transFigure, color=GRID, lw=.8))
    fig.text(.05, .032, "저장된 기본 조건  |  1200 mm · 로봇 제약 적용  |  시드별 n=1 · 연결선은 두 관측치의 차이이며 신뢰구간 아님", fontsize=9.4, color=MUTED)
    fig.text(.95, .032, "2026.10.10  /  SEED 1043", fontsize=9.4, color=MUTED, ha="right")


def seed_pair(ax, algorithm, field, y, pad, fmt=".2f", delta=False):
    earlier, current = seed_row(algorithm, 1042), seed_row(algorithm)
    assert good(earlier) and good(current)
    old, new = earlier[field], current[field]
    color = COLORS[algorithm]
    ax.plot([old, new], [y, y], color=color, lw=2, alpha=.6)
    ax.scatter([old], [y], s=63, facecolors=PANEL, edgecolors=color, linewidths=1.6, zorder=4)
    ax.scatter([new], [y], s=70, facecolors=color, edgecolors=PANEL, linewidths=.6, zorder=5)
    # A lower 1043 value is labelled above its filled dot, never beside the
    # farther-right 1042 hollow marker (which would visually misattribute it).
    label_x = new if new < old else new + pad
    label_y = y + .26 if new < old else y + (.07 if delta else 0)
    label_align = "center" if new < old else "left"
    ax.text(label_x, label_y, format(new, fmt), ha=label_align, va="center", fontsize=12, color=color, weight="bold")
    if delta:
        ax.text(label_x, y - .22, f"{new - old:+.2f}%p", ha=label_align, va="center", fontsize=10, color=MUTED)


def chart_seed1043_space():
    fig = base(4, "SEED 1043 / 적재율 × 계산시간", "시드 1043: 적재율과 계산 속도의 단일 실행 비교", "저장된 기본 조건 · 최고 높이 1,200 mm · 72개 입고 · 각 알고리즘 1회 관측 · 빈 원 1042 / 채운 원 1043")
    panels = [
        panel(fig, [.19, .285, .23, .425], "부피 적재율  ↑", "%  /  아래 숫자: 1042 대비 변화"),
        panel(fig, [.48, .285, .19, .425], "평균 판단시간  ↓", "시드 1043 내부 판단 평균 · ms"),
        panel(fig, [.73, .285, .22, .425], "P95 판단시간  ↓", "시드 1043 내부 판단 P95 · ms"),
    ]
    for ax in panels:
        ax.set_ylim(-.5, 4.5)
        ax.set_yticks([])
        ax.axhline(.5, color=GRID, lw=.8)
    panels[0].set_xlim(0, 84)
    panels[0].set_xticks([0, 20, 40, 60, 80], ["0", "20", "40", "60", "80%"])
    panels[1].set_xlim(0, 32)
    panels[1].set_xticks([0, 10, 20, 30], ["0", "10", "20", "30"])
    panels[2].set_xlim(0, 75)
    panels[2].set_xticks([0, 15, 30, 45, 60, 75], ["0", "15", "30", "45", "60", "75"])
    for i, a in enumerate(ORDER):
        y = 4 - i
        current = seed_row(a)
        panels[0].text(-.60, y + .06, LABELS[a], transform=panels[0].get_yaxis_transform(), color=COLORS[a], fontsize=12.5, weight="bold", va="center")
        panels[0].text(-.60, y - .24, f"1043: {current['placedCount']} / 72개 적재", transform=panels[0].get_yaxis_transform(), color=MUTED, fontsize=9.5, va="center")
        seed_pair(panels[0], a, "utilizationPct", y, 2, delta=True)
        seed_pair(panels[1], a, "meanMs", y, .8)
        seed_pair(panels[2], a, "p95Ms", y, 2)
    panels[0].text(-.60, 0, "Future-Aware\nHybrid", transform=panels[0].get_yaxis_transform(), color=COLORS["future-hybrid"], fontsize=12, weight="bold", va="center")
    panels[0].text(3, 0, "1043 중단 · 순위 제외", color=COLORS["future-hybrid"], va="center", fontsize=11.3)
    panels[1].text(1, 0, "판단 기한 250 ms", color=COLORS["future-hybrid"], va="center", fontsize=10.9)
    panels[2].text(3, 0, "최대 352.50 ms", color=COLORS["future-hybrid"], va="center", fontsize=11.3)
    note(fig, "관측  |  시드 1043에서는 Lookahead 59.42%, Greedy 58.84%, Compact 58.17%, Bottom-Left-Back 58.14%를 기록했습니다.", y=.198, size=11.1)
    note(fig, "입고 순서에 따라 순위가 달라집니다. 이는 특정 시드의 사례이며, 선택 시드에서 사전 채택한 Greedy를 사후 변경하지 않습니다.\n계산시간은 저장된 계획기 측정값입니다. 공유 컴퓨터에서 측정했으며 전체 제어 지연이나 실제 로봇 동작시간은 아닙니다.", y=.111, size=10.7)
    seed_footer(fig)
    finish(fig, "04-seed1043-packing-and-compute")


def chart_seed1043_robot():
    fig = base(5, "SEED 1043 / 로봇 경로 × 정적 무게중심", "시드 1043: 입고 순서에 따른 경로와 무게중심 변화", "저장된 기본 조건 · 1,200 mm · 로봇 제약 적용 · 시드별 1회 관측 · 빈 원 1042 / 채운 원 1043")
    panels = [
        panel(fig, [.19, .30, .22, .405], "총 적재 경로시간", "확정 적재만의 로봇 경로 추정 · s"),
        panel(fig, [.47, .30, .20, .405], "화물 무게중심 높이", "질량 가중 정적 무게중심 · mm"),
        panel(fig, [.73, .30, .22, .405], "중심에서의 수평 편심", "팔레트 중심과의 거리 · mm"),
    ]
    for ax in panels:
        ax.set_ylim(-.6, 3.6)
        ax.set_yticks([])
    panels[0].set_xlim(0, 620)
    panels[0].set_xticks([0, 200, 400, 600], ["0", "200", "400", "600"])
    panels[1].set_xlim(0, 750)
    panels[1].set_xticks([0, 250, 500, 750], ["0", "250", "500", "750"])
    panels[2].set_xlim(0, 200)
    panels[2].set_xticks([0, 50, 100, 150, 200], ["0", "50", "100", "150", "200"])
    for i, a in enumerate(ORDER):
        y = 3 - i
        old, new = seed_row(a, 1042), seed_row(a)
        panels[0].text(-.64, y + .08, LABELS[a], transform=panels[0].get_yaxis_transform(), color=COLORS[a], fontsize=12.5, weight="bold", va="center")
        panels[0].text(-.64, y - .23, f"적재 {old['placedCount']} → {new['placedCount']}개", transform=panels[0].get_yaxis_transform(), color=MUTED, fontsize=10, va="center")
        for ax, field, pad in zip(panels, ["robotSeconds", "cogHeightMm", "cogOffsetMm"], [16, 20, 5]):
            seed_pair(ax, a, field, y, pad, fmt=".1f")
    note(fig, "해석  |  시드마다 적재 수량·품목 구성이 다릅니다. 경로시간이 줄었다고 동일 주문의 전체 처리 속도가 개선된 것은 아닙니다.", y=.209, size=11.1)
    note(fig, "무게중심은 박스 내부의 균일 질량을 가정한 화물 지표로, 팔레트 질량은 제외했습니다. 운송 진동 시험 결과가 아닙니다.\nHybrid는 1043에서 기한 초과로 중단되어 비교에서 제외했습니다. 재분배·보류대 이동·래핑·차량 이송시간은 포함하지 않습니다.", y=.117, size=10.7)
    seed_footer(fig)
    finish(fig, "05-seed1043-robot-and-cog")


def export_seed1043():
    all_rows = [r for r in ROWS if r["seed"] == 1043 and r["split"] == "holdout"]
    assert len(all_rows) == 45
    fields = ["id", "fingerprint", "split", "seed", "height", "algorithm", "mode", "status", "reason", "deadlineMisses", "total", "processed", "placedCount", "volume", "utilizationPct", "meanMs", "p95Ms", "maxMs", "computeMs", "decisions", "robotSeconds", "robotSecondsPerPlacedBox", "placedMassKg", "cogHeightMm", "cogOffsetMm", "minSupportPct", "crossZoneBlockers", "robotAuditCount", "supplyBound"]
    with (OUT / "seed1043-all-heights-modes-raw.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(all_rows)
    compared = []
    metrics = ["utilizationPct", "placedCount", "meanMs", "p95Ms", "maxMs", "robotSeconds", "robotSecondsPerPlacedBox", "cogHeightMm", "cogOffsetMm"]
    for a in D["config"]["algorithms"]:
        before, current = seed_row(a, 1042), seed_row(a)
        comparable = good(before) and good(current)
        record = {"algorithm": a, "height": 1200, "mode": "robot", "seed1042_status": before["status"], "seed1043_status": current["status"], "comparable_complete_trials": comparable}
        for metric in metrics:
            record[f"seed1042_{metric}"] = before[metric] if comparable else None
            record[f"seed1043_{metric}"] = current[metric] if comparable else None
            record[f"delta_1043_minus_1042_{metric}"] = current[metric] - before[metric] if comparable else None
        compared.append(record)
    with (OUT / "seed1043-vs1042-1200mm-robot.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, list(compared[0]))
        w.writeheader()
        w.writerows(compared)
    lines = ["# 시드 1043 벤치마킹 자료", "", "이번 자료는 기존 `docs/capacity/results.json`에 저장된 **기본 조건의 시드 1043**을 분리한 자료입니다. 사용자가 브라우저에서 다른 설정으로 재실행한 결과를 가져온 것은 아닙니다. 설정을 변경했다면 이 자료와 해당 새 실행을 구분해야 합니다.", "", "## 기본 조건", "", "- 1,200 × 1,000 mm 팔레트 1개, 최고 높이 1,200 mm, 6종 × 12개 = 총 72개 입고.", "- 로봇 제약 적용, 후보 48개, 버퍼 2개, 판단 기한 250 ms.", "- 그리퍼 180 × 160 × 160 mm, 도구 8 kg, 도구 포함 가반 38 kg, 속도 가정 650 mm/s, TCP 최대 수평 반경 2,700 mm, 작업공간 높이 2,600 mm.", "- 각 알고리즘의 시드 1043은 **단일 관측(n=1)**입니다. 시드 1042는 비교용 별도 단일 관측이며, 두 시드의 평균으로 표시한 기존 01~03 그래프와 구분합니다.", "- 같은 시드에서는 알고리즘별 동일한 상품·입고 순서를 사용합니다. 1042와 1043은 입고 순서가 다릅니다.", "", "## 1,200 mm · 로봇 제약 적용 결과", "", "| 알고리즘 | 1043 적재율 | 1042 대비 | 1043 적재 수 | 평균 판단 ms | P95 ms |", "|---|---:|---:|---:|---:|---:|"]
    for a in ORDER:
        old, new = seed_row(a, 1042), seed_row(a)
        lines.append(f"| {LABELS[a]} | {new['utilizationPct']:.2f}% | {new['utilizationPct'] - old['utilizationPct']:+.2f}%p | {new['placedCount']} / 72 | {new['meanMs']:.2f} | {new['p95Ms']:.2f} |")
    lines.extend(["| Future-Aware Hybrid | 중단 · 순위 제외 | — | 부분 적재 17개 | 중단 실행 | 중단 실행 |", "", "Hybrid의 최대 판단시간은 352.50 ms로 250 ms 기한을 넘었습니다. 중단 전 17개만 적재한 부분 결과는 완주 알고리즘의 적재율과 순위 비교에 사용하지 않았습니다. 1043 전체 높이·세 모드의 원시 CSV에는 상태와 부분 결과를 보존했습니다.", "", "## 그래프 04 발표 문장", "", "“기존과 같은 기본 조건에서 시드 1043의 입고 순서를 별도로 살펴봤습니다. 이번 단일 실행의 적재율은 Lookahead 59.42%, Greedy 58.84%, Compact 58.17%, Bottom-Left-Back 58.14%였습니다. 반면 평균 판단시간은 각각 22.76, 4.88, 4.29, 4.95 ms여서, 적재율만이 아니라 계산 속도도 함께 평가했습니다. 순위가 시드에 따라 달라져 여러 입고 순서에 대한 평가가 필요합니다.”", "", "이 관측치로 사전 선택을 바꾸거나 ‘1043의 승자가 일반적으로 최적’이라고 주장하지 않습니다. 1,200 mm 사전 선택은 별도 선택 시드 42·43에서 채택한 Greedy입니다.", "", "## 그래프 05 발표 문장", "", "“입고 순서가 달라지면 확정 적재한 수량·상품 구성이 달라지고, 그에 따라 로봇 경로시간과 화물 무게중심도 달라졌습니다. 이번 시간은 실제 로봇 실측이 아닌 적재 경로 추정이며, 무게중심은 박스별 질량과 최종 배치 좌표에서 계산한 정적 지표입니다.”", "", "두 시드 연결선은 두 관측치의 차이를 보여주며 통계적 오차막대·신뢰구간이 아닙니다. P95는 시드 1043 실행 안의 판단시간 분포의 P95입니다. 기존 n=2 평균 그래프의 ‘실행별 P95 평균’과 다릅니다. 무게중심·시간 계산식과 미포함 작업은 `CAPTIONS.md`와 동일합니다. 다른 상품 구성을 처리한 시간으로 동일 주문 전체 작업시간이나 진동 저항성의 개선을 주장하지 않습니다.", "", "## 파일", "", "- `04-seed1043-packing-and-compute.png/.svg`: 적재율·평균/P95 판단시간, 1042 대비.", "- `05-seed1043-robot-and-cog.png/.svg`: 총 적재 경로 추정시간·무게중심 높이·수평 편심, 1042 대비.", "- `seed1043-all-heights-modes-raw.csv`: 시드 1043, 3높이 × 5알고리즘 × 3모드 = 45행. 미완료 부분 결과도 상태와 함께 보존.", "- `seed1043-vs1042-1200mm-robot.csv`: 1,200 mm 로봇 조건의 5알고리즘 비교. 미완료 쌍의 비교 수치는 공란.", "- `SEED1043-provenance.json`: 원본 해시·기본 설정·단일 관측 명시.", "- `ALPS-seed1043-benchmark.zip`: 1043 자료만 묶은 다운로드.", "", "재현: `python scripts/presentation-charts.py` (저장 자료 재해석, 알고리즘 재실행 아님).", ""])
    (OUT / "SEED1043-CAPTIONS.md").write_text("\n".join(lines), encoding="utf-8")
    return all_rows


def export_data():
    fields = ["id", "split", "seed", "height", "algorithm", "mode", "status", "deadlineMisses", "total", "processed", "placedCount", "volume", "utilizationPct", "meanMs", "p95Ms", "maxMs", "computeMs", "decisions", "robotSeconds", "robotSecondsPerPlacedBox", "placedMassKg", "cogHeightMm", "cogOffsetMm", "minSupportPct", "crossZoneBlockers", "robotAuditCount", "supplyBound"]
    with (OUT / "benchmark-trials-derived.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(ROWS)
    summaries = []
    metric_fields = ["utilizationPct", "placedCount", "meanMs", "p95Ms", "robotSeconds", "robotSecondsPerPlacedBox", "cogHeightMm", "cogOffsetMm", "minSupportPct"]
    for height in D["config"]["heights"]:
        for mode in ["space", "robot", "organized"]:
            for a in D["config"]["algorithms"]:
                rr = group(a, height, mode)
                complete = all(good(r) for r in rr)
                out = {"height": height, "mode": mode, "algorithm": a, "split": "holdout", "expected_n": len(HOLDOUT), "completed_n": sum(good(r) for r in rr), "timeout_n": sum(r["status"] == "timeout" for r in rr), "eligible": complete}
                for metric in metric_fields:
                    vals = [r[metric] for r in rr if r[metric] is not None]
                    for op, fun in [("mean", mean), ("min", min), ("max", max)]:
                        out[f"{metric}_{op}"] = fun(vals) if complete and len(vals) == len(rr) else None
                summaries.append(out)
    with (OUT / "benchmark-holdout-summary.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, list(summaries[0]))
        writer.writeheader()
        writer.writerows(summaries)
    return summaries


def captions():
    text = """# PPT 10p 다음에 삽입할 품질 지표 차트

PNG는 3,840 × 2,160 (16:9), SVG는 글자를 경로로 보존한 벡터입니다. PPT에 PNG를 전체 슬라이드로 삽입하거나 SVG를 사용하면 됩니다. `*-preview.png`는 빠른 검토용입니다.

## 슬라이드 11 — 적재율과 판단 속도

파일: `01-packing-and-compute.png` / `.svg`

발표 문장: “동일한 72개 입고, 1,200 mm 최고 높이와 단일 팔레트 조건에서 공간 효율과 계산시간을 함께 비교했습니다. 이번 두 검증 시드에서 Compact는 평균 60.30%의 적재율을, 사전 선택된 Greedy는 평균 4.21 ms의 배치 판단시간과 55.66%의 적재율을 보였습니다. Future-Aware Hybrid는 두 실행 모두 계산 기한을 넘겨 완주 비교에서 제외했습니다.”

이 그림은 알고리즘 후보 비교이지 ALPS 전체 시스템 도입 전후의 효과 검증은 아닙니다. Compact는 현재 입고 전용 지역 변형입니다. 사전 선택은 선택 시드 42·43에 의해 이루어졌으며 1,200 mm의 선택은 Greedy입니다. 검증 시드에서 Compact가 더 높은 적재율을 보였다는 사실로 선택을 사후 변경하지 않았습니다.

## 슬라이드 12 — 높이 제한 민감도

파일: `02-height-sensitivity.png` / `.svg`

발표 문장: “높이 제한을 800, 1,200, 1,600 mm로 바꾸면 적재 개수와 부피 적재율이 다르게 움직입니다. 적재율의 분모가 허용 높이에 비례해 커지므로 물건을 더 실어도 적재율은 낮아질 수 있습니다. 따라서 두 지표를 동시에 비교했습니다.”

높이 사이의 선은 세 측정 조건을 연결하는 시각적 보조선이며 다른 높이의 결과를 검증한 것은 아닙니다. 얇은 세로선은 두 시드의 관측 범위이며 신뢰구간이 아닙니다. 점선 공급 부피 상한은 전체 입고 부피만 고려한 느슨한 상한으로, 모든 제약을 만족하는 달성 가능 최고 적재율이 아닙니다. Hybrid는 세 높이에서 각각 검증 0/2 완주입니다.

## 슬라이드 13 — 로봇 작업시간과 정적 무게중심

파일: `03-robot-time-and-static-cog.png` / `.svg`

발표 문장: “로봇의 적재 경로시간, 화물 무게중심 높이, 팔레트 중심으로부터의 수평 편심을 따로 계산했습니다. 시간은 경로 모델의 추정값이고, 무게중심은 박스별 질량과 최종 좌표에서 계산한 정적 지표입니다. 이는 향후 동적 운송 검증에 사용할 설명 지표이며, 이번 결과만으로 진동 저항성을 입증했다고 보지는 않습니다.”

상자당 시간도 알고리즘별 적재 상품 구성 차이의 영향을 받습니다. 동일 주문의 모든 상품을 출하·재분배하는 데 걸리는 시간이나 처리량이 아닙니다. 평균 총 경로시간과 적재 개수를 왼쪽에 함께 제공합니다. 전부 적재되지 않은 주문에서 ‘더 빠른 시스템’을 주장하지 않습니다. 무게중심이 낮거나 편심이 작다는 사실 하나만으로 화물 안정성 순위를 확정하지 않습니다.

## 데이터와 계산 방법

- 원시 데이터: `../../capacity/results.json` (180행: 5알고리즘 × 3높이 × 4시드 × 3조건).
- 원본 생성 시점: 2026-10-09T17:00:05.363Z (한국시간 2026-10-10 02:00).
- 측정 환경: darwin arm64 / Apple M5 / Node v24.14.1. 공유 개발 컴퓨터, 각 알고리즘 한 차례의 독립 준비 계산 제외.
- 그래프: 사전 분리된 검증 시드 1042·1043만 사용. 주 그래프는 로봇 제약 적용 조건. 알고리즘 선택에는 시드 42·43을 사용.
- 모든 점은 실행별 지표 두 개의 산술평균입니다. 선은 실제 최솟값~최댓값이며, 통계적 신뢰구간이나 오차 추정치가 아닙니다. 표본이 두 개라 일반적 우월성을 주장할 수 없습니다.
- 부피 적재율(%) = Σ(w × d × h) / (1,200 × 1,000 × 최고 높이) × 100. 전체 상자 수 72개, 후보 상한 48개, 보류 용량 2개.
- 평균 계산시간 = 실행의 판단 계산시간 합계 / 판단 횟수. 판단 기한은 250 ms. 보류 재검토도 별도 판단으로 포함합니다. 최종 검사·감사·렌더링·로봇 작동시간은 미포함.
- 그래프의 P95는 실행별 P95 두 개의 평균입니다. 모든 판단을 합친 P95가 아닙니다.
- 로봇 경로시간은 확정 적재 경로에 대한 `robotSeconds`입니다. 상자당 경로시간은 각 실행의 `robotSeconds / placedCount`를 구한 후 두 실행의 평균을 계산했습니다. 재분배·보류대 이동·래핑·차량 이송시간은 미포함.
- 정적 화물 무게중심 = Σ[상품 질량 × (박스 위치 + 해당 축 길이 / 2)] / Σ상품 질량. 내부 질량 균일 가정이며 팔레트 질량은 제외합니다. 수평 편심 = sqrt[(CoG_x - 600)^2 + (CoG_y - 500)^2].
- 지지면적 비율은 저장된 배치의 `supportRatio`이며, 모든 항목 중 최솟값을 CSV에 별도 저장했습니다.
- 시간초과·위반이 있는 그룹의 비교 평균은 CSV에도 비워두었습니다. 일부 실행만 성공한 후보를 성공한 실행만 평균내어 비교하지 않습니다. 중단된 부분 적재값은 원시 행 CSV에 상태와 함께 보존했습니다.
- 과거에 정규화한 종합점수, 임의로 만든 100점 척도나 레이더 점수는 사용하지 않았습니다.

## 발표에서 말할 수 있는 범위

이번 조건에서 나온 **내부 시뮬레이션 관측치**로 발표할 수 있습니다. “세계 최고 알고리즘”, “모든 주문에서 최적”, “실제 로봇 검증 완료”, “운송 진동 안정성 입증”, “재분배 시간 단축 검증”으로 확장하지 않습니다. 제조사 IK·전체 링크 충돌·실제 흡착·판지 압축·동적 물리는 이번 벤치마크의 검증 대상이 아닙니다. 마찰·강도는 실측이 아닌 모델 가정입니다.

## 재현과 산출물

```sh
python scripts/presentation-charts.py
```

Python 3.12, Matplotlib 3.11.2에서 생성했습니다. 한글 폰트가 필요하며 macOS의 Apple SD Gothic Neo를 자동 탐색합니다. 다른 환경은 `ALPS_FONT`로 한글 폰트 경로를 지정하세요. 실행은 저장된 결과를 읽기만 하며 알고리즘이나 계산시간을 재측정하지 않습니다.

- `benchmark-trials-derived.csv`: 원시 180행과 파생 무게중심·상자당 시간.
- `benchmark-holdout-summary.csv`: 높이·모드·알고리즘별 완주 여부, 평균·최소·최대. 불완전 그룹 평균 공란.
- `provenance.json`: 입력 SHA-256, 생성 스크립트 SHA-256, 출력 파일명과 재계산 검사.
- `index.html`: 로컬 브라우저 갤러리와 다운로드 링크.
- 관련 검토: `../EVIDENCE-REVIEW.md`.
"""
    (OUT / "CAPTIONS.md").write_text(text, encoding="utf-8")


def gallery():
    figures = [("01-packing-and-compute", "적재율과 계산 속도 · 시드 2개 평균"), ("02-height-sensitivity", "높이 제한과 적재 개수 · 시드 2개 평균"), ("03-robot-time-and-static-cog", "로봇 경로시간과 정적 무게중심 · 시드 2개 평균"), ("04-seed1043-packing-and-compute", "시드 1043 · 적재율과 계산 속도"), ("05-seed1043-robot-and-cog", "시드 1043 · 로봇 경로와 무게중심")]
    cards = "\n".join((('<section id="seed1043"><h2>시드 1043 상세 벤치마크</h2><p>기존 저장된 기본 조건의 1,200 mm / 로봇 제약 적용 실행을 분리했습니다. 시드별 단일 관측(n=1)이며, 빈 원은 1042, 채운 원은 1043입니다. 브라우저 설정을 바꾼 새 실행 결과는 이 자료와 다를 수 있습니다.</p><div class="downloads"><a href="ALPS-seed1043-benchmark.zip" download>1043 자료 ZIP</a><a href="SEED1043-CAPTIONS.md" download>1043 발표 문장·조건</a><a href="seed1043-all-heights-modes-raw.csv" download>1043 모든 높이·모드 CSV</a><a href="seed1043-vs1042-1200mm-robot.csv" download>1042 대비 CSV</a></div></section>') if stem.startswith('04-') else '') + f'<article><a href="{stem}.png"><img src="{stem}-preview.png" alt="{title}"></a><div class="caption"><h2>{title}</h2><nav><a href="{stem}.png" download>PNG · 4K</a><a href="{stem}.svg" download>SVG · 벡터</a></nav></div></article>' for stem, title in figures)
    page = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ALPS · 발표용 벤치마크 차트</title><style>
*{box-sizing:border-box}body{margin:0;background:#101922;color:#f4f5f4;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{width:min(1200px,92%);margin:60px auto}small{color:#5cdbc0;letter-spacing:.12em}h1{font-size:36px;margin:14px 0}p{line-height:1.7;color:#b3c1cd}aside{border-left:3px solid #ffd079;padding:12px 20px;background:#16232f;margin:28px 0}article{margin:32px 0;background:#16232f;border:1px solid #334451;border-radius:12px;overflow:hidden}img{display:block;width:100%;height:auto}.caption{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;gap:18px}h2{font-size:19px}nav{display:flex;gap:16px}a{color:#5cdbc0;text-underline-offset:4px}.downloads{display:flex;flex-wrap:wrap;gap:22px;margin:26px 0}footer{font-size:13px;color:#b3c1cd;margin-top:40px}@media(max-width:620px){h1{font-size:28px}.caption{display:block}nav{padding-bottom:10px}}
</style><main><small>ALPS / QUALITY METRICS</small><h1>PPT 10p 다음에 넣을 벤치마크 차트</h1><p>4K PNG와 SVG 벡터 이미지. 그래프의 원시 단위와 관측 범위를 유지하고, 불완전 실행은 비교 평균에서 제외했습니다.</p><aside>발표 범위: <strong>내부 시뮬레이션 관측치</strong>입니다. 검증 시드가 두 개뿐이며, 추가 1043 상세 그래프는 시드별 단일 관측입니다. 일반적 최적성·통계적 우월성·실제 로봇이나 운송 진동 검증을 의미하지 않습니다.<br>기존 단일 팔레트 180행 벤치마크이며, 별도 전체 주문 적재·재분배 실험과 구분합니다.</aside><div class="downloads"><a href="#seed1043">시드 1043 상세로 이동</a><a href="ALPS-benchmark-charts.zip" download>전체 발표 자료 ZIP</a><a href="CAPTIONS.md" download>평균 그래프 발표 문장</a><a href="benchmark-holdout-summary.csv" download>평균·범위 CSV</a><a href="benchmark-trials-derived.csv" download>180행 원시·파생 CSV</a><a href="provenance.json" download>출처와 재계산 확인</a></div>''' + cards + '<footer>출처: docs/capacity/results.json · Apple M5 / Node v24.14.1 · 2026-10-10 (한국시간)</footer></main></html>'
    (OUT / "index.html").write_text(page, encoding="utf-8")


if __name__ == "__main__":
    checks = check_data()
    export_data()
    chart_space_speed()
    chart_height()
    chart_time_cog()
    chart_seed1043_space()
    chart_seed1043_robot()
    seed_rows = export_seed1043()
    captions()
    gallery()
    manifest = {"source": str(SOURCE.relative_to(ROOT)), "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "source_createdAt": D["createdAt"], "source_commit": D["sourceCommit"], "experiment_sha256_recorded": D["experimentSourceSha256"], "script": "scripts/presentation-charts.py", "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "matplotlib_version": matplotlib.__version__, "environment": D["environment"], "holdout_seeds": HOLDOUT, "range_definition": "Figures 01-03: observed minimum and maximum across 2 trial metrics, not confidence interval. Figures 04-05: lines connect seed1042 and seed1043 single observations, not confidence interval.", "checks": checks, "outputs": sorted(p.name for p in OUT.iterdir() if p.name != "provenance.json" and p.suffix != ".zip")}
    (OUT / "provenance.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    seed_manifest = {"source": manifest["source"], "source_sha256": manifest["source_sha256"], "source_createdAt": D["createdAt"], "focus_seed": 1043, "comparison_seed": 1042, "observations_per_seed_algorithm_height_mode": 1, "plotted_height_mm": 1200, "plotted_mode": "robot", "raw_csv_rows": len(seed_rows), "raw_csv_status_counts": dict(Counter(r["status"] for r in seed_rows)), "config": D["config"], "note": "Saved default-condition result. Not a capture of a newly modified browser run. Incomplete pairs excluded from comparative plot and comparison CSV.", "script_sha256": manifest["script_sha256"]}
    (OUT / "SEED1043-provenance.json").write_text(json.dumps(seed_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    with zipfile.ZipFile(OUT / "ALPS-seed1043-benchmark.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.iterdir()):
            if path.is_file() and path.suffix != ".zip" and ("1043" in path.name or path.name == "CAPTIONS.md"):
                archive.write(path, path.name)
    with zipfile.ZipFile(OUT / "ALPS-benchmark-charts.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.iterdir()):
            if path.is_file() and path.suffix != ".zip":
                archive.write(path, path.name)
    public = ROOT / "public/presentation-charts"
    public.mkdir(parents=True, exist_ok=True)
    for path in OUT.iterdir():
        if path.is_file():
            shutil.copy2(path, public / path.name)
    print(json.dumps({"output": str(OUT), "checks": checks, "source_sha256": manifest["source_sha256"]}, ensure_ascii=False, indent=2))
