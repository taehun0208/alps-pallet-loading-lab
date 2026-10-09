#!/usr/bin/env python3
"""Plot only the immutable new 72-box / one-pallet / 8s-capacity execution.

Run after presentation-charts.py and presentation-pipeline-charts.py when rebuilding
all galleries. Never changes executor results, model files or public replay input.
"""
from pathlib import Path
from statistics import mean
from collections import Counter
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
SOURCE = ROOT / "docs/presentation/claude/executed-capacity.json"
BG, PANEL, INK, MUTED, GRID = shared.BG, shared.PANEL, shared.INK, shared.MUTED, shared.GRID
COLORS, LABELS = shared.COLORS, shared.LABELS
base, panel, note = shared.base, shared.panel, shared.note
Line2D = shared.Line2D


def eligible(row):
    return row["status"] == "finished" and not row["violations"] and not row["deadlineMisses"] and not row["unprocessed"]


def finish(fig):
    name = "07-single-pallet-eight-second-capacity"
    fig.savefig(OUT / f"{name}.png", dpi=240)
    fig.savefig(OUT / f"{name}.svg", metadata={"Title": name, "Description": "Primary capacity comparison from newly executed alps-claude-capacity-8s/1 artifact: 72-box arrivals, one 1200x1000x1200 mm pallet, five algorithms, selection seeds 410-412, holdout seeds 2410-2414, 8000ms per planner call. Not the 24-box full-order/store model."})
    fig.savefig(OUT / f"{name}-preview.png", dpi=100)
    shared.plt.close(fig)


def analyze():
    if not SOURCE.exists():
        raise SystemExit("Waiting for immutable docs/presentation/claude/executed-capacity.json; no chart has been rendered.")
    source_bytes = SOURCE.read_bytes()
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    d = json.loads(source_bytes)
    assert d["schema"] == "alps-claude-capacity-8s/1" and d["status"] == "executed" and d["case"] == "capacity"
    c = d["config"]
    assert c["heights"] == [1200] and c["decisionMs"] == 8000 and c["bufferCapacity"] == 2
    assert c["discoverySeeds"] == [410, 411, 412] and c["holdoutSeeds"] == [2410, 2411, 2412, 2413, 2414]
    rows = d["rows"]
    assert len(rows) == 40 and len({r["id"] for r in rows}) == 40
    assert sum(t["quantity"] for t in c["scenario"]["types"]) == 72
    for r in rows:
        assert r["height"] == 1200 and r["mode"] == "robot" and r["total"] == 72
        placements = r["placements"]
        volume = sum(p["size"]["w"] * p["size"]["d"] * p["size"]["h"] for p in placements)
        assert len({p["id"] for p in placements}) == len(placements)
        assert len(placements) + len(r["unplaced"]) + len(r["unprocessed"]) == 72
        assert math.isclose(volume, r["volume"], abs_tol=1e-8)
        assert math.isclose(r["utilization"], volume / (1200 * 1000 * 1200), abs_tol=1e-12)
        if r["meanMs"] is not None:
            assert math.isclose(r["meanMs"] * r["decisions"], r["computeMs"], rel_tol=1e-9, abs_tol=1e-7)
        for p in placements:
            pos, size = p["position"], p["size"]
            assert pos["x"] >= 0 and pos["y"] >= 0 and pos["z"] >= 0
            assert pos["x"] + size["w"] <= 1200 + 1e-6 and pos["y"] + size["d"] <= 1000 + 1e-6 and pos["z"] + size["h"] <= 1200 + 1e-6
    groups = {}
    for split, seeds in [("discovery", c["discoverySeeds"]), ("holdout", c["holdoutSeeds"])]:
        for a in c["algorithms"]:
            rr = sorted([r for r in rows if r["split"] == split and r["algorithm"] == a], key=lambda r: r["seed"])
            assert [r["seed"] for r in rr] == seeds
            groups[split, a] = rr
        for seed in seeds:
            rr = [r for r in rows if r["split"] == split and r["seed"] == seed]
            assert len(rr) == 5 and len({r["fingerprint"] for r in rr}) == 1
            assert all(r["arrivals"] == rr[0]["arrivals"] for r in rr)
    candidates = [a for a in c["algorithms"] if all(eligible(r) for r in groups["discovery", a])]
    candidates.sort(key=lambda a: (-mean(r["utilization"] for r in groups["discovery", a]), -mean(len(r["placements"]) for r in groups["discovery", a]), mean(r["meanMs"] for r in groups["discovery", a]), a))
    assert d["selectedAlgorithm"] == (candidates[0] if candidates else None)
    # Read once and fix the exact source hash for every output in this generator.
    return d, source_bytes, source_sha, groups


