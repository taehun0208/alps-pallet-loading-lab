#!/usr/bin/env python3
"""Add the complete-order 8s model chart without regenerating capacity charts 01--05.

Run after scripts/presentation-charts.py when rebuilding the entire gallery.
Uses a separate source and provenance; store times are unvalidated model estimates.
"""
from pathlib import Path
from statistics import mean, stdev
import csv
import hashlib
import importlib.util
import json
import math
import re
import shutil
import zipfile

BASE = Path(__file__).with_name("presentation-charts.py")
spec = importlib.util.spec_from_file_location("capacity_chart_helpers", BASE)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
ROOT, OUT = shared.ROOT, shared.OUT
BG, PANEL, INK, MUTED, GRID = shared.BG, shared.PANEL, shared.INK, shared.MUTED, shared.GRID
COLORS, LABELS = shared.COLORS, shared.LABELS
base, panel, note = shared.base, shared.panel, shared.note
Line2D = shared.Line2D

def finish(fig, name):
    fig.savefig(OUT / f"{name}.png", dpi=240)
    fig.savefig(OUT / f"{name}.svg", metadata={"Title": name, "Description": "Separate complete-order v2 time-estimate model: fixed 8s robot cycle with planner overlap; 24 boxes; evaluation seeds 2210-2229; 5 policies. Store times not field validated. See PIPELINE-8S-CAPTIONS.md."})
    fig.savefig(OUT / f"{name}-preview.png", dpi=100)
    shared.plt.close(fig)

