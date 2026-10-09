"""Ask the explicitly requested Opus model to invoke a bounded local simulator.

The model can choose only six named cases. It cannot supply shell commands,
paths, code, credentials, or arbitrary parameters. API keys are never logged.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/presentation/claude"
MODEL = "claude-opus-5-5"
CASES = {"before", "after", "extremes", "hybrid", "hrpal", "capacity"}


def finalize_existing():
    """Finish interpretation from verified compact metrics without rerunning tools.

    The first request already executed all six cases. Large tool results exhausted
    the response budget in thinking-only replies. Preserve that audit and use a
    separate, bounded response request with concise results and a larger budget.
    """
    audit = json.loads((OUT / "api-execution-log.json").read_text())
    assert {c["case"] for c in audit["tool_calls"]} == CASES
    evidence = []
    for case in sorted(CASES):
        path = OUT / f"executed-{case}.json"
        raw = path.read_bytes()
        d = json.loads(raw)
        call = next(c for c in audit["tool_calls"] if c["case"] == case)
        assert hashlib.sha256(raw).hexdigest() == call["result"]["artifactSha256"]
        item = {"case": case, "status": d["status"], "artifact": path.name,
                "sha256": hashlib.sha256(raw).hexdigest()}
        if case == "hrpal":
            item.update(metrics=None, reason="Vendor Windows program unavailable; official download blocked by HTTP 402 or member login. No HRPal execution or scores.")
        elif case == "capacity":
            item.update(rows=len(d["rows"]), selectionSeeds=3, holdoutSeeds=5,
                selected=d["selectedAlgorithm"], maxCallMs=max(r["maxMs"] for r in d["rows"]),
                completed=sum(r["status"] == "finished" for r in d["rows"]),
                violations=sum(len(r["violations"]) for r in d["rows"]),
                policies=[{"algorithm": r["algorithm"], "n": r["n"], "fill": r["utilization"]["mean"],
                    "boxes": r["count"]["mean"], "meanMs": r["ms"]["mean"]} for r in d["summary"]["holdout"]],
                paired=[{"before": p["before"], "after": p["after"], "meanPP": p["fillPercentagePointDifference"]["mean"],
                    "ci95PP": p["fillPercentagePointDifference"]["ci95"]} for p in d["pairedReports"]])
        else:
            item["policies"] = [{"policy": r["policy"]["id"], "n": r["eligibleComplete"],
                **{k: r[k]["mean"] for k in ["fill", "pallets", "totalSeconds", "packingSeconds", "robotSeconds", "computeSeconds", "planningWaitSeconds", "overlappedComputeSeconds"]},
                "maxCallMs": r["maxDecisionMsAllRuns"], "violations": r["violationsAllRuns"]} for r in d["summary"]]
            item["paired"] = [{"before": p["before"], "after": p["after"], "savedSeconds": p["report"]["saved"]["mean"],
                "ci95Seconds": p["report"]["saved"]["ci95"]} for p in d["pairedReports"]]
        evidence.append(item)
    prompt = """기존 Claude Opus 5.5 도구 호출에서 6개 case가 실행되어 저장됐습니다. 아래는 원본 해시와 대조한 실제 실행 요약입니다.
