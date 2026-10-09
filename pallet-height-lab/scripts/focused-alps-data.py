"""Publish a small, traceable view of the two current experiments."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
capacity_path = ROOT / "docs/presentation/claude/executed-capacity.json"
order_path = ROOT / "public/presentation-example.json"
capacity = json.loads(capacity_path.read_text())
order = json.loads(order_path.read_text())
assert len(capacity["rows"]) == 40
assert order["schema"] == "alps-complete-order/2"

def average(rows, field):
    return sum(field(r) for r in rows) / len(rows)

policies = []
for replay in order["replays"]:
    rows = [r for r in order["rows"] if r["split"] == "holdout" and r["policy"]["id"] == replay["policy"]["id"] and r["valid"]]
    assert len(rows) == 20
    policies.append({"policy": replay["policy"], "n": len(rows),
        "fill": average(rows, lambda r: r["utilization"]),
        "pallets": average(rows, lambda r: len(r["batches"])),
        "total": average(rows, lambda r: r["totalSeconds"]),
        "packing": average(rows, lambda r: r["packingSeconds"]),
        "store": average(rows, lambda r: r["store"]["seconds"]),
        "redistribution": average(rows, lambda r: r["store"]["redistributionSeconds"]),
        "shelf": average(rows, lambda r: r["store"]["shelfSeconds"]),
        "rehandles": average(rows, lambda r: r["store"]["rehandles"]),
        "walked": average(rows, lambda r: r["store"]["walked"]),
        "meanMs": average(rows, lambda r: r["meanMs"]),
        "maxMs": max(r["maxMs"] for r in rows)})

data = {"schema": "alps-focused/1", "sources": [
    {"path": str(p.relative_to(ROOT)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    for p in [capacity_path, order_path]],
    "capacity": {"selected": capacity["selectedAlgorithm"], "holdout": capacity["summary"]["holdout"],
        "maxMs": max(r["maxMs"] for r in capacity["rows"]),
        "completed": sum(r["status"] == "finished" for r in capacity["rows"]),
        "violations": sum(len(r["violations"]) for r in capacity["rows"]),
        "rows": [{k: r[k] for k in ["algorithm", "seed", "split", "utilization", "meanMs", "maxMs"]} for r in capacity["rows"]],
        "paired": capacity["pairedReports"]},
    "order": {"policies": policies, "report": order["report"], "selection": {k: order["selection"][k] for k in ["baseline", "alps", "worst"]},
        "replaySeed": order["replaySeed"], "storeConfig": order["config"]["store"]}}
(ROOT / "public/alps-current.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
print("Published alps-current.json; 40 capacity trials and 100 order holdouts summarized.")
