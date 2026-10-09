# Throughput and maximum-height restart — 2026-10-08

## Restart diagnosis
The previous Apply action stopped at Ready and required a separate Start. The browser also reproduced `시뮬레이션 시계는 역행할 수 없습니다.` immediately after restart. A requestAnimationFrame timestamp is sampled at frame start and can precede the `performance.now()` sampled while mounting the new effect. A negative first delta was sent to the monotonic simulation engine.

Clamp the frame delta to [0, 0.1] seconds, keep the clock origin monotonic, and ignore callbacks from disposed runs. Apply now starts immediately; the main Start control also applies dirty conditions or restarts a completed/failed run. Restart creates a fresh worker, reservations, clock, scene and run identity. Height-only edits preserve the exact box set and custom packaging constraints. Invalid drafts leave the active run intact.

## Throughput changes
- Replace unconditional first-lap waiting for a broad foundation with a short initial window (10 seconds), extended to at most 30 seconds when an actually observed broad heavy carton approaches within 20 seconds.
- Cache repeated post-placement feasibility probes per run, cell version, candidate and observed carton. The same maximum three observed follow-up cartons are checked. Stop after two equally feasible candidates instead of four.
- After placing a carton, return the empty gripper directly above the parked pose, then descend. Preserve the complete pickup, carrying, release and initial escape path. Check the new tool/rotation envelope against the current stack and workspace; fall back to the original path when obstructed or slower. Existing TCP reach and inter-cell transport reservations still apply.
- Display boxes per simulated minute and mean recorded robot cycle time separately from replay speed. Conveyor speed (210 mm/s), TCP speed (850 mm/s), support ratio and all hard placement constraints are unchanged.

## Fixed-input comparison
48 individual cartons, 1600mm maximum height, seeds 42 and 7, same 1-second deterministic scheduler. Elapsed time includes final pallet removal. CPU timing varies with host load.

| Seed | Before total | After total | Reduction | Before / after recirculations | Before / after pallets |
|---|---:|---:|---:|---:|---:|
| 42 | 616.1s | 575.1s | 6.7% | 22 / 16 | 6 / 6 |
| 7 | 747.1s | 650.1s | 13.0% | 27 / 21 | 8 / 6 |

All 48 cartons finish in both fixtures. This is not a general optimality claim: seed 42's 40th completion becomes slower (336.5s to 386.2s), despite earlier first/24th completions and improved overall finish. Raw reports: `work/throughput-before.json`, `work/throughput-after.json`.

## Validation
Build succeeds. Targeted restart/clock/return-route/stream/long-stream tests: 13 passing; existing operations/conveyor/relay tests: 20 passing; throughput comparison: 1 passing.

The 96-carton long run still places 95, with the remaining upright carton circulating because of the standing-neighbor-height constraint. Minimum support is 92.4%, maximum observed height 818mm under 1600mm, all six orientations are used. All placed stacks are rechecked against placement constraints. All four robots do work, and pallet exchange overlaps other robots. Shorter cycles produce a peak of three overlapping actions for this random trace; an independent four-window fixture still verifies four simultaneous launches. No scheduling capacity is reduced.

Local browser verification: change height to 1200 via Apply and to 2000 via the main dirty-conditions Start button while moving; both reset and auto-start, then actually place boxes. Invalid 2500mm input shows a validation message while the existing 2000mm run continues. Pause remains functional.

Version 13 is published to the existing public site, audience unchanged. Commit `3dd48671b63eb5331e189c8f4911a963b31e5eb4`. Full robot-link dynamics and real packaging certification remain outside this idealized simulation model.

Production browser verification: applying 1200mm immediately starts at a fresh clock. At 243.3 simulated seconds, 30 boxes were placed, peak concurrency was four, height limit displayed 1200mm, and no console errors were recorded. Screenshot: `screenshots/throughput-height-restart-public.png`.
