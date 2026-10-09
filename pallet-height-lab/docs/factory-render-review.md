# Factory rendering refinement — 2026-10-08

Hallmark critique: Philosophy 5 / Hierarchy 5 / Execution 4 / Specificity 5 / Restraint 5 / Variety 4.

## Reference observations

- Visual Components manufacturing simulation: compact grey workbench surrounding a bright CAD viewport, white industrial equipment, grey floor, limited safety yellow and selection color. Reference: https://www.visualcomponents.com/products/manufacturing-simulation/
- FactoryLens: the same simulation presented with material response, illumination, reflections and shadows. This is a rendering product, not an operations dashboard. Reference: https://www.visualcomponents.com/products/factorylens/
- Inspected the public product screenshots in a real browser. Exact product UI fonts and motion timing cannot be established from the screenshots; existing app typography and motion remain unchanged.
- No reference assets are bundled, no proprietary product interface is copied. This implementation remains a Three.js browser simulator.

## Changes

- Neutral graphite adjoining panels frame a bright grey 3D factory stage.
- Light concrete, white/grey walls and robot shells, darker articulated joints, steel conveyors and subdued safety markings.
- A prefiltered room environment is generated once at scene mount, then its generator is disposed. One shadow-casting light plus fill lighting makes machine volume and floor contact readable. No frame-by-frame reflections, postprocessing or downloaded assets.
- Lighter diagram edges and contrast-safe viewport captions.
- Original controls, dimensions, geometry, camera interactions, planner, constraints, simulation clocks and box data remain intact.

## Verification

- Source hash comparison: 135 of 139 existing TS/TSX files unchanged. The four changed files contain presentation edits only: FactoryEnvironment, RelayScene, twinSceneTheme, RobotArmView. New file: factoryLighting.
- Robot pose, interference, stream settings/restart regression suite: 9 tests passed.
- Actual browser run: irregular boxes enter and circulate, robots transfer boxes, packing readouts update. Pause and existing close-up camera worked. No browser console errors observed.
- 1920×1080: central viewport 1373×761px; playback and pallet focus remain visible.
- 768, 414, 375 and 320px: no horizontal document overflow or clipped buttons in DOM measurements. Narrow 3D scene preserves orbit/zoom and overview framing.
- Public version 17 verified: 96 entered, 82 placed across four cells (29/23/19/11), 14 circulating at pause; factory/analysis view toggle worked, no console errors. Screenshot: `screenshots/factory-v17-public-1920.png`. Deployment commit: `3f8dc9c6bb0511365b306d5c87c0697af66dc0f4`.

## Limits

This improves visual presentation; it does not add CAD import, PLC integration, Omniverse, ray tracing, or industrial robot certification. One shadow map increased from 1024 to 2048 pixels; real mobile-device GPU performance has not been measured. The algorithm and all computation budgets are unchanged.
