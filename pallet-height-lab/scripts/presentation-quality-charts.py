#!/usr/bin/env python3
"""Derive static quality factors from the immutable heavyRule=off capacity run.

No simulation is rerun. Only new docs/presentation/quality, public/alps-quality,
and public/alps-quality.json outputs are written; existing charts are untouched.
"""
from __future__ import annotations
from pathlib import Path
from statistics import mean
from collections import Counter
import csv
import hashlib
import json
import math
import os
import shutil
import zipfile

os.environ.setdefault("MPLCONFIGDIR", "/tmp/alps-charts-matplotlib")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.lines import Line2D

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/presentation/claude/executed-capacity.json"
OUT = ROOT / "docs/presentation/quality"
PUBLIC = ROOT / "public/alps-quality"
BG, PANEL, INK, MUTED, GRID = "#101922", "#16232f", "#f4f5f4", "#b3c1cd", "#334451"
COLORS = {"blb": "#9db6ce", "capacity-compact": "#5cdbc0", "strategy-greedy": "#ffd079", "lookahead": "#b4a1ff", "future-hybrid": "#f49c98"}
LABELS = {"blb": "Bottom-Left-Back", "capacity-compact": "Compact", "strategy-greedy": "Greedy", "lookahead": "Lookahead", "future-hybrid": "Future-Aware Hybrid"}
METRICS = ["fill", "fillPercent", "count", "cogXMm", "cogYMm", "cogOffsetMm", "cogHeightMm", "usedHeightMm", "voidLiters", "minSupport", "minSupportPercent", "loadRatioMax", "loadRatioMaxPercent", "loadRatioRawMax", "extraFit", "meanMs", "p95Ms"]


