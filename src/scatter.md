# scatter.ts

Places decorative ground props, boulders and fallen logs, across the terrain so
bare plateaus and the gaps between stands do not read as empty. Purely visual:
these carry no fuel load and take no part in the fire simulation.

Candidates come from a jittered grid rather than Poisson-disc sampling, because
props only need to look scattered rather than guarantee a minimum spacing, and
the grid covers the whole slab for a fraction of the work. Every candidate is
rejected if it falls at or below the water level, on ground steeper than the
threshold, or within the clearance radius of a tree, so props obey the same
ground rules the trees do and never intersect a trunk.

Jitter and roll values are drawn for every grid cell, including rejected ones,
so the random sequence does not depend on which candidates happen to be
accepted; that is what keeps a seed reproducible.

Imports:
- `./types` for the `TerrainField`, `Forest` and `Rng` contract types.
- `./rng` for the seeded `range` helper.
