# visual.ts

The locked art direction as data: backdrop and light colours, terrain elevation
bands, slab strata, water and smoke tints, burn-stage colours and emissive
ramps, post-processing and camera constants. It exists so the Scene is a lookup
rather than a fresh aesthetic decision at every call site, and so the look can
be retuned in one place.

Imports no libraries. Consumed only by the Scene layer; the simulation modules
never read it.