def setup_font():
    candidates = [os.environ.get("ALPS_FONT", ""), "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    path = next((p for p in candidates if p and Path(p).exists()), None)
    if not path:
        raise SystemExit("Set ALPS_FONT to a Korean font file.")
    font_manager.fontManager.addfont(path)
    plt.rcParams.update({"font.family": font_manager.FontProperties(fname=path).get_name(), "font.size": 11,
                         "figure.facecolor": BG, "axes.facecolor": PANEL, "text.color": INK,
                         "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
                         "axes.edgecolor": GRID, "svg.fonttype": "path", "axes.unicode_minus": False,
                         "savefig.facecolor": BG})


def derive(row, config):
    boxes = row["placements"]
    pallet = config["scenario"]["pallet"]
    width, depth, max_height = pallet["width"], pallet["depth"], row["height"]
    volume = sum(p["size"]["w"] * p["size"]["d"] * p["size"]["h"] for p in boxes)
    used_height = max((p["position"]["z"] + p["size"]["h"] for p in boxes), default=0)
    mass = sum(p["weight"] for p in boxes)
    cog = [sum(p["weight"] * (p["position"][axis] + p["size"][dim] / 2) for p in boxes) / mass
           for axis, dim in [("x", "w"), ("y", "d"), ("z", "h")]] if mass else [None, None, None]
    support = min((p["supportRatio"] for p in boxes), default=None)
    safety = config["scenario"]["constraints"]["stability"]["loadSafetyFactor"]
    load_raw, load_effective = [], []
    for p in boxes:
        # All saved boxes stand upright with z along original h. No unrecorded
        # material strength, axis override, or packaging value is substituted.
        assert p["orientation"] in [0, 90]
        reference = p.get("maxLoadByAxis", {}).get("h", p.get("maxLoadKg"))
        factor = p.get("strengthFactor", 1)
        if reference is not None and reference > 0 and factor > 0 and not p.get("packaging"):
            load_raw.append(p["loadAbove"] / reference)
            load_effective.append(p["loadAbove"] / (reference * factor / safety))
    all_loads_known = bool(boxes) and len(load_effective) == len(boxes)
    adjusted_max = max(load_effective) if all_loads_known else None
    known = row["status"] == "finished" and not row["violations"] and not row["deadlineMisses"] and not row["unprocessed"]
    fill = volume / (width * depth * max_height)
    nonoccupied = width * depth * used_height - volume
    assert len({p["id"] for p in boxes}) == len(boxes)
    assert len(boxes) + len(row["unplaced"]) + len(row["unprocessed"]) == row["total"]
    assert math.isclose(volume, row["volume"], abs_tol=1e-8)
    assert math.isclose(fill, row["utilization"], abs_tol=1e-12)
    assert math.isclose(used_height, row["usedHeight"], abs_tol=1e-8)
    assert nonoccupied >= -1e-8
    if row["meanMs"] is not None:
        assert math.isclose(row["meanMs"] * row["decisions"], row["computeMs"], rel_tol=1e-9, abs_tol=1e-7)
    return {
        "id": row["id"], "algorithm": row["algorithm"], "split": row["split"], "seed": row["seed"],
        "status": row["status"], "eligible": known, "heightLimitMm": max_height, "mode": row["mode"],
        "fill": fill, "fillPercent": fill * 100, "count": len(boxes), "arrivalCount": row["total"],
        "unplaced": len(row["unplaced"]), "unprocessed": len(row["unprocessed"]),
        "volumeLiters": volume / 1e6, "massKg": mass,
        "cogXMm": cog[0], "cogYMm": cog[1], "cogOffsetMm": math.hypot(cog[0] - width / 2, cog[1] - depth / 2) if mass else None,
        "cogHeightMm": cog[2], "usedHeightMm": used_height, "envelopeLiters": width * depth * used_height / 1e6,
        "voidLiters": nonoccupied / 1e6, "minSupport": support, "minSupportPercent": support * 100 if support is not None else None,
        "loadRatioRawMax": max(load_raw) if all_loads_known else None,
        "loadRatioMax": adjusted_max, "loadRatioMaxPercent": adjusted_max * 100 if adjusted_max is not None else None,
        "loadSafetyFactor": safety, "loadEvaluatedBoxes": len(load_effective), "loadUnknownBoxes": len(boxes) - len(load_effective),
        "extraFit": row["extraFit"], "extraFitAny": row["extraFit"] > 0, "extraFitProbeChecked": row["probeChecked"],
        "meanMs": row["meanMs"], "p95Ms": row["p95Ms"], "maxMs": row["maxMs"], "computeMs": row["computeMs"], "decisions": row["decisions"],
        "sourceCallDeadlineMs": config["decisionMs"], "sourceDeadlineMisses": row["deadlineMisses"],
        "sourceCallDeadlinePassed": row["maxMs"] <= config["decisionMs"] if row["maxMs"] is not None else None,
        "postHocCallsWithin10000ms": row["maxMs"] <= 10000 if row["maxMs"] is not None else None,
        "postHocCallsWithin12000ms": row["maxMs"] <= 12000 if row["maxMs"] is not None else None,
        "recordedViolations": len(row["violations"]), "recordedRobotAuditViolations": len(row["robotAudit"]),
        "trappedVoidLiters": None, "dynamicVibrationResistance": None, "fullRobotIKPass": None,
        "recognitionLatencyMs": None, "measuredRobotCycleSeconds": None, "endToEndCyclePass10s": None,
    }


def load_analysis():
    raw = SOURCE.read_bytes()
    data = json.loads(raw)
    assert data["schema"] == "alps-claude-capacity-8s/1" and data["status"] == "executed"
    config = data["config"]
    assert config["scenario"]["constraints"]["heavyRule"] == "off"
    assert config["decisionMs"] == 8000 and config["heights"] == [1200] and len(data["rows"]) == 40
    rows = [derive(r, config) for r in data["rows"]]
    algorithms = []
    order = [data["selectedAlgorithm"]] + [a for a in config["algorithms"] if a != data["selectedAlgorithm"]]
    for a in order:
        rr = sorted([r for r in rows if r["split"] == "holdout" and r["algorithm"] == a], key=lambda r: r["seed"])
        assert [r["seed"] for r in rr] == config["holdoutSeeds"] and len(rr) == 5
        complete = all(r["eligible"] for r in rr)
        record = {"id": a, "label": LABELS[a], "n": sum(r["eligible"] for r in rr), "expectedN": 5,
                  "eligibleComparison": complete, "selectedOnDiscovery": a == data["selectedAlgorithm"]}
        ranges = {}
        for metric in METRICS:
            values = [r[metric] for r in rr]
            available = complete and all(v is not None for v in values)
            record[metric] = mean(values) if available else None
            ranges[metric] = {"n": len(values) if available else 0, "min": min(values) if available else None,
                              "max": max(values) if available else None}
        record.update({"maxMs": max(r["maxMs"] for r in rr if r["maxMs"] is not None),
                       "extraFitAny": any(r["extraFitAny"] for r in rr), "extraFitPositiveRuns": sum(r["extraFitAny"] for r in rr),
                       "callDeadlinePassRuns": sum(r["sourceCallDeadlinePassed"] is True for r in rr),
                       "postHoc10sCallPassRuns": sum(r["postHocCallsWithin10000ms"] is True for r in rr),
                       "postHoc12sCallPassRuns": sum(r["postHocCallsWithin12000ms"] is True for r in rr),
                       "trappedVoidLiters": None, "dynamicVibrationResistance": None, "fullRobotIKPass": None,
                       "recognitionLatencyMs": None, "measuredRobotCycleSeconds": None, "endToEndCyclePass10s": None,
                       "ranges": ranges, "observations": rr})
        algorithms.append(record)
    source = {"path": str(SOURCE.relative_to(ROOT)), "sha256": hashlib.sha256(raw).hexdigest(), "schema": data["schema"],
              "startedAt": data["startedAt"], "finishedAt": data["finishedAt"], "environment": data["environment"],
              "modelProvenance": data["provenance"], "rows": 40, "selectionSeeds": config["discoverySeeds"],
              "holdoutSeeds": config["holdoutSeeds"], "heavyRule": "off", "callDeadlineMs": 8000,
              "currentOperatingTargetSeconds": [10, 12], "currentTargetAnalysis": "post-hoc comparison of recorded per-call maxima only; no rerun or end-to-end guarantee",
              "selectedAlgorithm": data["selectedAlgorithm"], "newSimulationExecuted": False}
    result = {"schema": "alps-static-quality/1", "source": source, "algorithms": algorithms, "rows": rows,
              "units": {"fill": "fraction", "fillPercent": "%", "count": "boxes", "cogXMm": "mm", "cogYMm": "mm", "cogOffsetMm": "mm", "cogHeightMm": "mm", "usedHeightMm": "mm", "voidLiters": "L", "minSupport": "fraction", "minSupportPercent": "%", "loadRatioMax": "fraction of assumed safety-adjusted allowable top load", "extraFit": "number of remaining SKU types with a sampled feasible candidate", "meanMs": "ms", "p95Ms": "mean of per-trial P95 in algorithm summaries; per-trial P95 in rows", "maxMs": "maximum observed per-call elapsed ms"},
              "definitions": {"cog": "sum(mass * box geometric center) / total cargo mass; uniform mass distribution within each box; pallet mass excluded", "voidLiters": "palletWidth * palletDepth * usedHeight / 1e6 - boxVolume / 1e6; includes all unoccupied envelope space, not trapped or inaccessible void", "loadRatioMax": "max(loadAbove / (maxLoadKg * strengthFactor / loadSafetyFactor)); assumed synthetic strengths; unknown strengths yield null", "extraFit": "sampled wider residual candidate check, not an optimality certificate", "latency": "recorded wall-clock planner calls only; auditing, sensing, communication and real robot control excluded"},
              "limitations": ["Static factors describe different loaded product mixtures and quantities; no arbitrary combined score is used.", "Horizontal balance and low cargo CoG do not establish vibration resistance or transport safety.", "Source retained its original 8-second per-call limit. Current 10-12 second targets are post-hoc comparisons only.", "Multiple buffer retries may occur after one placement, so individual calls within a target do not establish an end-to-end robot cycle.", "Sampled extraFit=0 does not prove global optimality or absence of any feasible packing.", "MCTS is not included in this five-algorithm artifact."]}
    return data, raw, result


def render(result):
    setup_font()
    fig = plt.figure(figsize=(16, 9), dpi=120)
    fig.text(.05, .94, "08 / ALPS QUALITY FACTORS · 기존 40회 기록의 독립 재계산", fontsize=12, color=COLORS["capacity-compact"], weight="bold")
    fig.text(.05, .865, "적재율·균형·빈공간을 함께 비교", fontsize=29, weight="bold")
    fig.text(.05, .810, "단일 팔레트 1,200 mm · 입고 72개 · 로봇 제약 적용 · 무게 순서 규칙 OFF · 평가 시드 5개 · 작은 점: 실행 / 큰 점: 평균", fontsize=12, color=MUTED)
    fig.add_artist(Line2D([.05, .95], [.783, .783], transform=fig.transFigure, color=GRID, lw=1))
    specs = [
        ("fillPercent", "부피 적재율 (%)", "허용 높이 기준 · 많을수록 더 적재", [.19, .49, .22, .21], (0, 100), [0, 25, 50, 75, 100], None),
        ("cogOffsetMm", "수평 무게중심 편심 (mm)", "화물 중심과 팔레트 중심의 거리", [.47, .49, .21, .21], (0, 220), [0, 50, 100, 150, 200], None),
        ("voidLiters", "사용 높이까지 남은 체적 (L)", "외접 부피 - 상자 부피 · 갇힌 빈틈 아님", [.75, .49, .20, .21], (0, 900), [0, 300, 600, 900], None),
        ("minSupportPercent", "최소 지지면적 비율 (%)", "실행마다 가장 작은 상자 지지 비율", [.19, .205, .22, .21], (0, 112), [0, 25, 50, 75, 100], 85),
        ("cogHeightMm", "화물 무게중심 높이 (mm)", "박스 질량 가중 · 팔레트 질량 제외", [.47, .205, .21, .21], (0, 800), [0, 200, 400, 600, 800], None),
        ("loadRatioMaxPercent", "가정 허용하중 사용률 (%)", "실행 내 최대 · 안전계수 1.2 반영", [.75, .205, .20, .21], (0, 118), [0, 25, 50, 75, 100], 100),
    ]
    for panel_i, (metric, title, subtitle, pos, limits, ticks, threshold) in enumerate(specs):
        ax = fig.add_axes(pos)
        ax.spines[["top", "right", "left"]].set_visible(False)
        ax.set_ylim(-.5, 4.5); ax.set_xlim(*limits); ax.set_xticks(ticks); ax.set_yticks([])
        ax.tick_params(length=0, pad=8, labelsize=9.5)
        ax.grid(axis="x", color=GRID, lw=.65); ax.set_axisbelow(True)
        x, y, w, h = pos
        fig.text(x, y + h + .036, title, fontsize=13.6, weight="bold")
        fig.text(x, y + h + .008, subtitle, fontsize=9.8, color=MUTED)
        if threshold is not None:
            ax.axvline(threshold, color=INK, alpha=.42, lw=.9, ls=":")
        for i, a in enumerate(result["algorithms"]):
            row_y, color = 4 - i, COLORS[a["id"]]
            if panel_i in [0, 3]:
                ax.text(-.635, row_y + (.09 if panel_i == 0 else 0), a["label"], transform=ax.get_yaxis_transform(), color=color, fontsize=10.2, weight="bold", va="center")
                if panel_i == 0:
                    ax.text(-.635, row_y - .22, f"{a['count']:.1f}개 · 높이 {a['usedHeightMm']:.0f} mm", transform=ax.get_yaxis_transform(), color=MUTED, fontsize=8.6, va="center")
            vals = [r[metric] for r in a["observations"]]
            if not a["eligibleComparison"] or any(v is None for v in vals):
                ax.text(limits[1] * .1, row_y, "미측정 / 비교 제외", fontsize=10, color=MUTED, va="center")
                continue
            avg = mean(vals)
            ax.plot([min(vals), max(vals)], [row_y, row_y], color=color, lw=1.5, alpha=.4)
            ax.scatter(vals, [row_y + .10, row_y - .10, row_y + .06, row_y - .06, row_y], s=16, color=color, alpha=.65, zorder=3)
            ax.scatter(avg, row_y, s=54, color=color, edgecolors=PANEL, linewidths=.8, zorder=4)
            span = limits[1] - limits[0]
            ax.text(max(vals) + span * .025, row_y, f"{avg:.1f}", color=color, va="center", fontsize=9.8, weight="bold")
    holdout = [r for r in result["rows"] if r["split"] == "holdout"]
    maximum = max(r["maxMs"] for r in holdout)
    extra = sum(r["extraFitAny"] for r in holdout)
    fig.text(.05, .142, f"보조 확인 | 원본 호출 한도 8초 · 평가 최대 {maximum:.1f} ms · 사후 10초 기준도 25/25 실행의 호출 최대가 충족 (전체 제어주기 미검증)", fontsize=10.6, color=MUTED)
    fig.text(.05, .099, f"잔여 후보 검사 양성 {extra}/25회는 샘플 탐색 결과입니다. 남은 체적은 갇힌 빈틈이 아니며, 무게중심·지지·가정 하중 지표로 진동·현장 안전을 입증하지 않습니다.", fontsize=10.2, color=MUTED)
    fig.add_artist(Line2D([.05, .95], [.063, .063], transform=fig.transFigure, color=GRID, lw=.8))
    fig.text(.05, .030, "출처: executed-capacity.json · heavyRule=off · 평가 2410~2414 · 5관측 + 평균 · 선은 범위 (신뢰구간 아님) · MCTS 미포함", fontsize=9.4, color=MUTED)
    fig.text(.95, .030, "STATIC FACTORS / n=5", fontsize=9.4, color=MUTED, ha="right")
    for suffix, dpi in [(".png", 240), ("-preview.png", 100)]:
        fig.savefig(OUT / f"08-packing-balance-void{suffix}", dpi=dpi)
    fig.savefig(OUT / "08-packing-balance-void.svg", metadata={"Title": "ALPS static quality factors", "Description": "Independent derived static factors from immutable heavyRule=off executed-capacity.json. Original per-call allowance 8s; 10-12s targets evaluated post hoc only. Five holdout observations per algorithm. Nonoccupied envelope volume is not trapped void."})
    plt.close(fig)


def export(data, result):
    text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    (OUT / "alps-quality.json").write_text(text, encoding="utf-8")
    with (OUT / "quality-trials40.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, list(result["rows"][0])); writer.writeheader(); writer.writerows(result["rows"])
    flat = [{k: v for k, v in a.items() if k not in ["ranges", "observations"]} for a in result["algorithms"]]
    with (OUT / "quality-holdout5-summary.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, list(flat[0])); writer.writeheader(); writer.writerows(flat)
    provenance = {"source": result["source"], "generator": "scripts/presentation-quality-charts.py", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "matplotlib": matplotlib.__version__, "checks": ["40 rows and heavyRule=off source", "72 = placed + unplaced + unprocessed; unique box IDs", "volume and fill independently from saved dimensions", "used height independently from saved top coordinates", "mean planner call time times call count equals stored total", "five holdout seeds per algorithm; no discovery rows in chart means", "all missing measurements represented as null"], "immutableInputs": [str(SOURCE.relative_to(ROOT))], "noNewExperiment": True}
    (OUT / "QUALITY-PROVENANCE.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
    caption = f'''# 적재율·균형·빈공간의 정적 Factor 분석

이 자료는 기존 `docs/presentation/claude/executed-capacity.json` 40행을 읽어 독립 재계산한 파생 자료입니다. **새 시뮬레이션이나 설정 변경은 없습니다.** 원본 SHA-256은 `{result['source']['sha256']}`입니다. 상하 박스의 무게 순서 규칙은 기존 합의대로 `heavyRule=off`입니다. 지지·가정 허용하중·로봇 근사 제약은 원본에 적용되어 있습니다. MCTS는 이 자료에 포함하지 않았습니다.

## 발표 문장

“같은 72개 입고·1,200 mm 단일 팔레트 조건에서 적재율뿐 아니라 화물 무게중심, 사용 높이까지의 비점유 체적, 최소 지지면적, 가정 허용하중 사용률을 따로 계산했습니다. 각 알고리즘의 평가 입고 순서 5개를 점으로 보여주며 큰 점은 평균입니다. 각 지표가 다르게 움직이므로 임의의 종합점수 하나로 합치지 않았습니다.”

그림 왼쪽 알고리즘 아래의 적재 개수와 사용 높이도 평가 5회의 평균입니다. 선은 관측 최솟값~최댓값이며 신뢰구간이 아닙니다. 알고리즘마다 실제 적재 수량·상품 구성이 다르므로 낮은 무게중심이나 작은 남은 체적 하나만으로 전체 품질의 우월성을 확정하지 않습니다.

## 지표 계산식

- `fill` = 적재 부피 / (팔레트 가로 × 세로 × 허용 높이). JSON에서 비율 0~1, `fillPercent`는 %입니다.
- `count` = 실제 확정 배치 개수. 미적재 및 미처리 개수는 별도 보존합니다.
- `cogXMm`, `cogYMm`, `cogHeightMm` = Σ[상자 질량 × (상자 좌표 + 축 길이/2)] / Σ상자 질량. **각 상자 내부 질량 분포가 균일**하다고 가정하며 서로 다른 품목의 질량은 원본값을 사용합니다. 모든 상자의 밀도가 같다는 가정이 아닙니다. 팔레트 자체 질량은 제외합니다.
- `cogOffsetMm` = sqrt[(CoGx - 팔레트 가로/2)^2 + (CoGy - 세로/2)^2]. 화물의 수평 편심이며 동적 진동 안정성 점수가 아닙니다.
- `usedHeightMm` = max(상자 z + 상자 높이).
- `voidLiters` = (팔레트 가로 × 세로 × 사용 높이 - 적재 상자 부피) / 1,000,000. 단위는 L입니다. **외접 부피 내 비점유 체적**이며, 개방된 측면 공간도 포함합니다. 갇힌 빈틈(trapped void), 접근 불가능한 공간, 물리적으로 활용할 수 없는 공간을 측정한 값이 아닙니다.
- `minSupport` = 실행의 배치 중 가장 작은 `supportRatio`. JSON에서 비율 0~1입니다. 그림과 `minSupportPercent`는 %입니다. 평균 그래프는 각 실행 최솟값 5개의 평균입니다. 원본 지지 면적 하한 85%는 점선으로 표시합니다.
- `loadRatioRawMax` = max(loadAbove / maxLoadKg).
- `loadRatioMax` = max[loadAbove / (maxLoadKg × strengthFactor / loadSafetyFactor)]. 이번 자료는 안전계수 1.2, strengthFactor 기본값 1이며 원본 `materials.ts`의 허용하중 정의에 맞춥니다. 그림은 이 값 ×100입니다. 평균은 실행별 최대값 5개의 평균입니다. **강도·허용하중은 synthetic 모델 가정**으로 제조사 인증이나 실측 강도는 아닙니다. 100% 점선은 가정 허용하중입니다. 알려지지 않은 허용하중이 있으면 집계값을 null로 둡니다.
- `extraFit` = 미적재 품목별 확장된 잔여 후보 탐색에서 유효 후보가 발견된 품목 수. `extraFitAny`는 그 수가 0보다 큰지입니다. **0은 샘플에서 발견하지 못했다는 뜻**이며 전역 최적성·더 넣을 수 없음의 증명이 아닙니다.

## 시간 해석

원본 실행의 기한은 **계획기 호출당 8초**로 그대로 유지합니다. 최신 운영 목표 10~12초는 저장된 호출 최대값과의 **사후 비교**이며, 원본을 10~12초 실험으로 재라벨하지 않았습니다. `sourceCallDeadlineMs`, `sourceCallDeadlinePassed`와 `postHocCallsWithin10000ms`, `postHocCallsWithin12000ms`를 별도로 제공합니다.

시간은 원본의 호출 wall-clock 측정입니다. 전체 제어주기, 인식·통신·검증 시간, 실제 로봇 동작시간은 미측정입니다. 보류 재검토로 한 배치 뒤 여러 번 호출될 수 있으므로 개별 호출이 목표 이하라는 사실로 다음 박스 전체 처리가 목표 내라고 보장하지 않습니다. 알고리즘 `p95Ms`는 실행별 P95 5개의 평균이며 pooled P95가 아닙니다. `maxMs`는 5회 중 관측 최대입니다.

## 미측정과 범위

`trappedVoidLiters`, `dynamicVibrationResistance`, `fullRobotIKPass`, `recognitionLatencyMs`, `measuredRobotCycleSeconds`, `endToEndCyclePass10s`는 **null**입니다. 0이나 통과로 채우지 않았습니다. 동적 운송 진동, 실제 로봇 IK/전체 링크 충돌, 센싱·실물 사이클 검증 자료가 아닙니다. 총 5개 평가 시드의 제한된 내부 관측치입니다.

## 파일

- `08-packing-balance-void.png` (3,840×2,160) / `.svg`: 발표용 16:9 그림.
- `alps-quality.json`: `schema`, `source`, `algorithms`, `rows`, `definitions`, `limitations`을 포함한 앱 데이터. algorithm 숫자는 평가 5회 평균이고 `observations`는 5개 원 관측입니다. 전체 `rows` 40개는 선택 15 + 평가 25입니다.
- `quality-trials40.csv`, `quality-holdout5-summary.csv`: 원시 파생 지표와 평가 집계.
- `QUALITY-PROVENANCE.json`: 입력 및 생성기 SHA와 검산 내용.
- `ALPS-quality-factors.zip`: 이 신규 지표 자료만 묶음.

재현: `python scripts/presentation-quality-charts.py`. 원본 실험·모델·기존 그래프는 변경하지 않습니다.
'''
    (OUT / "QUALITY-CAPTIONS.md").write_text(caption, encoding="utf-8")


if __name__ == "__main__":
    data, original, result = load_analysis()
    OUT.mkdir(parents=True, exist_ok=True)
    render(result)
    export(data, result)
    assert SOURCE.read_bytes() == original, "Original source changed; publication stopped"
    with zipfile.ZipFile(OUT / "ALPS-quality-factors.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.iterdir()):
            if path.is_file() and path.suffix != ".zip":
                archive.write(path, path.name)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for path in OUT.iterdir():
        if path.is_file():
            shutil.copy2(path, PUBLIC / path.name)
    shutil.copy2(OUT / "alps-quality.json", ROOT / "public/alps-quality.json")
    print(json.dumps({"sourceSha256": result["source"]["sha256"], "schema": result["schema"], "rows": len(result["rows"]), "algorithms": len(result["algorithms"]), "outputs": str(OUT), "sourceUnchanged": True}, ensure_ascii=False, indent=2))
