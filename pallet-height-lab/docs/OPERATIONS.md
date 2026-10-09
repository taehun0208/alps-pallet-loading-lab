# Four-cell operations model

The existing rule-based mixed pallet planner is preserved. Operations add a finite batch around it: receiving → packing → inspection → dispatch → empty-pallet return. A batch does not claim unknown future arrival prediction. The infeed visualization is a virtual four-lane scanner with pre-generated box metadata, not sensor integration.

## Model and controls
Choose the box set and one environment preset. Fixed cell: 650 mm/s TCP, 35 kg payload; AMR transport: 600 mm/s, 4 s docking; cobot preset: 300 mm/s, 15 kg payload, 500 mm/s transport; mobile pallet: 450 mm/s transport. All are illustrative assumptions, not manufacturer specifications. Transport uses 3 m separate lanes and one transport unit per cell. The gripper defaults to 180×160×160 mm, 5 mm margin; the 40–250 mm thickness slider changes actual geometry/clearance checks and resets the batch.

All presets explicitly enable the existing physical gripper model. Translation and rotation duration use their maximum, plus pick/place holds. Acceleration, human sensing, traffic control, complete robot-link swept collision and certified cobot safety are outside this model.

Release occurs only when no actions remain, no worker calculation or robot motion is pending, and at least one pallet has boxes. Manifest IDs retain completed placements; remaining queues and shared pads are retained. The 3D cargo leaves, the empty pallet returns, and the experiment stops. A new batch button resets the experiment; it is not continuous replenishment of the leftover stock. History reconstructs pre-dispatch placements.

## Local computation
One reusable Worker computes on state changes. Per-cell and ring-fit caches remain; equivalent shortlisted height subproblems now reuse their result within one decision. Height-fill limits are 24 initial candidates/type, 64 for three promising types, 96/type fallback and 16 height-combination finalists. Candidate-origin generation precedes truncation and remains variable in size. The UI reports actual accepted Worker result times, generated/checked candidates and cache hits; stale jobs, messaging/render time are excluded. Browser measurements are not edge hardware benchmarks. No AI inference/network API is needed for placement decisions.

## Validation
15 focused tests pass. 192 irregular boxes, seed 42, 1600 mm limit, physical 160 mm gripper: 71 placed, 121 retained; four arms concurrent; offline event simulation heights 1585/1599/1578/1591 mm. Browser scheduling can vary the order of near-simultaneous events. A browser run also placed 71 and achieved >98% on all four pallets, then completed outfeed/empty return. JSON export includes context, operation phase, manifest and measured compute counters.

The motion film is now 80 seconds / 10 chapters; the moving diagrams are explanatory, not a replay or measured-performance claim.