def create_figure(d, groups):
    chosen = d["selectedAlgorithm"]
    order = d["config"]["algorithms"]
    if chosen:
        order = [chosen] + [a for a in order if a != chosen]
    fig = base(7, "핵심 용량 비교 / 새 단일 팔레트 · 8초 판단 기한", "단일 팔레트, 8초 판단 기한에서 적재 성능 비교", "1,200 × 1,000 × 1,200 mm · 입고 72개 · 로봇 제약 적용 · 보류 2개 · 선택 시드 3개 / 별도 평가 시드 5개")
    left = panel(fig, [.205, .285, .30, .425], "허용 높이 기준 부피 적재율  ↑", "큰 점: 평가 5회 평균  /  선: 관측 최솟값~최댓값")
    right = panel(fig, [.62, .285, .33, .425], "계획기 호출 경과시간 (ms)  ↓", "원: 평균 · 마름모: 실행별 P95 평균 · ×: 관측 최대")
    left.set_xlim(0, 100)
    left.set_xticks([0, 20, 40, 60, 80, 100], ["0", "20", "40", "60", "80", "100%"])
    right.set_xscale("log")
    right.set_xlim(.1, 16000)
    right.set_xticks([.1, 1, 10, 100, 1000, 8000], ["0.1", "1", "10", "100", "1,000", "8,000"])
    right.tick_params(axis="x", labelsize=9.7)
    right.minorticks_off()
    right.axvline(8000, color=COLORS["future-hybrid"], lw=1.4, ls="--")
    right.text(8000, 4.45, "8초 기한", color=COLORS["future-hybrid"], ha="center", va="top", fontsize=10)
    for ax in [left, right]:
        ax.set_ylim(-.5, 4.5)
        ax.set_yticks([])
    summaries = []
    for i, a in enumerate(order):
        y, color = 4 - i, COLORS[a]
        rr = groups["holdout", a]
        ok = all(eligible(r) for r in rr)
        left.text(-.52, y + .12, LABELS[a] if a != "future-hybrid" else "Future-Aware Hybrid", transform=left.get_yaxis_transform(), color=color, fontsize=12, weight="bold", va="center")
        details = f"평균 {mean(len(r['placements']) for r in rr):.1f} / 72개 적재" if ok else f"완주 {sum(eligible(r) for r in rr)} / 5 · 비교 제외"
        if a == chosen:
            details += "\n선택 시드에서 사전 채택"
        left.text(-.52, y - .15, details, transform=left.get_yaxis_transform(), color=MUTED, fontsize=9.0, va="top", linespacing=1.35)
        summary = {"algorithm": a, "selected_on_discovery": a == chosen, "expected_n": 5, "complete_n": sum(eligible(r) for r in rr), "eligible_comparison": ok, "deadline_misses": sum(r["deadlineMisses"] for r in rr), "violations": sum(len(r["violations"]) for r in rr), "robot_audit_violations": sum(len(r["robotAudit"]) for r in rr), "mean_fill_pct": None, "min_fill_pct": None, "max_fill_pct": None, "mean_placed": None, "mean_ms": None, "mean_run_p95_ms": None, "max_ms_all_runs": max(r["maxMs"] or 0 for r in rr)}
        if ok:
            fills = [r["utilization"] * 100 for r in rr]
            summary.update({"mean_fill_pct": mean(fills), "min_fill_pct": min(fills), "max_fill_pct": max(fills), "mean_placed": mean(len(r["placements"]) for r in rr), "mean_ms": mean(r["meanMs"] for r in rr), "mean_run_p95_ms": mean(r["p95Ms"] for r in rr)})
            left.plot([min(fills), max(fills)], [y, y], lw=3, color=color, alpha=.65)
            left.scatter(fills, [y + .08, y - .08, y + .06, y - .06, y] , color=color, s=18, alpha=.65, zorder=3)
            left.scatter([mean(fills)], [y], s=74, color=color, edgecolor=PANEL, linewidth=.8, zorder=4)
            left.text(max(fills) + 2, y, f"{mean(fills):.2f}%", va="center", fontsize=12, color=color, weight="bold")
            for metric, dy, marker in [(summary["mean_ms"], .2, "o"), (summary["mean_run_p95_ms"], 0, "D"), (summary["max_ms_all_runs"], -.2, "x")]:
                right.scatter(metric, y + dy, s=37, marker=marker, color=color, zorder=3)
                right.text(metric * 1.25, y + dy, f"{metric:.1f}", color=color, fontsize=10.2, va="center")
        else:
            left.text(5, y, "중단·위반 포함: 적재율 평균 제외", color=color, fontsize=10, va="center")
            right.text(.16, y, f"관측 최대 {summary['max_ms_all_runs']:.1f} ms", color=color, fontsize=10.5, va="center")
        summaries.append(summary)
    selected = next((s for s in summaries if s["algorithm"] == chosen), None)
    complete = [s for s in summaries if s["eligible_comparison"]]
    max_latency = max(s["max_ms_all_runs"] for s in summaries)
    if selected and selected["eligible_comparison"]:
        caption = f"사전 선택 {LABELS[chosen]}  |  별도 평가 평균 적재율 {selected['mean_fill_pct']:.2f}% · {selected['mean_placed']:.1f}개. 평가 순위로 선택을 바꾸지 않았습니다."
    else:
        caption = "선택용 결과와 평가 결과를 분리합니다. 미완주·제약 위반 후보는 부분 적재 평균으로 순위를 매기지 않습니다."
    note(fig, caption, y=.200, size=11.1)
    note(fig, f"평가 관측 최대 호출 {max_latency:,.1f} ms / 8,000 ms. 시간축은 로그축입니다. n=5의 내부 관측 범위이며, 신뢰구간·전역 최적성 증명이 아닙니다.", y=.155, size=10.7)
    note(fig, "8초 이내 호출이 전체 8초 제어주기를 보장하지는 않습니다. 보류 재검토는 여러 번 호출될 수 있으며 센싱·통신·검사·실로봇 제어시간은 제외합니다.", y=.108, size=10.5)
    fig.add_artist(Line2D([.05, .95], [.066, .066], transform=fig.transFigure, color=GRID, lw=.8))
    fig.text(.05, .032, "새 실행: executed-capacity.json · 72개 / 단일 팔레트 / 로봇 제약 · 공유 컴퓨터 호출 wall-clock  |  24박스 매장 시간 모델과 별개", fontsize=9.4, color=MUTED)
    fig.text(.95, .032, "선택 410~412 / 평가 2410~2414", fontsize=9.3, color=MUTED, ha="right")
    finish(fig)
    return summaries


