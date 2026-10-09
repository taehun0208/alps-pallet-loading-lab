"""Package explicit result files only; never include credentials or local config."""
import hashlib
import json
import shutil
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / "docs/presentation/claude"
report = source / "opus-5-5-simulation-report.json"
parsed = json.loads(report.read_text())
assert parsed["provenance"]["returned_model"] == "claude-opus-5-5"
assert set(parsed["provenance"]["tool_cases_executed"]) == {"before", "after", "extremes", "hybrid", "hrpal", "capacity"}
files = [source / f"executed-{case}.json" for case in ["before", "after", "extremes", "hybrid", "hrpal", "capacity"]]
files += [report, source / "api-execution-log.json", source / "finalization-api-log.json",
    root / "docs/presentation/EVIDENCE-REVIEW.md", root / "docs/presentation/HRPAL-RESEARCH.md",
    root / "public/alps-current.json", root / "public/presentation-example.json"]
manifest = {str(p.relative_to(root)): {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}
readme = """ALPS current results — 2026-10-10

executed-*.json: Original bounded local simulator records invoked through Claude Opus 5.5 tools.
capacity: 72 input boxes, one pallet, height 1200 mm, robot constraints, 8000 ms per planner call,
3 discovery seeds and 5 holdout seeds per algorithm. 40 runs. A finished capacity run may leave boxes unplaced.
before/after/extremes/hybrid: 24-box complete-order robot/store model, 20 holdout seeds per policy.
hrpal: NOT evaluated. Vendor software unavailable; metrics remain null.

opus-5-5-simulation-report.json: Actual Opus 5.5 interpretation, effort=max.
api-execution-log.json: Original six tool calls. Thinking-only responses exhausted output budgets.
finalization-api-log.json: Separate compact final interpretation request; original simulations were not repeated.
Model commentary is not independent physical validation. Use the raw numbers and evidence audit as the reference.

public/presentation-example.json: Existing v2 150-run source of the 24-box screen/chart 06.
public/alps-current.json: Small page summary combining v2 order holdouts with the new capacity record.
The fresh Claude-invoked repeats differ slightly in measured timing; do not pool them as new independent seeds.

Store worktime and shelf-stocking efficiency remain modeled explanatory factors.
Only the animated store walkthrough/stocking simulation is omitted from the page.
Do not claim field-validated store savings, global-optimal packing, real-robot 8-second control guarantees,
transport vibration resistance, or measured HRPal comparison.
"""
destination = root / "public/claude-simulation-results.zip"
with ZipFile(destination, "w", ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in files:
        bundle.write(path, str(path.relative_to(root)))
    bundle.writestr("MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    bundle.writestr("README.txt", readme)
with ZipFile(destination) as bundle:
    assert bundle.testzip() is None
    for filename, expected in manifest.items():
        assert hashlib.sha256(bundle.read(filename)).hexdigest() == expected["sha256"]
shutil.copyfile(report, root / "public/claude-simulation-report.json")
print(json.dumps({"archive": str(destination), "bytes": destination.stat().st_size, "verified_files": len(files)}, ensure_ascii=False))
