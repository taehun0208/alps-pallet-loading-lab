# Continuous mixed palletizing — 2026-10-08

One shared rectangular conveyor, four independent robots, asynchronous sensor observations and per-cell AMR cycles replace the batch-first relay UI. The existing batch engine remains available in source for regression tests; the existing public URL opens the continuous engine.

## Decision model
- Each seeded individual carton has its own mm dimensions, mass, material, allowable load and allowed orientations. No geometric tiling template is used. Seed 42 produces 96 distinct dimensions across six aspect-ratio families.
- Boxes enter only when circular belt spacing is available. Scanning completes while moving; pending and unmeasured observations and their type definitions do not cross the Worker planning boundary.
- Robot eligibility is tied to its physical straight-run interception window. The planner evaluates up to 64 candidates, including packaging, gripper path, support >=92%, cumulative static reactions, load limits, heavy-on-light constraints, CoG, stability, standing skyline and the configured height limit.
- Preserve broad floor supports; preferentially place small parcels on existing supports. Compare the candidate with up to three other observed parcels. Reject a candidate if it removes a sampled parcel's remaining feasible placement across the four current cells. Fragile caps are deferred while useful structural stock remains.
- Recompute moving interception at actual dispatch time. Track the parcel at conveyor speed through the grasp interval. Reserve box, robot and swept transport path. Stale cell versions or expired pickup windows never become a teleport or duplicate pickup.
- Infeasible parcels stay on the conveyor. No robot pick-to-buffer action occurs. Idle cells independently inspect, dispatch and replace pallets at 96% height or after a full recirculation opportunity (1.1 laps), sufficient distinct no-fit observations and no further placement. This must work even if a full belt is throttling the inlet; waiting for input closure would deadlock.
- A dropped worker result while paused is discarded; rendering interpolates continuously between simulation updates. Independent AMR cycles preserve stock in the dispatch manifest. Archived pallets can be inspected without modifying live state.

## Validation
Build: npm run build (passes; existing large Three/physics bundle warning remains).
Tests: 62 focused tests plus one 96-parcel long-run test pass.
Seed 42, 1s deterministic scheduler: 95/96 placed by 1599.1 simulated seconds, peak four simultaneous arms, AMR/robot overlap true, nine dispatched pallets; maximum observed height 888mm under the 1600mm limit, minimum support 92.636%, all six allowed orientations represented. The remaining box keeps circulating; no claim of a complete or globally optimal packing. Full report: work/continuous-validation.json. Browser timing differs because planning is asynchronous and pickup windows can expire at high replay speeds.

## Assumptions
Uniform-mass rigid cuboids; synthetic material strength and friction; four dedicated straight AMR lanes; corner modules preserve parcel orientation. Robot reach and conservative tool/held-box sweeps are checked. Full robot-link swept collisions, package deformation, suction and AMR fleet planning are not certified. The sampled blockage count is not a calibrated probability.

## Public verification
Version 12 published to the existing public URL. Browser worker execution, overlapping infeed/picking, peak four concurrent arms, pause, reset/restart, and archived pallet inspection verified. No production console errors. Widths 320/375/414/768 have no document horizontal overflow. The public asynchronous run produced an inspected first R1 pallet of 21 mixed boxes, 723mm high; its screenshot is saved under screenshots/continuous-mixed-pallet-public.png. Rendering and planner use independent clocks; the live run can differ from the deterministic 1s test scheduler.

Visual review: existing warm studio tokens and typography retained; concurrent status lanes replace the misleading global phase stepper; live controls remain next to the 3D canvas, and long parcel reasons wrap in a bounded feed. No new branding or unrelated page redesign.
