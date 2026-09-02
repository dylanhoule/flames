# App.tsx

The application shell. Owns the seed, the live wind vector and the generated
world (terrain, forest, fire sim), renders the `Scene` and the `Controls`
overlay, and forwards click-to-ignite into the simulation.

A single seeded rng is threaded through both generators so one seed fully
determines a world. Wind is deliberately not part of the world's memo
dependencies: changing it pushes onto the already-running sim rather than
rebuilding everything. Regenerate stays enabled at all times, including
mid-burn, and rebuilds terrain, forest and sim outright.

Imports:
- `react` for state, memo and effect hooks.
- `./Scene` and `./ui/Controls` for the canvas and the HTML overlay.
- `./terrain`, `./forest`, `./fire` for world generation and the simulation.
- `./rng` for the seeded generator, `./visual` for the backdrop, `./types` for
  the cell-state constants and the `Wind` type.
