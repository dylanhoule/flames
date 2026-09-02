# terrain.ts

Generates the `TerrainField` the fire sim and Scene build on: a heightmap over a square
footprint centered on the origin (x, z each in `[-size/2, size/2]`), picked from one of
three seeded landform shapes (`peak`, `ridge-valley`, `rolling`), with steep faces
snapped into discrete terrace steps and gentle ground left as a continuous gradient.
`elevationAt` bilinear-samples the final heightmap and `slopeAt` takes its
central-difference gradient, so what the player sees and what the fire physics reads
are the same surface.

## Imports

- `simplex-noise` (`createNoise2D`) — the 2D coherent noise field the landform
  generators layer into fbm and ridged fbm. Seeded directly from the injected `Rng`
  rather than `Math.random`.
- `./types` (type-only: `Landform`, `Rng`, `Slope`, `TerrainField`, `Vec2`) — the frozen
  cross-module contract this file implements.
- `./rng` (`pick`, `range`) — draws the landform choice and generator parameters from
  the injected `Rng`, never the global generator.
