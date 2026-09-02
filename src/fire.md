# fire.ts

`createFireSim` runs the fire-spread simulation over a `Forest`'s cell graph:
per-cell burn progress (UNBURNED -> BURNING -> CHARRED) and, while a cell is
burning, a Rothermel-inspired spread rate to each unburned neighbour that
factors in fuel load, moisture, wind alignment, and slope. Pure state machine
over plain arrays, no rendering concepts.

Imports only `./types` (the frozen cross-module contract, for `Forest`,
`TerrainField`, `Rng`, `FireSim`, `Wind`, `TreeCell` and the state constants).

See `context/learning/rate-of-spread-model.md` for the formulas, the chosen
coefficients, and which parts are literature-derived versus tuned for the
demo.
