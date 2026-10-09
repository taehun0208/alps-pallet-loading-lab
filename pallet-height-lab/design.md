# Pallet Loading Lab — Industrial Digital Twin

Approved brief: preserve the existing Mixed Palletizing engine and redesign its presentation as a robotics engineering workbench. Scope: the continuous four-robot view at `palletView=relay`; existing simulator tabs, routes and workflows remain accessible.

## Current system
React 19 / TypeScript / Vite 7; direct Three.js 0.186 with OrbitControls; CSS stylesheets; hook-owned simulation snapshots with an asynchronous Worker. `FlowLab` orchestrates the current view, `useStream` owns lifecycle, `streamEngine` advances stock and motions, `streamPlanner` scores/validates placement, and `RelayScene` renders snapshots. Box observations, placements, pallet dimensions, score candidates and constraints remain their existing types.

## Preserve
No changes to algorithms, scores, candidate budgets, collision/bounds/load validation, clocks, workers, box generation, state flow, robot geometry, or motion paths. No dependencies added. Width/depth stay 1800×1500mm; max height stays editable. All existing controls and data export remain wired to their original handlers.

## Presentation
Replace the large warm landing-style heading with a compact status toolbar. Keep existing section content in left input / central 3D / right analysis columns. Controls sit directly under the viewport; observed decisions and archived pallets follow below. Small windows stack panels. No fake chart, FPS, score, telemetry, timeline, or pass/fail certificate.

`TwinRunStatus` renders actual run state, seed and simulation time. `TwinPackingReadout` calculates only current-cell volume usage, highest placement, count and support from existing snapshots. Empty support is shown as an em dash. No new simulation state is introduced.

## Locked tokens
Source of truth: `src/pallet/relay/twin.css`. Neutral graphite #1C2024, panels #252A2F, elevated #32383E, text #EDF0F2, secondary #B6BEC5, subtle #A4ADB5, borders #454C52, quiet separators #353C42, restrained cyan #8EBEC8. Square adjoining workbench panels, three-pixel controls, no UI shadows or glow. Existing Segoe UI/Malgun Gothic with Consolas numeric values and tabular numerals. Button transitions 120ms, disabled for reduced-motion preference.

Visual review refinement: compact navigation and title; muted notices; shared playback/focus toolbar at 1700px and above; desktop side panels scroll when needed. Preserve every existing content section and control. Review evidence: `docs/visual-design-review.md`.

3D palette: `twinSceneTheme.ts` plus `FactoryEnvironment.FACTORY`. Daylight concrete, off-white robot paint, dark joints, steel and restrained safety yellow. `factoryLighting.ts` supplies a one-time prefiltered environment reflection, hemisphere/fill lighting and one 2048px shadow map. No postprocessing or external image assets. This is browser Three.js raster rendering, not FactoryLens, Omniverse or ray tracing. Stable source-color mapping makes a carton retain its display color through belt, gripper, stack and decision feed. Geometry, coordinates, physical constraints and input JSON stay unchanged. The optional robot palette only affects the relay view; other views retain their existing robot colors.

## References
- Foxglove panels: https://docs.foxglove.dev/docs/visualization/panels
- Isaac Sim interface: https://docs.isaacsim.omniverse.nvidia.com/latest/gui/reference_user_interface.html
- Visual Components manufacturing simulation product screenshot: https://www.visualcomponents.com/products/manufacturing-simulation/
- FactoryLens material/lighting comparison: https://www.visualcomponents.com/products/factorylens/

The user explicitly requested these two public products as inspiration. Study scope is the product screenshots and rendering approach, not the marketing site layout. Adopt light industrial rendering inside restrained dark workbench panels; retain our own fonts, brand, controls, 3D geometry and actual telemetry. Avoid marketing gradients, copied product imagery and unsupported CAD/PLC/Omniverse feature claims. See `docs/factory-render-review.md`.

## Risk checks
Verify resize framing, focus controls, hidden view behavior, button handlers, reset/restart, exports and archival views. Compare SHA256 of 134 pre-existing non-presentation TS/TSX files against `work/digital-twin-before/protected-hashes.json`. Verify desktop 1920×1080, 1440×900 and 1366×768; narrow views 320/375/414/768 for clipping and control usability.

## Hyundai / CoM dashboard amendment — 2026-10-09
The user authorized a Hyundai-inspired optional visual robot shell and a display-only stability score. These supersede the earlier no-new-score/no-robot-geometry presentation scope. Engine/solver/paths/collision validation remain unchanged. Compact CoM panel leads the right inspector, existing packing analysis follows. Individual pallet frames are evaluated separately; global index assumes a coherent rigid stack and does not replace local support checks. Official visual reference: https://www.hd-hyundairobotics.com/biz/product/detail/41

## Configurable robots / first screen — 2026-10-09
User now authorizes functional changes: default single-robot algorithm detail; scalable central dispatch in a separate tab. Reuse the locked workbench tokens, existing view ownership and rendering. Add configurable 1–8 workcells and floor / Cartesian ceiling / mixed profiles. Preserve original tabs, algorithms and direct relay links. Robot count changes reset reservations/workers and resize conveyor/layout. Gantry is generic, suction physics and complete machine collision remain unverified.
