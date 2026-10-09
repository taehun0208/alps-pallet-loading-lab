# One conveyor / four robots

## Layout and scheduling
- Four parallel work cells share one closed, zoned accumulation conveyor. One infeed portal, four pickup stations, four pallets, outbound lanes on the opposite side.
- Belt model: 900 mm wide, 450 mm deck height, 600 mm/s. R4 returns to R1 along the longer rear leg. Distances are calculated from the actual scene geometry.
- Each outbound segment holds one box. Departed/ready/arrived state is stored with inventory. An incoming box reserves its destination station; the planner cannot launch fresh pickup work there. An already running robot causes a hold 1 m upstream; the final metre resumes after its exit.
- Belt-only arrival events wake the Worker and continue the simulation even if no robot is currently moving. Pause freezes the common simulation clock. Completion requires a fresh decision for the current cell/motion revisions; a stale empty result cannot initiate dispatch.
- Initial stock has its real elevated belt pickup position. Recovered storage uses the local buffer. Both flat and tilting grasp paths respect source Z. Packing, material, support, load, footprint and swept tool constraints remain active.
- Near-ceiling height ranking scales unfillable leftover height by available headroom, not the total pallet height. This is a ranking heuristic; constraints remain hard filters.

## Explicit scope
This is a finite-batch, selectable accumulation model: the entire batch is measured at one portal (0.35 s per box) before packing. Stock is allocated to pickup zones and represented compactly. It does not simulate every box in a strict FIFO line, acceleration, PLC sensors, full-link continuous collisions, or certified robot safety. Repeated circulation stops until committed packing changes. AMR outbound routes remain separate from the belt. No AI inference or remote planner is used.

## Verification (2026-10-08)
- 57 unit/integration tests (plus the full 192-box regression): conveyor loop, return route, travel delay, station reservation, elevated grasp Z, inventory conservation, four concurrent arms, material/packaging/gripper regressions.
- Full 192-box AMR/tool scenario: 81 placed, 111 retained; 4 concurrent robots; heights 1585 / 1599 / 1581 / 1576 mm, limit 1600 mm; simulated robot/belt duration 464.29 s. These are measured results for seed 42, not a general utilization or success guarantee.
- Browser: eight-box demo completes 8/8, 2 conveyor transfers, peak concurrency 4. Four live robots observed reachable with no reported sampled link interference. Pause retained 47.6 s without advancing; completion dispatch preserved quantities.
- Responsive widths 320, 375, 414, 768: no root horizontal overflow.
- Design reference: https://styles.refero.design/style/e31435dd-d4fc-4534-8a40-35a1e38ebae5 (Agility Digit 5). Palette/layout inspiration only; no proprietary fonts or photography copied.

## Published browser run
Version 11, commit 801fb065b90ad848e0332549d3ccd16403697210. Live browser at 16×: 83 placed / 109 retained, 12 received transfers, 4 peak concurrent robots, heights 1585 / 1599 / 1581 / 1576 mm, 795.4 simulated seconds. Console errors: none. Browser scheduling and asynchronous Worker completion order can differ from the synchronous test runner; counts/time above are kept separate. Final loaded pallets were verified through the history slider after dispatch.

Proof: `screenshots/shared-conveyor-studio.png`.