원래 요청이 큰 도구 응답을 읽다가 최종 출력 한도에 도달했으므로 이번 요청은 해석만 마무리합니다. 재실행을 주장하지 마세요.
유효한 JSON 하나로 간결한 한국어 검토 보고서를 작성하세요. 수치를 발명하거나 계산을 다시 흉내 내지 마세요.
구조: schema, model, cases(6개), pipeline_review, presentation_claims, hrpal, conclusion_ko.
각 case는 status, artifact, verified_metrics, interpretation_ko 포함. 출력은 4000토큰 이내로 간결하게 마무리하세요.
맥락: 로봇 8초 동작 중 다음 상자 인식/계산. 첫 계산과 노출 대기만 합산: packing=8*N+exchange+planningWait,
compute=planningWait+overlappedCompute. 후속 센서/통신/감사 지연은 제외. 실제8초제어 보장 아님.
before/after/extremes/hybrid는24박스전체주문,선택5시드에서고정,평가20시드. capacity는72박스단일팔레트/1200mm/버퍼2,
계획호출당8초,선택3시드평가5시드. 여러보류재계산때문에단일호출<8초가전체주기<8초보장은아님.
매장애니메이션은제외하지만적재방법에따른진열효율/매장예상시간은유지. 현장실측아님. CI는이입력/무작위순서에만조건부.
HRPal 실제소프트웨어를실행못했으므로not_evaluated와metrics:null. 공식근거 https://www.hd-hyundairobotics.com/biz/product/support/287 및 https://down-hd.web.app/en/docs/software/HRpal/.
전체주문의승수는1ms미만측정잡음에바뀌어평균과CI를우선. 24박스/72박스순위차이는모순이아니라다른실험임.
실제검증수치:\n""" + json.dumps(evidence, ensure_ascii=False)
    target = OUT / "opus-5-5-simulation-report.json"
    if target.exists():
        sys.exit("Report already exists; preserving it.")
    env = dict(line.split("=", 1) for line in (ROOT.parent / ".env").read_text().splitlines()
               if line.strip() and not line.lstrip().startswith("#") and "=" in line)
    key = env.get("ANTHROPIC_API_KEY", "").strip().strip("\"'") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("Anthropic credential not configured.")
    (OUT / "finalization-request.txt").write_text(prompt)
    body = {"model": MODEL, "max_tokens": 32768, "output_config": {"effort": "max"}, "messages": [{"role": "user", "content": prompt}]}
    request = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit(f"Anthropic HTTP {error.code}; credentials omitted.")
    except (urllib.error.URLError, TimeoutError):
        sys.exit("Anthropic connection failed; credentials omitted.")
    saved = {k: result.get(k) for k in ["id", "model", "stop_reason", "usage"]}
    saved["content"] = [b for b in result.get("content", []) if b["type"] == "text"]
    (OUT / "finalization-api-log.json").write_text(json.dumps(saved, ensure_ascii=False, indent=2))
    if result.get("stop_reason") != "end_turn":
        sys.exit("Finalization incomplete; response metadata preserved.")
    report = json.loads("\n".join(b["text"] for b in saved["content"]))
    target.write_text(json.dumps({"provenance": {"requested_model": MODEL, "returned_model": result["model"], "effort": "max",
        "tool_cases_executed": sorted(CASES), "api_log": "api-execution-log.json", "finalization_log": "finalization-api-log.json",
        "note": "All six cases were invoked by the original tool loop. Final interpretation used a separate concise request after thinking-only budget exhaustion; no simulations were repeated."}, "report": report}, ensure_ascii=False, indent=2))
    print(json.dumps({"saved": str(target), "model": result["model"], "usage": result["usage"]}), flush=True)


def main():
    env = {}
    for line in (ROOT.parent / ".env").read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            env[name.strip()] = value.strip().strip("\"'")
    key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("Anthropic credential not configured; no credential contents logged.")
    if not (ROOT / "node_modules/.cache/claude-simulation.mjs").exists():
        sys.exit("Compile scripts/claude-simulation.ts first.")
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / "opus-5-5-simulation-report.json"
    if target.exists():
        sys.exit("Report already exists; preserving the original API response.")
    source = (ROOT / "src/pallet/presentation/model.ts").read_text()
    prompt = """사용자 요청: Claude Opus 5.5를 실제 호출해 시뮬레이션별 계산을 실행하고 JSON 결과를 받으려 합니다.
반드시 run_simulation 도구로 before, after, extremes, hybrid, hrpal, capacity 여섯 case를 각각 호출하세요.
도구는 검증된 로컬 TypeScript 계산기를 실행하며 실제 실행 원본을 파일에 저장합니다.
수치를 머릿속으로 시뮬레이션하거나 도구 호출 없이 만들어내지 마세요. HRPal은 실제 실행할 수 없으면
not_evaluated와 metrics:null을 그대로 보존하세요. 임의 알고리즘을 HRPal이라고 부르면 안 됩니다.

사용자 전제: 로봇 박스당 8초 사이클. 로봇이 움직이는 동안 다음 박스를 인식하고 계산합니다.
8초 안에 숨겨지는 계산시간을 총 작업시간에 다시 더하지 않습니다. 첫 준비계산과 숨기지 못한 대기는 포함합니다.
8초는 비교 가정이고 실기종 실측/보증이 아닙니다. 센서·통신·추가 복귀 지연은 별도입니다.
매장 이동/진열 애니메이션은 하지 않지만 적재 방식에 따른 재취급, 이동, 예상 매장 작업시간 설명은 유지합니다.
매장 시간은 가정에 따른 추정이고 실측 개선을 입증한 값이 아닙니다. 실제 최대 적재율과 예상 총시간의 우승자를 혼동하지 마세요.
24박스 전체주문은 단일팔레트 가득채움 72박스 벤치마크와 다른 실험입니다. capacity case는별도72박스·1200mm·8초판단기한5알고리즘40실행이며3선택/5평가시드를사용합니다. capacity의평가수를20이라고바꾸지마세요.
선택용 5시드와 분리된 평가 20시드, 조건부 신뢰구간의 한계를 보고하세요.
Future-Aware Hybrid OFF/ON을 모두 포함합니다. 과거 250ms 기준 탈락을 그대로 적용하지 마세요.

