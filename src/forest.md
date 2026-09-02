# forest.ts

Generates a grove of 50-200 trees over a given `TerrainField`: Bridson Poisson-disc
placement (rejecting cells that are too steep, out of elevation band, or too close to
water), Anderson 13 timber-litter fuel models (8/9/10) assigned in spatial clumps via
low-frequency noise, and a neighbour graph whose links never cross water, so lakes and
rivers act as firebreaks without the fire sim needing any geometry.

Imports:
- `simplex-noise` (`createNoise2D`) - low-frequency 2D noise field used to assign fuel
  models in spatially clustered stands rather than independently per tree. Seeded with
  the injected `Rng`, never `Math.random()`.
- `./rng` (`range`, `int`) - bounded random draws from the injected `Rng`, for the
  Poisson-disc annulus sampling and jitter on fuel load/moisture.
- `./types` (types only) - `Forest`, `FuelModel`, `Rng`, `Species`, `TerrainField`,
  `TreeCell`, the frozen cross-module contract.
