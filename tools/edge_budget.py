"""Reproducible arithmetic model, NOT a hardware timing benchmark.

Run: python3 tools/edge_budget.py
Pair costs below are hypothetical calibration points, not measured AVR cycles.
"""
import json
from pathlib import Path


def estimate():
    cpu_hz = 16_000_000
    scenarios = [
        ("one_cell_64_candidates", 1, 1, 1, 64, 100),
        ("three_cells_full_scan", 3, 3, 2, 20, 100),
        ("four_cells_full_scan", 4, 3, 2, 20, 100),
        ("four_cells_indexed_12_neighbors", 4, 3, 2, 20, 12),
    ]
    rows = []
    for label, robots, boxes, orientations, positions, neighbors in scenarios:
        candidates = robots * boxes * orientations * positions
        pairs = candidates * neighbors
        rows.append({
            "scenario": label,
            "candidates": candidates,
            "neighbors_per_candidate": neighbors,
            "pair_checks": pairs,
            "max_16bit_comparisons": pairs * 6,
            "hypothetical_geometry_ms_by_cycles_per_pair": {
                str(cycles): round(pairs * cycles / cpu_hz * 1000, 3)
                for cycles in (50, 100, 200)
            },
        })
    # Geometry: six uint16 values. Minimal state adds mass, strength and ID,
    # all uint16. Real ranges may require larger fields and more bookkeeping.
    mem = {
        "r3_sram_bytes": 2048,
        "r4_sram_bytes": 32768,
        "geometry_bytes_per_box": 12,
        "illustrative_state_bytes_per_box": 18,
        "geometry_100_boxes_one_pallet_bytes": 100 * 12,
        "state_100_boxes_one_pallet_bytes": 100 * 18,
        "geometry_100_boxes_each_four_pallets_bytes": 4 * 100 * 12,
        "state_100_boxes_each_four_pallets_bytes": 4 * 100 * 18,
        "heightmap_1800x1500mm_uint16_10mm_bytes": 180 * 150 * 2,
        "heightmap_1800x1500mm_uint16_50mm_bytes": 36 * 30 * 2,
        "heightmap_1800x1500mm_uint16_100mm_bytes": 18 * 15 * 2,
    }
    # Worst-case bound: every follow-up candidate needs all pair checks.
    # Of three eligible observed boxes, one is placed and two remain.
    # The two are tested independently in post-action state; this is not
    # a joint two-step rollout or proof of simultaneous fit.
    future = {
        "all_480_candidates_two_probes_40_positions_101_boxes":
            480 * 2 * 40 * 101,
        "top5_per_robot_two_probes_40_positions_101_boxes":
            4 * 5 * 2 * 40 * 101,
        "same_top5_probes_12_neighbors": 4 * 5 * 2 * 40 * 12,
    }
    return {
        "kind": "analytical_scenarios_not_hardware_measurements",
        "cpu_hz": cpu_hz,
        "assumptions": [
            "R3 at 16 MHz; 100 resident boxes PER pallet, not system-wide.",
            "Three eligible boxes per robot is a budget scenario, not measured availability.",
            "20 positions per orientation; this differs from the demo's 64-candidate cap.",
            "50/100/200 cycles per pair are hypothetical sensitivity inputs.",
            "Excludes indexing build/update, support, loads, paths, scheduling, I/O and interrupts.",
            "Full-scan timings are hypothetical where state does not fit SRAM.",
        ],
        "geometry": rows,
        "memory": mem,
        "future_probe_extra_pair_checks": future,
        "future_probe_definition": "Three observed eligible boxes: place one, independently probe two remaining. 40 poses includes both orientations. Not a rollout.",
        "future_probe_extra_ms_at_100_cycles": {
            k: round(v * 100 / cpu_hz * 1000, 3) for k, v in future.items()
        },
        "uart_8n1_one_direction_ms": {
            f"{size}_bytes_at_{baud}_baud": round(size * 10 / baud * 1000, 3)
            for size in (32, 512) for baud in (9600, 115200)
        },
        "illustrative_deadline": {
            "remaining_distance_mm": 150,
            "belt_speed_mm_s": 210,
            "time_to_end_of_pick_window_ms": round(150 / 210 * 1000, 3),
            "assumed_sensing_comm_actuation_margin_ms": 200,
            "remaining_decision_budget_ms": round(150 / 210 * 1000 - 200, 3),
            "note": "Distance and 200ms reserve are assumptions; speed is shown in demo.",
        },
    }


if __name__ == "__main__":
    result = estimate()
    dest = Path(__file__).resolve().parents[1] / "output" / "edge-budget.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