def export(d, source_sha, summaries):
    flat = []
    for r in d["rows"]:
        record = {k: r[k] for k in ["id", "split", "seed", "algorithm", "height", "mode", "fingerprint", "status", "reason", "total", "processed", "volume", "utilization", "usedHeight", "computeMs", "meanMs", "p95Ms", "maxMs", "deadlineMisses", "decisions", "extraFit"]}
        record.update({"placed": len(r["placements"]), "unplaced": len(r["unplaced"]), "unprocessed": len(r["unprocessed"]), "violations": len(r["violations"]), "robot_audit_violations": len(r["robotAudit"]), "eligible": eligible(r), "source_sha256": source_sha})
        flat.append(record)
    for name, records in [("capacity8s-trials40.csv", flat), ("capacity8s-holdout5-summary.csv", summaries)]:
        with (OUT / name).open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, list(records[0])); writer.writeheader(); writer.writerows(records)
    pairs = []
    for report in d["pairedReports"]:
        for pair in report["pairs"]:
            pairs.append({"before": report["before"], "after_discovery_selected": report["after"], **pair})
    if pairs:
        with (OUT / "capacity8s-selected-paired.csv").open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, list(pairs[0])); writer.writeheader(); writer.writerows(pairs)
    prov = {"source": str(SOURCE.relative_to(ROOT)), "source_sha256": source_sha, "schema": d["schema"], "startedAt": d["startedAt"], "finishedAt": d["finishedAt"], "source_provenance": d["provenance"], "environment": d["environment"], "config": d["config"], "selectedAlgorithm": d["selectedAlgorithm"], "source_rows": 40, "selection_rows": 15, "evaluation_rows": 25, "source_status_counts": dict(Counter(r["status"] for r in d["rows"])), "script": "scripts/presentation-capacity8s-charts.py", "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "helper_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(), "checks": ["40 unique trials and same within-seed arrivals/fingerprints", "item conservation and unique placement IDs", "volume/fill from box geometry", "boundary checks", "planner mean * decisions = total compute", "discovery-only selection independently reconstructed", "incomplete groups excluded from comparative means"], "range_definition": "observed min-max across 5 held-out trial metrics, not confidence interval", "source_immutable": True}
    (OUT / "CAPACITY-8S-provenance.json").write_text(json.dumps(prov, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# 새 단일 팔레트 8초 판단 기한 벤치마크", "", "07번 그림은 `docs/presentation/claude/executed-capacity.json`의 새 실행만 사용한 **현재 핵심 용량 비교**입니다. 01~05의 250 ms 과거 용량 실험, 06의 24박스 전체 주문·매장 시간 추정 모델과 분리합니다.", "", f"원본 SHA-256: `{source_sha}`", "", "## 조건과 선정", "", "- 1,200 × 1,000 × 1,200 mm 팔레트 1개, 입고 6종 × 12개 = 72개, 관측한 보류 상자 최대 2개, 후보 상한 48개.", "- 5개 알고리즘, 선택 시드 410·411·412 (15실행), 별도 평가 시드 2410~2414 (25실행). 같은 시드의 입고 순서·상품·제약은 같습니다.", "- 각 계획기 호출 기한 8,000 ms, 실행 기한 120,000 ms. 늦은 좌표는 확정하지 않고 중단 상태를 보존합니다. 동기 호출 후 검사이며 강제 중단형 실시간 제어기는 아닙니다.", f"- 선택 시드의 적재율 → 적재 수 → 평균 계산시간으로 사전 선택한 알고리즘은 **{LABELS.get(d['selectedAlgorithm'], '없음')}**입니다. 평가 시드로 재선택하지 않았습니다.", "- 로봇 제약은 유효 가반·그리퍼·수평 도달 반경·작업공간·공구/운반 상자의 경로 근사를 포함합니다. 실제 IK·관절 제한·전체 링크 충돌·흡착·동적 물리 검증은 아닙니다.", "", "## 평가 결과", "", "| 알고리즘 | 완료 | 평균 적재율 | 평균 적재 개수 | 평균 호출 ms | 실행별 P95 평균 ms | 관측 최대 ms |", "|---|---:|---:|---:|---:|---:|---:|"]
    for s in summaries:
        if s["eligible_comparison"]:
            lines.append(f"| {LABELS[s['algorithm']]} | {s['complete_n']}/5 | {s['mean_fill_pct']:.2f}% | {s['mean_placed']:.1f}/72 | {s['mean_ms']:.2f} | {s['mean_run_p95_ms']:.2f} | {s['max_ms_all_runs']:.2f} |")
        else:
            lines.append(f"| {LABELS[s['algorithm']]} | {s['complete_n']}/5 | 비교 제외 | 비교 제외 | 비교 제외 | 비교 제외 | {s['max_ms_all_runs']:.2f} |")
    lines += ["", "## 발표 문장과 해석", "", "“새 실험에서는 단일 팔레트의 최고 높이를 1,200 mm로 고정하고, 72개 입고를 5개 알고리즘에 같은 순서로 제공했습니다. 판단 기한은 호출당 8초로 두고 적재율·적재 수·계산 속도를 함께 측정했습니다. 알고리즘 선정용 입고 순서 3개와 평가용 5개를 분리했으며, 그림에는 평가용 관측치를 표시했습니다.”", "", "부피 적재율 = 적재한 상자 부피 합 / (1,200 × 1,000 × 1,200) × 100. 큰 점은 5회 평균, 작은 점은 각 실행, 선은 최솟값~최댓값이며 신뢰구간이 아닙니다. 모든 실행이 완료되고 위반이 없는 후보만 비교 평균을 표시합니다. 완료는 전체 입고를 처리했다는 뜻이며, 한 팔레트에 72개 모두 들어갔다는 뜻이 아닙니다. 미적재·미처리 수를 원시 CSV에 보존했습니다.", "", "시간축은 로그축입니다. 평균 호출시간과 실행별 P95 평균은 각 실행의 지표 5개를 산술평균한 값이며, 모든 호출을 합친 P95가 아닙니다. 관측 최대는 평가 5실행의 최대값 중 가장 큰 값입니다. 시간은 공유 컴퓨터에서 측정한 계획기 호출 wall-clock 경과시간이며 CPU 전용 실행시간이 아닙니다.", "", "**모든 호출이 8초보다 빨라도 전체 다음 박스 처리 파이프라인이 8초 안에 끝난다는 증명은 아닙니다.** 보류 상자를 다시 검사하며 한 배치 뒤 여러 번 계획기를 호출할 수 있습니다. 검사·센싱·통신·제어·실제 로봇 동작은 이 시간에 포함되지 않습니다. 이 용량 실험으로 노출 계산대기, 매장 작업시간 또는 전체 주문 처리시간을 추론하지 않았습니다.", "", "상품군·치수·강도 가정과 평가 입고 순서가 제한적이므로 전역 최적성·모든 입력의 우월성·현장 성능을 주장하지 않습니다. 상품 강도는 실측이 아닌 모델 가정입니다. 잔여 후보 검사에 자리가 발견되지 않아도 최적성 증명은 아닙니다.", "", "## 파일과 재현", "", "- `07-single-pallet-eight-second-capacity.png/.svg`: 4K PNG·벡터 그림.", "- `capacity8s-trials40.csv`: 선택/평가 40회 상태·미적재·원시 계산 집계.", "- `capacity8s-holdout5-summary.csv`: 알고리즘별 평가 5회 평균·범위·완료 수.", "- `capacity8s-selected-paired.csv`: 사전 선택 후보와 다른 후보의 평가 시드별 대응 적재율/개수 차이.", "- `CAPACITY-8S-provenance.json`: 고정 원본 SHA·설정·실행 환경·검산 목록.", "- `ALPS-single-pallet-capacity8s.zip`: 07번 전용 묶음.", "", "재현: `python scripts/presentation-capacity8s-charts.py`. 전체 갤러리 재생성 시 기존 두 그래프 생성기를 실행한 뒤 마지막에 실행하세요. 이 스크립트는 결과 JSON·모델·원본 재생 입력을 수정하지 않으며 알고리즘을 재실행하지 않습니다.", ""]
    (OUT / "CAPACITY-8S-CAPTIONS.md").write_text("\n".join(lines), encoding="utf-8")


def publish():
    gallery = OUT / "index.html"
    html = gallery.read_text(encoding="utf-8")
    html = re.sub(r"<!-- capacity8s:start -->.*?<!-- capacity8s:end -->", "", html, flags=re.S)
    link = '<a href="#capacity-eight-second">핵심: 단일 팔레트 · 8초 판단</a>'
    html = html.replace(link, "").replace('<div class="downloads">', '<div class="downloads">' + link, 1)
    section = '''<!-- capacity8s:start --><section id="capacity-eight-second"><h2>핵심 용량 비교 · 단일 팔레트 · 8초 판단 기한</h2><p>새로 실행한 72박스 입고, 팔레트 1개, 최고 높이 1,200 mm 조건입니다. 선택 시드 3개와 평가 시드 5개를 분리했습니다. 아래 24박스 전체 주문 시간 모델 및 과거 250 ms 실험과 섞지 않습니다.</p><aside>계획기 호출당 8초 기한입니다. 보류 재검토가 여러 번 일어날 수 있어 전체 다음 박스 처리주기의 8초 보장과는 다릅니다. 실제 로봇·센싱·통신 검증은 포함하지 않습니다.</aside><div class="downloads"><a href="ALPS-single-pallet-capacity8s.zip" download>핵심 용량 비교 ZIP</a><a href="CAPACITY-8S-CAPTIONS.md" download>발표 문장·해석 범위</a><a href="capacity8s-trials40.csv" download>새 실행 40회 CSV</a><a href="capacity8s-holdout5-summary.csv" download>평가 5회 집계 CSV</a><a href="CAPACITY-8S-provenance.json" download>원본 SHA·설정·검산</a></div><article><a href="07-single-pallet-eight-second-capacity.png"><img src="07-single-pallet-eight-second-capacity-preview.png" alt="새 단일 팔레트 8초 판단 기한의 알고리즘별 적재율과 계산시간"></a><div class="caption"><h2>07 · 단일 팔레트 적재율·수량·8초 판단 기한</h2><nav><a href="07-single-pallet-eight-second-capacity.png" download>PNG · 4K</a><a href="07-single-pallet-eight-second-capacity.svg" download>SVG · 벡터</a></nav></div></article></section><!-- capacity8s:end -->'''
    target = '<!-- pipeline-v2:start -->'
    html = html.replace(target, section + target, 1) if target in html else html.replace('<article>', section + '<article>', 1)
    html = html.replace('01~03은 검증 시드 2개 평균, 04~05는 시드별 단일 관측, 06은 별도 평가 시드 20개의 결과입니다.', '07은 새 핵심 용량 비교의 평가 시드 5개입니다. 01~03은 과거 검증 시드 2개 평균, 04~05는 시드별 단일 관측, 06은 별도 전체 주문의 평가 시드 20개입니다.')
    gallery.write_text(html, encoding="utf-8")
    with zipfile.ZipFile(OUT / "ALPS-single-pallet-capacity8s.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.iterdir()):
            if path.is_file() and path.suffix != ".zip" and ("capacity8s" in path.name or "CAPACITY-8S" in path.name or path.name.startswith("07-")):
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


def current_bundle():
    """Explicit allowlist: current 06/07 only, without historical plots or gallery."""
    names = [
        "06-pipeline-eight-second.png", "06-pipeline-eight-second.svg",
        "07-single-pallet-eight-second-capacity.png", "07-single-pallet-eight-second-capacity.svg",
        "pipeline-eight-second-policy-means.csv", "pipeline-eight-second-paired20.csv", "pipeline-eight-second-holdout100.csv",
        "capacity8s-trials40.csv", "capacity8s-holdout5-summary.csv", "capacity8s-selected-paired.csv",
        "PIPELINE-8S-CAPTIONS.md", "CAPACITY-8S-CAPTIONS.md",
        "PIPELINE-8S-provenance.json", "CAPACITY-8S-provenance.json",
    ]
    assert all((OUT / name).is_file() for name in names)
    target = OUT / "ALPS-current-presentation.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            archive.write(OUT / name, name)
    with zipfile.ZipFile(target) as archive:
        assert archive.namelist() == names and archive.testzip() is None
    shutil.copy2(target, ROOT / "public/presentation-charts" / target.name)


if __name__ == "__main__":
    d, source_bytes, source_sha, groups = analyze()
    old_figures = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.name[:2] in ["01", "02", "03", "04", "05", "06"] and p.suffix in [".png", ".svg"]}
    summaries = create_figure(d, groups)
    export(d, source_sha, summaries)
    assert SOURCE.read_bytes() == source_bytes, "Immutable source changed while rendering; publication stopped"
    publish()
    current_bundle()
    assert all(hashlib.sha256((OUT / name).read_bytes()).hexdigest() == digest for name, digest in old_figures.items())
    print(json.dumps({"created": "07-single-pallet-eight-second-capacity", "source_sha256": source_sha, "rows": len(d['rows']), "selected": d['selectedAlgorithm'], "existing_01_to_06_unchanged": True}, ensure_ascii=False, indent=2))
