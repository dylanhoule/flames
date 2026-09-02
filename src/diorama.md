# diorama.ts

Builds the slab geometry that the whole art direction rests on: the terrain
surface, the cut sides showing their strata, and the base cap. Unlike a normal
terrain renderer, nothing here hides the footprint boundary; the finite edge is
the point, so the model reads as a museum piece on a table rather than a
landscape that happens to stop.

Each grid quad becomes two triangles, and every triangle carries one flat colour
picked from its own centroid height and its own steepness, so terraced cliff
walls read as exposed rock against the plateaus above and below. Geometry is
emitted non-indexed so facets stay hard under flat shading, and colour rides on
a vertex-colour attribute so none of this needs a texture.

On the sides, the base and stone courses sit at fixed absolute heights so they
stay level all the way round, while the topsoil above them thickens and thins
to follow the terrain and a thin grass rim tracks the silhouette exactly.
Letting every band follow the terrain would read as a stack of blankets rather
than as rock.

Imports:
- `three` for `BufferGeometry`, the vector and colour maths, and the float
  attribute types.
- `./types` for the `TerrainField` contract.
- `./visual` for the elevation-band palette, cliff colour and threshold, and
  the strata definitions.
