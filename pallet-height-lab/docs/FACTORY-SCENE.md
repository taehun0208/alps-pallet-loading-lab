# Factory environment

The four-arm relay scene now defaults to a cutaway factory interior: concrete slab, steel columns and truss, loading shutter, warehouse racks and cartons, perimeter fencing, pedestrian paint, and radial outfeed lanes. Physical pallet dimensions are retained; pallet platforms are rendered as wooden slats. Conveyor and robot supports extend to the factory floor.

FactoryEnvironment builds 443 repeated stationary parts in material-based InstancedMesh batches. The scene is rebuilt only when pallet width/depth changes, not on box placement updates. Resources and instance buffers are disposed when replaced. A 1024 shadow map and capped pixel ratio keep the addition bounded; no remote textures or models are loaded. Facility visibility, overview and close-up controls support analysis.

This is illustrative scenery, not additional collision obstacles for the planner. Existing robot/tool/box checks and batch infeed/outfeed logic are unchanged. Full plant layout and safety certification are not represented by these visual fences.

Validation: TypeScript + production build; 14 existing operation/relay tests; full 192-box browser run and history inspection; facility toggle; 320/375/414/768 px scene and single-line controls; browser console had no errors.
