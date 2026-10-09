# Hyundai-inspired robot and CoM dashboard
Date: 2026-10-09
## Scope
Optional relay-only ivory cast-link shell, dark motors, round joint covers and HYUNDAI lettering. Visual reference: https://www.hd-hyundairobotics.com/biz/product/detail/41
The existing generic kinematics, dimensions, TCP path and collision model are unchanged; no exact/certified HDR35-20 digital twin claim.
Display-only mass-weighted CoM evaluation per pallet in its own local coordinates. Never average positions from different cells. Current overview shows the minimum scored pallet or invalid data first. An empty pallet has no score.
Score = 100*d/(d+h), where d is nonnegative signed minimum distance to the floor-contact convex hull, h is CoM height. Floor footprints are clipped to the pallet. Outside/edge yields zero. Invalid mass/geometry/no floor contacts yields no score. Geometric index assumes a coherent rigid assembly, so local box support, material/load and friction checks remain separate. Not a collapse probability or a certification.
## Verification
Build passed. 20 tests passed across CoM assessment (7), shell/solver equivalence (1), original robot trajectories (5), stream restart settings (4), and independent pallet return (3).
Actual browser: run/pause, live score update, P02 focus links score and camera, reset clears all four scores. Empty and loaded states inspected.
Existing source hash changes: src/pallet/relay/FlowLab.tsx, src/pallet/relay/RelayScene.tsx, src/pallet/relay/twin.css, src/pallet/relay/twinSceneTheme.ts, src/pallet/RobotArmView.ts. 143 other source files unchanged.
UI uses existing graphite tokens, flat separators and 3D-first grid. Added compact score strip, support hull diagram and four measured metrics. Existing packing analysis remains. Per-robot status remains accessible through the monitor disclosure.

## Public delivery
Published version 18: https://pallet-loading-lab.eon3602.chatgpt.site/?palletDemo=compact&palletView=relay&v=18#pallet
Source commit: 94cbfce11ef4f9b2d67940a8c5de665de7b427b0
Deployment: appgdep_6ac8733b55bc819188146a31ac66a042 (succeeded)
320/375/414/768px reviewed: no root or visible-control horizontal overflow. 375px phone and 768px tablet screenshots inspected. 1920x1080 live/focus inspection passed. Public version displays Hyundai reference, CoM panel, current packing data, and starts continuous simulation.
The Sites helper pushed and verified the source commit but its Bash packager was unavailable on Windows. Packaged the exact pushed commit with git archive, then saved and deployed successfully.
Public end-to-end run reached COMPLETED at simulation time 1284.4s. Archive batches: R1 #1 23 boxes, R2 #1 27, R3 #1 21, R1 #2 7, R4 #1 18; total 96. Current-cell scores cleared after dispatch. No browser error logs. Restarted same inputs for a user-facing loaded dashboard screenshot.
