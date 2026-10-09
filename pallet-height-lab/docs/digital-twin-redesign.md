# Industrial Digital Twin UI — 2026-10-08

## Changed files
- `src/pallet/relay/FlowLab.tsx`: existing JSX sections rearranged into an input / viewport / analysis workbench; compact title and live state; original handlers preserved verbatim.
- `src/pallet/relay/RelayScene.tsx`: background, light intensity, label/edge/box presentation colors only. Geometry, coordinate transforms, animation clock, controls and paths are unchanged.
- `src/pallet/relay/FactoryEnvironment.ts`: factory rendering palette only.
- New `TwinPanels.tsx`: `TwinRunStatus` and `TwinPackingReadout`, pure presentation from existing props, no new simulation state.
- New `twin.css` and `twinSceneTheme.ts`: scoped CSS tokens/layout and consistent visual box-color mapping.
- `design.md` and `.hallmark/log.json`: design contract and validation record.

No production source file deleted, no library installed, no framework migration. The large warm introductory heading and card treatment were replaced by a compact graphite engineering layout. Inputs moved next to the viewport; existing controls, decision feed and output history remain accessible.

## Preserved behavior
Start, pause, resume, reset, speed, seeded/random box inputs, height application, placement, camera framing, facility visibility, pallet focus, archive inspection, JSON export and navigation retain original implementations. Planning, scoring, bounds, collision, loading rules, reach, simulation state and Worker code are unchanged. SHA256 comparison reports 134 protected TS/TSX files unchanged; the complete `FlowLab` function body before its JSX return also matches the original.

Actual data only: state/time/seed come from the hook; current-cell utilization is placed volume divided by the four current pallet capacities. Support is blank until a box has been placed. Constraint text states configured rules, not fabricated pass/fail certificates. No new AI score, FPS, telemetry, graphs, timeline or unimplemented controls.

## Design system
Graphite #0B0F14 / panel #111820 / text #E1E9F0 / restrained cyan #77BEC4. Four-pixel radii, flat separators, existing local fonts, tabular numeric values. Default Three.js engine retained. Factory geometry and all robot/box dimensions unchanged. Color transforms are render-only; exported observations and source type colors are original.

## Verification
- Baseline public version 14: completed 96-box run, archived pallet inspection, reset, start, pause, resume and camera controls verified before editing; baseline screenshot retained.
- TypeScript and Vite production build pass; pre-existing large Three/physics chunk warning remains.
- 23 regression tests pass: stream, stream settings/clock, direct return, conveyor and robot arm.
- New UI: seed 7, 24 boxes, 1200mm height completed at 275.8 simulated seconds; four dispatched pallets and COMPLETED state shown. This browser run is an interaction check, not a controlled throughput benchmark.
- Direct UI checks pass: input changes/apply, speed, actual placement and metric updates, pause/resume/reset, archive/current return, random seed, camera overview/focus, hide/show factory, JSON download and navigation to settings/data then back.
- Visual checks: 1920×1080, 1440×900 and 1366×768; mobile-width checks at 768, 414, 375, 320. No document horizontal overflow or clipped control labels at those widths. Small desktop viewport height adjusted to keep the playback toolbar accessible.
- No browser console errors in the checked runs.

Version 15 published to the existing public site, access policy unchanged. Commit: `b0ec560d0affc8f575b6ac0f0302331d50ab64e1`.

## Potential follow-up
Collapsible or user-resizable side panels could provide more viewport space for presentations. This is not implemented in this redesign.