최종 응답은 마크다운 없이 유효한 JSON 하나로만 반환하세요. 권장 구조:
{schema, model, simulation_basis, cases:[{case,status,policies,metrics,artifact,interpretation_ko}],
 pipeline_review:{formula,checks,limitations}, presentation_claims:{supported_ko,not_supported_ko},
 hrpal:{status,metrics,reason_ko,sources}, conclusion_ko}.
숨은 사고과정은 요구하지 않습니다. 검증 가능한 수치·산출물·간결한 결론만 반환하세요.

계산기 소스(검토용, 도구를 실제 호출한 결과가 수치의 근거입니다):\n""" + source
    (OUT / "request.txt").write_text(prompt)
    messages = [{"role": "user", "content": prompt}]
    tool = {"name": "run_simulation", "description": "Execute the fixed local robot-palletizing experiment for one named case and return measured results. HRPal returns an explicit not-evaluated record if the vendor executable is unavailable.",
            "input_schema": {"type": "object", "properties": {"case": {"type": "string", "enum": sorted(CASES)}}, "required": ["case"], "additionalProperties": False}}
    audit = {"requested_model": MODEL, "effort": "max", "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(), "rounds": [], "tool_calls": []}
    called = set()
    for round_number in range(8):
        body = {"model": MODEL, "max_tokens": 16000, "output_config": {"effort": "max"}, "messages": messages,
                "tools": [tool], "tool_choice": {"type": "auto"}}
        request = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            sys.exit(f"Anthropic HTTP {error.code}; credentials and response body omitted.")
        except (urllib.error.URLError, TimeoutError):
            sys.exit("Anthropic connection failed (network/DNS/timeout); credentials omitted.")
        audit["rounds"].append({"id": result.get("id"), "model": result.get("model"), "stop_reason": result.get("stop_reason"), "usage": result.get("usage"),
                               "content": [b for b in result.get("content", []) if b["type"] in {"text", "tool_use"}]})
        (OUT / "api-execution-log.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2))
        print(json.dumps({"round": round_number + 1, "model": result.get("model"), "stop_reason": result.get("stop_reason"), "usage": result.get("usage")}), flush=True)
        messages.append({"role": "assistant", "content": result["content"]})
        calls = [b for b in result["content"] if b["type"] == "tool_use"]
        if calls:
            outputs = []
            for call in calls:
                args = call.get("input", {})
                if call.get("name") != "run_simulation" or set(args) != {"case"} or args["case"] not in CASES:
                    value = {"error": "Only the fixed case enum is permitted."}
                else:
                    case = args["case"]
                    print(f"Executing local simulation requested by Claude: {case}", flush=True)
                    process = subprocess.run(["node", "node_modules/.cache/claude-simulation.mjs", case], cwd=ROOT, capture_output=True, text=True, timeout=1200, check=False)
                    if process.returncode:
                        value = {"error": "Local simulator failed", "exit_code": process.returncode, "details": process.stderr[-2000:]}
                    else:
                        value = json.loads(process.stdout)
                        called.add(case)
                    audit["tool_calls"].append({"id": call["id"], "case": case, "result": value})
                    (OUT / "api-execution-log.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2))
                outputs.append({"type": "tool_result", "tool_use_id": call["id"], "content": json.dumps(value, ensure_ascii=False)})
            messages.append({"role": "user", "content": outputs})
            continue
        text = "\n".join(b["text"] for b in result["content"] if b["type"] == "text").strip()
        if called != CASES:
            messages.append({"role": "user", "content": f"Run the missing cases using the tool before reporting: {sorted(CASES - called)}"})
            continue
        try:
            report = json.loads(text)
        except json.JSONDecodeError:
            messages.append({"role": "user", "content": "Return the final report as valid JSON only, no Markdown fences. Do not repeat completed tool calls."})
            continue
        if result.get("stop_reason") != "end_turn":
            messages.append({"role": "user", "content": "Return a shorter complete JSON report, limited to verified metrics and concise conclusions."})
            continue
        target.write_text(json.dumps({"provenance": {"requested_model": MODEL, "returned_model": result.get("model"), "effort": "max", "tool_cases_executed": sorted(called), "api_log": "api-execution-log.json"}, "report": report}, ensure_ascii=False, indent=2))
        print(json.dumps({"saved": str(target), "cases": sorted(called)}), flush=True)
        return
    sys.exit("No complete six-case JSON report within eight API rounds; audit log preserved.")


if __name__ == "__main__":
    if sys.argv[1:] == ["--finalize-existing"]:
        finalize_existing()
    elif not sys.argv[1:]:
        main()
    else:
        sys.exit("Unsupported arguments.")
