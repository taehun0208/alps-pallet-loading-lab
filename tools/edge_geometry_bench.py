"""Compare exact AABB full scans vs. a uniform grid on synthetic inputs.

Host Python timings do NOT predict Arduino timings or full planner performance.
Run: python3 tools/edge_geometry_bench.py
"""
import json
import platform
import random
import statistics
import time
from pathlib import Path


def overlaps(a, b):
    return (a[0] < b[3] and a[3] > b[0] and
            a[1] < b[4] and a[4] > b[1] and
            a[2] < b[5] and a[5] > b[2])


def cells(a, step=300):
    # Half-open boxes: face touching is not interior overlap.
    for x in range(a[0] // step, (a[3] - 1) // step + 1):
        for y in range(a[1] // step, (a[4] - 1) // step + 1):
            for z in range(a[2] // step, (a[5] - 1) // step + 1):
                yield x, y, z


def build_index(boxes):
    grid = {}
    for i, box in enumerate(boxes):
        for cell in cells(box):
            grid.setdefault(cell, set()).add(i)
    return grid


def scan(boxes, candidates, grid=None):
    outcomes, comparisons = [], 0
    for candidate in candidates:
        if grid is None:
            ids = range(len(boxes))
        else:
            nearby = set()
            for cell in cells(candidate):
                nearby.update(grid.get(cell, ()))
            ids = sorted(nearby)
        collision = False
        for i in ids:
            comparisons += 1
            if overlaps(candidate, boxes[i]):
                collision = True
                break
        outcomes.append(collision)
    return outcomes, comparisons


def inputs():
    # Four independent pallets, each with a non-overlapping 10x10 layer.
    datasets = []
    for robot in range(4):
        rng = random.Random(20261009 + robot)
        boxes = [(x*180, y*150, 0, x*180+160, y*150+130, 100)
                 for x in range(10) for y in range(10)]
        candidates = []
        for w, d, h in [(120, 100, 80), (280, 110, 100), (100, 250, 120)]:
            for width, depth in [(w, d), (d, w)]:
                for _ in range(20):
                    x = rng.randint(0, 1800-width)
                    y = rng.randint(0, 1500-depth)
                    z = rng.choice([0, 50, 100, 300])
                    candidates.append((x, y, z, x+width, y+depth, z+h))
        datasets.append((boxes, candidates))
    return datasets


def main():
    data = inputs()
    t = time.perf_counter_ns()
    indices = [build_index(boxes) for boxes, _ in data]
    build_ms = (time.perf_counter_ns()-t)/1e6
    baseline = [scan(b, c) for b, c in data]
    indexed = [scan(b, c, g) for (b, c), g in zip(data, indices)]
    assert [x[0] for x in baseline] == [x[0] for x in indexed]
    # Boundary behavior and a box spanning multiple index cells.
    fixture = [(0, 0, 0, 300, 300, 300), (300, 0, 0, 600, 300, 300)]
    probes = [(0, 0, 300, 300, 300, 600), (299, 0, 0, 301, 10, 10),
              (-10, 0, 0, 0, 10, 10), (600, 0, 0, 601, 1, 1)]
    assert scan(fixture, probes)[0] == [False, True, False, False]
    assert scan(fixture, probes, build_index(fixture))[0] == scan(fixture, probes)[0]
    timing = {}
    for mode in ["full_scan", "grid"]:
        samples = []
        for run in range(105):
            t = time.perf_counter_ns()
            for (b, c), g in zip(data, indices):
                scan(b, c, g if mode == "grid" else None)
            if run >= 5:
                samples.append((time.perf_counter_ns()-t)/1e6)
        timing[mode] = {"median_ms": statistics.median(samples),
                        "p95_ms": sorted(samples)[94]}
    full_pairs = sum(x[1] for x in baseline)
    index_pairs = sum(x[1] for x in indexed)
    result = {
        "scope": "Synthetic geometry-only Python host benchmark; NOT AVR/full-planner timing",
        "host": platform.machine(), "python": platform.python_version(),
        "seed_base": 20261009, "robots": 4, "boxes_per_pallet": 100,
        "candidate_count": sum(len(c) for _, c in data),
        "colliding_candidates": sum(sum(x[0]) for x in baseline),
        "all_outcomes_equal": True,
        "full_scan_pair_checks_with_early_exit": full_pairs,
        "grid_pair_checks_with_early_exit": index_pairs,
        "pair_check_reduction_percent": (1-index_pairs/full_pairs)*100,
        "grid_build_ms_one_observation": build_ms,
        "host_timings_grid_excludes_build": timing,
        "limitations": ["No support/load/path/scheduling/packing-quality checks.",
                        "Index memory is not suitable for R3 in this Python representation.",
                        "Index build/update/query overhead must be included on target hardware.",
                        "One layer layout and one synthetic distribution; not general speedup."]
    }
    output = Path(__file__).resolve().parents[1] / "output" / "edge-geometry-benchmark.json"
    output.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
