# Algorithm motion film

- Deliverable: `public/motion/pallet-algorithm.mp4`, 80 seconds, 1600×900, 30 fps, H.264/AAC.
- Player: `/motion/index.html`; seven chapter controls, scrubber, sound toggle, fullscreen and MP4 download.
- Source: `public/motion/film.mjs`; deterministic, hand-authored Canvas motion. Original synthesized audio in `scripts/render-motion.mjs`.
- Reference: [Oscilloscope-style studio motion graphic by @rneayan](https://prompt-motion.com/rneayan-ea6129), observed via its public video. Visual ideas used: dark grid, phosphor line traces, restrained technical labels. No source video, music or artwork copied.

## Content grounding

The film explains the existing four-arm relay and `height-fill` policy. It distinguishes arrived stock selection from unknown future arrival order. Relevant implementation: `relay/engine.ts` (independent planning, shared-pad locks, receive-place/receive-queue and finite circulation), `relay/heightFill.ts` (low foundations and bounded residual-height combinations), `compactPacking.ts` (compactness, support, trapped voids), `constraints.ts` and `relay/motion.ts` (placement and virtual transport checks).

Figures are explanatory, not exported physical simulation states or measured performance. Residual height is a ranking estimate. Material capacity is configured, not inferred solely from the material name. Full robot-link collision certification and packaging deformation are outside the model.

## Validation

Seven chapter stills reviewed and adjusted to keep text clear of diagrams. Final MP4 decoded fully by FFmpeg. Player checked for play/pause, seeking, chapter captions, mute toggle, 56-second duration and 1600×900 dimensions. Widths 320, 375, 414 and 768 checked for overflow and control wrapping. Existing planner logic is unchanged.

To rerender: set `MOTION_CANVAS_MODULE` to the installed `@napi-rs/canvas` module and `MOTION_FFMPEG` to FFmpeg, then run `node scripts/render-motion.mjs`. Windows rendering uses installed Malgun Gothic and Consolas. Other systems should supply suitable Korean fonts before rendering.


2026-10-08: Expanded to 80 s / 10 chapters. Added finite-batch infeed, actual tool geometry and cycle-time assumptions, AMR dispatch/empty return, and bounded local Worker computation. See ../OPERATIONS.md for model limits and validation.
