# trees.ts

Builds the faceted low-poly tree geometry for the diorama: a tapered trunk plus
a canopy, per species. Conifer canopies are 4-6 cone tiers nudged and spun so
they clump rather than stacking into a regular pyramid; hardwood canopies are
3-5 squashed icosahedron blobs merged into one lumpy crown. Every geometry is
normalised to a unit height of 1.0 with its base at y = 0, so one per-instance
scale sizes any tree, and each canopy is merged into a single geometry so a
whole species draws in one instanced call.

Foliage and trunk are kept as separate geometries on purpose: as a tree burns
its canopy shrinks away while the trunk remains as a charred spire, which needs
the two to be scaled independently.

Imports:
- `three` for the primitive geometries (cone, cylinder, icosahedron) and the
  buffer-geometry maths.
- `three/addons/utils/BufferGeometryUtils.js` for `mergeGeometries`, which
  collapses the canopy parts into one buffer.
- `./types` for the `Species` and `Rng` contract types.
- `./rng` for the seeded `range` helper, so canopy variation is reproducible.