def chart_pipeline_eight_second():
    """Separate complete-order v2 experiment; never merge with capacity v1."""
    source = ROOT / "docs/presentation/results.json"
    d = json.loads(source.read_text())
    assert d["schema"] == "alps-complete-order/2"
    config = d["config"]
    assert config["robotCycleSeconds"] == 8 and config["overlapPlanning"] is True
    baseline, alps = d["selection"]["baseline"]["id"], d["selection"]["alps"]["id"]
    samebase = f"{d['selection']['baseline']['algorithm']}:alps"
    order = [baseline, alps, samebase, "future-hybrid:space", "future-hybrid:alps"]
    labels = ["기준 Greedy", "선택 ALPS", "동일 기반 비교", "Hybrid · 구역 OFF", "Hybrid · 구역 ON"]
    sublabels = ["구역 선호 OFF", f"{LABELS[d['selection']['alps']['algorithm']]} + 구역 선호", "Greedy + 구역 선호", "Future-Aware Hybrid", "Future-Aware Hybrid"]
    rows = [r for r in d["rows"] if r["split"] == "holdout"]
    assert len(rows) == 100, "Wait for the 40 additional Hybrid holdout trials before final rendering"
    groups = {policy: sorted([r for r in rows if r["policy"]["id"] == policy], key=lambda r: r["seed"]) for policy in order}
    expected = config["holdoutSeeds"]
    for policy, rr in groups.items():
        assert [r["seed"] for r in rr] == expected and len(rr) == 20
        for r in rr:
            assert r["status"] == "complete" and r["valid"] and not r["violations"] and not r["unplaced"]
            assert r["store"]["completed"] == r["total"] == 24
            assert r["robotSeconds"] == 8 * r["total"]
            assert r["store"]["shelfSeconds"] == 600
            assert math.isclose(r["computeSeconds"], r["planningWaitSeconds"] + r["overlappedComputeSeconds"], abs_tol=1e-9)
            component_sum = r["robotSeconds"] + r["exchangeSeconds"] + r["planningWaitSeconds"] + r["store"]["redistributionSeconds"] + r["store"]["shelfSeconds"]
            assert math.isclose(r["totalSeconds"], component_sum, abs_tol=1e-8)
    paired = []
    for before, after in zip(groups[baseline], groups[alps]):
        assert before["seed"] == after["seed"] and before["fingerprint"] == after["fingerprint"]
        assert before["arrivals"] == after["arrivals"]
        paired.append({"seed": before["seed"], "baseline_seconds": before["totalSeconds"], "alps_seconds": after["totalSeconds"], "saved_seconds": before["totalSeconds"] - after["totalSeconds"]})
    savings = [p["saved_seconds"] for p in paired]
    avg = mean(savings)
    half = 2.093 * stdev(savings) / math.sqrt(20)
    ci = [avg - half, avg + half]
    assert math.isclose(avg, d["report"]["saved"]["mean"], abs_tol=1e-8)
    assert all(math.isclose(a, b, abs_tol=1e-8) for a, b in zip(ci, d["report"]["saved"]["ci95"]))
    assert ci[0] < 0 < ci[1]
    metric_names = ["robotSeconds", "exchangeSeconds", "planningWaitSeconds", "redistributionSeconds", "shelfSeconds", "totalSeconds", "meanMs", "p95Ms", "computeSeconds", "overlappedComputeSeconds", "utilization"]
    summary = []
    for policy in order:
        rr = groups[policy]
        record = {"policy": policy, "n": len(rr)}
        for key in metric_names:
            record[key] = mean(r["store"][key] if key in ["redistributionSeconds", "shelfSeconds"] else r[key] for r in rr)
        record["cycleOverruns"] = sum(r["cycleOverruns"] for r in rr)
        summary.append(record)

    fig = base(6, "전체 주문 v2 / 8초 사이클 · 계산 중첩", "8초 로봇 사이클, 다음 박스 계산은 동작 중 처리", "현장 미검증 추정모델 · 24박스 전량 처리 · 1,200 mm · 선택 시드 310~314 / 평가 2210~2229 · 정책당 20회")
    left = panel(fig, [.19, .420, .425, .29], "모델 추정 평균 전체시간의 구성", "단위: 초  /  막대는 각 구간의 실제 비율")
    left.set_ylim(-.55, 4.55)
    left.set_yticks([])
    left.set_xlim(0, 1510)
    left.set_xticks([0, 300, 600, 900, 1200, 1500], ["0", "300", "600", "900", "1,200", "1,500 s"])
    components = [
        ("robotSeconds", "로봇 8N", "#9db6ce"),
        ("exchangeSeconds", "팔레트 교체", "#ffd079"),
        ("planningWaitSeconds", "노출 계산대기", "#f49c98"),
        ("redistributionSeconds", "후단 재분배", "#5cdbc0"),
        ("shelfSeconds", "공통 진열", "#526979"),
    ]
    for i, record in enumerate(summary):
        y, offset = 4 - i, 0
        left.text(-.325, y + .14, labels[i], transform=left.get_yaxis_transform(), color=INK, fontsize=10.9, weight="bold", va="center")
        left.text(-.325, y - .23, sublabels[i], transform=left.get_yaxis_transform(), color=MUTED, fontsize=9.0, va="center")
        for key, label, color in components:
            value = record[key]
            left.barh(y, value, left=offset, height=.49, color=color, edgecolor="none")
            if value >= 60:
                left.text(offset + value / 2, y, f"{value:.0f}", ha="center", va="center", color=BG if key != "shelfSeconds" else INK, fontsize=11.4, weight="bold")
            offset += value
        left.text(offset + 26, y, f"{offset:,.2f}", fontsize=11.1, va="center", color=INK, weight="bold")
    handles = [Line2D([0], [0], marker="s", ms=7, lw=0, color=color, label=label) for key, label, color in components]
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(.178, .379), ncol=3, frameon=False, fontsize=9.1, labelcolor=MUTED, columnspacing=1.2, handletextpad=.4)

    # Timing table is deliberately separate: hidden planner work is not added
    # again to the total; the exposed residual is plotted at true scale above.
    fig.text(.19, .295, "호출 경과시간 (wall-clock)", fontsize=10.4, weight="bold")
    fig.text(.385, .269, "평균 ms", fontsize=9.3, color=MUTED, ha="right")
    fig.text(.503, .269, "실행별 P95 평균 ms", fontsize=9.3, color=MUTED, ha="right")
    fig.text(.615, .269, "노출 대기 ms", fontsize=9.3, color=MUTED, ha="right")
    for i, record in enumerate(summary):
        y = .243 - i * .025
        fig.text(.19, y, labels[i], fontsize=9.6, color=MUTED)
        fig.text(.385, y, f"{record['meanMs']:.2f}", fontsize=9.8, ha="right")
        fig.text(.503, y, f"{record['p95Ms']:.2f}", fontsize=9.8, ha="right")
        fig.text(.615, y, f"{record['planningWaitSeconds'] * 1000:.3f}", fontsize=9.8, ha="right", color=COLORS["future-hybrid"])

    right = panel(fig, [.70, .345, .25, .365], "동일 입고 순서의 대응 차이 20개", "기준 - 선택 ALPS (초)  /  양수면 ALPS가 짧음")
    right.grid(axis="x", visible=False)
    right.grid(axis="y", color=GRID, lw=.7)
    right.set_xlim(2209.3, 2229.7)
    right.set_ylim(-300, 500)
    right.set_xticks([2210, 2215, 2220, 2225, 2229], ["2210", "2215", "2220", "2225", "2229"])
    right.set_yticks([-200, 0, 200, 400], ["-200", "0", "+200", "+400"])
    right.axhspan(ci[0], ci[1], color=COLORS["capacity-compact"], alpha=.12, zorder=0)
    right.axhline(0, color=INK, alpha=.75, lw=.9, ls="--")
    right.axhline(avg, color=COLORS["capacity-compact"], lw=1.5)
    for pair in paired:
        color = COLORS["capacity-compact"] if pair["saved_seconds"] >= .001 else COLORS["future-hybrid"] if pair["saved_seconds"] <= -.001 else MUTED
        right.scatter(pair["seed"], pair["saved_seconds"], color=color, s=38, edgecolor=BG, lw=.5, zorder=4)
    fig.text(.70, .279, f"평균 차이  +{avg:.2f}초", color=COLORS["capacity-compact"], fontsize=17, weight="bold")
    fig.text(.70, .237, f"평균의 95% t CI  [{ci[0]:.2f}, {ci[1]:.2f}]초", fontsize=10.5, color=MUTED)
    fig.text(.70, .197, "0 포함 · 시간 단축은 아직 입증되지 않음", fontsize=11.2, color=COLORS["strategy-greedy"], weight="bold")
    fig.text(.70, .147, f"검증 적재율  Hybrid OFF {summary[3]['utilization'] * 100:.2f}% / ALPS {summary[1]['utilization'] * 100:.2f}%\nALPS 채택 기준: 선택 시드의 전체 예상시간", fontsize=9.3, color=MUTED, linespacing=1.5)
    note(fig, "모델  |  로봇 24 × 8 = 192초. 초기 계산은 대기로 노출되고, 이후 계산은 직전 동작·팔레트 교체 중 가능한 만큼 겹칩니다.", y=.105, size=10.3)
    note(fig, "계산대기는 실제 비율로 표시했습니다. 인식·통신 지연 미측정. 공통 진열 600초 = 개봉·낱개 진열·포장재 정리. 과거 250 ms 필터는 적용하지 않음.", y=.077, size=10.0)
    fig.add_artist(Line2D([.05, .95], [.049, .049], transform=fig.transFigure, color=GRID, lw=.8))
    fig.text(.05, .020, "출처: docs/presentation/results.json · alps-complete-order/2  |  내부 모델 관측치 · 기존 72박스/250 ms 용량 실험과 별개", fontsize=9.2, color=MUTED)
    fig.text(.95, .020, "20 paired seeds  /  95% t CI", fontsize=9.2, color=MUTED, ha="right")
    finish(fig, "06-pipeline-eight-second")

    with (OUT / "pipeline-eight-second-policy-means.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, list(summary[0])); writer.writeheader(); writer.writerows(summary)
    with (OUT / "pipeline-eight-second-paired20.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, list(paired[0])); writer.writeheader(); writer.writerows(paired)
    raw = []
    for r in rows:
        record = {key: r[key] for key in ["id", "seed", "split", "fingerprint", "status", "total", "totalSeconds", "robotSeconds", "exchangeSeconds", "planningWaitSeconds", "computeSeconds", "overlappedComputeSeconds", "meanMs", "p95Ms", "maxMs", "cycleOverruns", "utilization"]}
        record.update({"policy": r["policy"]["id"], "redistributionSeconds": r["store"]["redistributionSeconds"], "shelfSeconds": r["store"]["shelfSeconds"], "palletCount": len(r["batches"]), "completed": r["store"]["completed"]})
        raw.append(record)
    with (OUT / "pipeline-eight-second-holdout100.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, list(raw[0])); writer.writeheader(); writer.writerows(raw)
    provenance = {"source": str(source.relative_to(ROOT)), "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "source_createdAt": d["createdAt"], "schema": d["schema"], "config": config, "sourceHashes": d["sourceHashes"], "environment": d["environment"], "holdout_n_per_policy": 20, "policy_ids": order, "paired_mean_seconds": avg, "paired_ci95_seconds": ci, "ci_method": "paired differences; mean +/- 2.093 * sample SD / sqrt(20), df=19", "checks": ["all 100 evaluation runs complete, valid, 24/24", "same seed, fingerprint and arrival sequence for 20 pairs", "robot seconds = 8 * 24", "common shelf seconds = 600", "hidden + exposed compute = total compute", "5 time components sum to total", "paired mean and CI independently recomputed"], "scope": "Complete-order v2 only; do not pool with capacity v1. Robot cycle is a fixed assumption, perception/communication latency not separately measured. Planner timings are wall-clock elapsed call times, not CPU time."}
    provenance.update({"source_extendedAt": d.get("extendedAt"), "script": "scripts/presentation-pipeline-charts.py", "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "helper_script_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(), "original_capacity_figures_regenerated": False})
    (OUT / "PIPELINE-8S-provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
    caption = f'''# 8초 사이클 · 계산 중첩 벤치마크

`06-pipeline-eight-second.png/.svg`는 **별도 전체 주문 실험 v2**입니다. 기존 01~05의 단일 팔레트 72박스·250 ms 기한 벤치마크와 합산하거나 같은 실험으로 해석하지 않습니다. 원본은 `docs/presentation/results.json`, 스키마 `{d['schema']}`입니다.

## 발표 문장

“각 박스의 로봇 사이클을 8초로 고정하고, 로봇이 움직이는 동안 다음 박스를 계산하는 중첩 스케줄을 모델링했습니다. 24박스를 전량 처리하므로 순수 로봇 동작시간은 모든 정책에서 192초입니다. 계산 중 동작시간에 가려진 부분은 전체 시간에 다시 더하지 않고, 초기 계산 등 밖으로 드러난 계산대기만 더했습니다. 평가용 입고 순서 20개에서 선택 ALPS의 평균 전체 시간은 {summary[1]['totalSeconds']:.2f}초, 기준은 {summary[0]['totalSeconds']:.2f}초였습니다. 대응 차이 평균은 {avg:.2f}초지만 95% 신뢰구간 [{ci[0]:.2f}, {ci[1]:.2f}]초가 0을 포함해, 아직 일반적인 시간 단축이 입증됐다고 발표하지 않습니다.”

## 읽는 방법

- 왼쪽 막대: 로봇 8N + 팔레트 교체 + 노출 계산대기 + 후단 재분배 + 공통 진열. 20개 평가 실행의 각 구성시간 평균을 합산했습니다. 계산대기는 **실제 비율의 막대에서 거의 보이지 않는 수준**입니다. 눈에 띄도록 임의로 폭을 키우지 않았고, 아래 표에 밀리초로 표시했습니다.
- 공통 진열은 개봉·낱개 진열·포장재 정리 600초입니다. 재분배는 이동·인출·분류·임시 이동이며 공통 진열과 별도입니다.
- 다섯 정책: 기준 Greedy 구역 선호 OFF, 선택된 ALPS Compact + 구역 선호, 동일 기반 효과 비교 Greedy + 구역 선호, Future-Aware Hybrid 구역 선호 OFF/ON. Hybrid 평가를 추가해도 기존 선택은 사후 변경하지 않았습니다.
- “선택 ALPS”는 선택 시드의 **전체 예상시간** 기준으로 채택한 정책이며 최대 적재율의 최상 정책이라는 뜻이 아닙니다. 이번 별도 평가에서 Hybrid OFF의 평균 적재율은 {summary[3]['utilization'] * 100:.2f}%, 선택 ALPS는 {summary[1]['utilization'] * 100:.2f}%였습니다. 여기서 적재율은 전체 적재 부피 / (사용 팔레트 수 × 팔레트 면적 × 허용 높이)입니다. 검증 결과를 이용해 사전 선택을 바꾸지 않았습니다.
- 아래 표의 계산시간은 계획기 호출의 **wall-clock 경과시간**이며 CPU 시간은 아닙니다. 평균과 P95는 실행별 값을 20개 실행에 걸쳐 평균한 값입니다. 모든 판단을 합친 pooled P95가 아닙니다. 노출 대기는 실행당 전체 노출 계산대기의 평균을 ms로 바꾼 값입니다.
- 오른쪽 점 20개: 같은 시드·상품·입고 순서에서 `기준 전체시간 - 선택 ALPS 전체시간`입니다. 양수이면 ALPS가 짧습니다. 선은 20개 대응 차이의 평균, 음영은 **그 평균의 95% t 신뢰구간**이며 개별 실행의 신뢰구간이나 전체 관측 범위가 아닙니다.
- CI 재계산: `평균 ± 2.093 × 표본표준편차 / sqrt(20)` (자유도 19). 원본 보고서 수치와 일치 확인했습니다.
- 1ms보다 작은 차이는 점을 회색으로 표시했습니다. 이는 표시상의 구분이며 평균·CI 원자료를 0으로 바꾸거나 제거하지 않았습니다.

## 가정과 해석 범위

- 로봇 1대, 1,200 × 1,000 × 1,200 mm 팔레트, 6품목 × 4박스 = 24박스 전량 처리, 입고 버퍼 0.
- 선택 시드 310~314 (5개), 평가 시드 2210~2229 (20개). 평가 100회 모두 완료·24개 처리·모델 내 배치 위반 0건을 확인했습니다.
- 중첩은 시간 스케줄 모델입니다. 실제 인식 장비, PLC, 네트워크 통신과 로봇 제어의 동시 실행을 실측한 자료는 아닙니다. 현재 기록의 계산시간은 계획기/구역 선호 시간이고, 상품 인식·통신 지연은 별도로 측정하지 않았습니다.
- 처음에는 앞선 로봇 동작창이 없어 계산시간을 기다립니다. 이후 한 번의 다음 판단은 직전 로봇 8초 또는 팔레트 교체 20초와 겹칩니다. 창보다 긴 계산의 초과분은 노출 대기입니다. 이 모델의 60초 계산 기한은 중단 예산이며, 과거 용량 실험의 250 ms 제한과 다릅니다.
- 평가 100회의 8초 초과 판단 횟수는 CSV의 `cycleOverruns`로 보존했습니다. 이 결과로 하드 실시간 보장이나 실제 로봇 처리속도를 입증하지 않습니다. 공유 Apple M5 개발 컴퓨터에서 저장한 관측치입니다.
- CI는 이 품목·치수·후단 작업 가정에서 입고 순서에 따른 차이를 표현합니다. 인식·로봇·매장 작업 가정의 오차나 현장 환경 변동은 포함하지 않습니다.
- 동일 Greedy 기반의 구역 선호 비교도 별도로 보존했지만, 오른쪽 대응 차이는 **기준 Greedy vs 선택 ALPS Compact**입니다. 알고리즘 변경과 구역 선호 효과가 함께 들어 있습니다.

## 산출물

- `pipeline-eight-second-policy-means.csv`: 다섯 정책의 평균 구성시간과 별도 계산지표.
- `pipeline-eight-second-paired20.csv`: 기준 - 선택 ALPS의 시드별 대응 차이 20개.
- `pipeline-eight-second-holdout100.csv`: 평가 100회 구성시간·완료수·팔레트 수 등.
- `PIPELINE-8S-provenance.json`: 별도 데이터 출처·해시·설정·신뢰구간 계산과 재검산 결과.
- `ALPS-eight-second-pipeline.zip`: 8초 사이클 자료만 묶은 파일.

재현: `python scripts/presentation-pipeline-charts.py`. 저장된 자료를 읽고 그래프를 생성하며 알고리즘을 재실행하지 않습니다. 기존 01~05 PNG/SVG를 재생성하지 않습니다. 전체 갤러리를 처음부터 만들 때는 `presentation-charts.py`를 먼저 실행하고 이 스크립트를 나중에 실행하세요.
'''
    (OUT / "PIPELINE-8S-CAPTIONS.md").write_text(caption, encoding="utf-8")


def publish_pipeline_gallery():
    gallery = OUT / "index.html"
    html = gallery.read_text(encoding="utf-8")
    html = re.sub(r"<!-- pipeline-v2:start -->.*?<!-- pipeline-v2:end -->", "", html, flags=re.S)
    header_link = '<a href="#pipeline-eight-second">새 8초 사이클 · 5정책 비교</a>'
    html = html.replace(header_link, "")
    html = html.replace('<div class="downloads">', '<div class="downloads">' + header_link, 1)
    section = '''<!-- pipeline-v2:start --><section id="pipeline-eight-second"><h2>새 8초 사이클 · 5정책 전체시간 가정 비교</h2><p>별도 실험 v2의 24박스 전량 처리·평가 시드 20개 결과입니다. 로봇 동작과 다음 판단의 계산을 겹친 시간 모델이며, 매장 재분배·진열 시간은 현장 검증 전의 추정치입니다. 아래 기존 용량 실험과 데이터·계산 기한이 다릅니다.</p><aside>선택 ALPS는 선택 시드의 전체 예상시간을 기준으로 채택했습니다. 최대 적재율의 최상 정책을 뜻하지 않습니다. 평균 시간 차이의 95% 신뢰구간은 0을 포함합니다.</aside><div class="downloads"><a href="ALPS-eight-second-pipeline.zip" download>8초 사이클 자료 ZIP</a><a href="PIPELINE-8S-CAPTIONS.md" download>가정·발표 문장·해석 범위</a><a href="pipeline-eight-second-policy-means.csv" download>5정책 구성시간 CSV</a><a href="pipeline-eight-second-paired20.csv" download>대응 차이 20개 CSV</a><a href="pipeline-eight-second-holdout100.csv" download>평가 100회 CSV</a><a href="PIPELINE-8S-provenance.json" download>별도 출처·검산</a></div><article><a href="06-pipeline-eight-second.png"><img src="06-pipeline-eight-second-preview.png" alt="8초 사이클과 계산 중첩의 다섯 정책 추정시간 비교"></a><div class="caption"><h2>8초 사이클 · 계산 중첩 · 5정책 모델 비교</h2><nav><a href="06-pipeline-eight-second.png" download>PNG · 4K</a><a href="06-pipeline-eight-second.svg" download>SVG · 벡터</a></nav></div></article></section><!-- pipeline-v2:end -->'''
    html = html.replace('<article>', section + '<article>', 1)
    html = html.replace('기존 단일 팔레트 180행 벤치마크이며, 별도 전체 주문 적재·재분배 실험과 구분합니다.', '01~05는 기존 단일 팔레트 180행 벤치마크입니다. 06은 별도 전체 주문 v2의 150행 중 평가 100행을 사용하며, 현장 검증 전 시간 가정을 설명합니다.')
    html = html.replace('검증 시드가 두 개뿐이며, 추가 1043 상세 그래프는 시드별 단일 관측입니다.', '01~03은 검증 시드 2개 평균, 04~05는 시드별 단일 관측, 06은 별도 평가 시드 20개의 결과입니다.')
    html = html.replace('출처: docs/capacity/results.json · Apple M5', '출처: 01~05 docs/capacity/results.json / 06 docs/presentation/results.json · Apple M5')
    gallery.write_text(html, encoding="utf-8")
    with zipfile.ZipFile(OUT / "ALPS-eight-second-pipeline.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.iterdir()):
            if path.is_file() and path.suffix != ".zip" and ("pipeline-eight-second" in path.name or "PIPELINE-8S" in path.name):
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


if __name__ == "__main__":
    old_figures = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in OUT.iterdir() if path.name[:2] in ["01", "02", "03", "04", "05"] and path.suffix in [".png", ".svg"]}
    chart_pipeline_eight_second()
    publish_pipeline_gallery()
    assert all(hashlib.sha256((OUT / name).read_bytes()).hexdigest() == digest for name, digest in old_figures.items())
    print(json.dumps({"created": "06-pipeline-eight-second.png/.svg", "original_01_to_05_unchanged": True, "evaluation_trials": 100, "paired_seeds": 20, "pipeline_source": "docs/presentation/results.json"}, ensure_ascii=False, indent=2))


