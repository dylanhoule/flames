# Wildfire Grove Demo — v1 Design

Status: approved for implementation planning. See `context/DECISIONS.md` for the discussion history and rationale behind each choice below; this doc is the consolidated spec.

## Goal

A browser-playable, procedurally generated small forest grove. The camera orbits the scene; clicking a tree ignites it; fire spreads through the grove following a physically-motivated model (fuel, moisture, wind, slope); burned trees progress through a visual char sequence, leaving a burnt aftermath behind.

## Stack

React + React Three Fiber (three.js) + drei helpers. No game engine, no backend — a static site, deployable as a link. Fuel model constants drawn from Anderson 13 (1982 standard fire behavior fuel models).

## Architecture

Four modules, each independently understandable and testable:

1. **Terrain** — generates the heightmap and exposes elevation/slope lookups.
2. **Forest** — places trees on the terrain and holds each tree's static fuel/moisture properties.
3. **Fire sim** — pure simulation state machine over the forest's cells; no rendering knowledge.
4. **Scene** — React Three Fiber components that read terrain + forest + sim state and render them, plus the wind control UI.

Data flows one direction: Terrain → Forest → Fire sim → Scene. The Scene never mutates sim state directly except via the ignition action (click → sim.ignite(cellId)); everything else is the sim ticking forward and the Scene reading the result.

### Terrain

- Simplex noise heightmap over a fixed-size grid (e.g. 100x100 units).
- Exposes `elevationAt(x, z)` and `slopeAt(x, z)` (gradient magnitude + direction), used by both tree placement and the fire sim.

### Forest

- Poisson-disc sampling across the heightmap footprint, target ~50-200 points.
- Reject points where `slopeAt` exceeds a max-walkable-slope threshold, or elevation is outside a min/max band (e.g. no trees at the very peak or in a low "water" band).
- Each accepted point becomes a tree cell: `{ id, position, fuelLoad, moistureContent }`, with fuel/moisture drawn from the Anderson 13 timber-litter model (models 8/9/10) plus small random jitter so the grove isn't perfectly uniform.
- Neighbor graph: cells within a fixed radius of each other are linked, used by the fire sim for spread.

### Fire sim

- Pure state module (no three.js/React dependency), so it can be unit tested and physics-verified in isolation.
- Per-cell state: `unburned | burning | charred`, plus a burn-progress value (0→1) driving the visual stage.
- Global input: wind vector (direction + speed), settable live from the UI.
- Tick function: for each `burning` cell, compute spread probability/rate to each `unburned` neighbor as a function of:
  - fuel load and moisture (Anderson 13 constants),
  - wind alignment between the cell-to-neighbor direction and the wind vector,
  - slope between the two cells (uphill spread bias),
  loosely modeled on Rothermel's rate-of-spread relationship (not a literal implementation — see `context/learning/rate-of-spread-model.md`, created when this module is built, per AGENTS.md rule 2).
- `ignite(cellId)` sets a cell to `burning` at progress 0.
- A cell transitions `burning → charred` once its own burn-progress reaches 1 (duration derived from its fuel load).

### Scene

- R3F canvas with `OrbitControls` from drei.
- Terrain mesh built from the heightmap.
- Trees rendered as instanced meshes for draw-call efficiency, even at v1's small count — instancing is required either way once each tree needs a distinct burn-stage material, so building it once now avoids a rework at v2's larger scale.
- Per-frame (or per-tick), each tree instance's material/color is derived from its sim state: green (unburned) → burning (emissive orange, animated) → charred (dark, desaturated), interpolated by burn-progress for the transitions.
- Click handling: raycast from pointer to the tree instanced mesh, resolve to a cell id, call `sim.ignite(cellId)`.
- Wind control: a small HTML/React overlay (slider for speed, compass/dial for direction), outside the canvas, updating the sim's wind input.

## Data flow summary

```
Terrain (heightmap)
   -> Forest (Poisson-disc placement + fuel/moisture per cell, neighbor graph)
        -> Fire sim (tick loop: fuel + moisture + wind + slope -> spread)
             -> Scene (reads sim state each frame -> instance colors/materials)
Click (Scene) -> raycast -> cellId -> Fire sim.ignite(cellId)
Wind UI (Scene) -> Fire sim.wind
```

## Error handling / edge cases

- Poisson-disc sampling may produce fewer than the target tree count if slope/elevation exclusion is aggressive on a given noise seed — acceptable (not a hard minimum), but log the actual count so a bad seed is visible during development.
- Clicking empty space (no tree hit) is a no-op, not an error.
- Igniting an already-burning or already-charred cell is a no-op.
- Fire spread naturally halts when no `burning` cell has an `unburned` neighbor left to spread to (finite grove, no fuel regeneration in v1) — no explicit "fire out" state needed beyond that.

## Testing

- Fire sim: unit tests as pure functions — given a small fixed cell graph, known fuel/moisture/wind/slope inputs, assert expected spread direction bias (e.g. fire spreads faster downwind and uphill than upwind and downhill) and that state transitions (`unburned → burning → charred`) happen correctly over ticks. This is the module where correctness matters most since it's the physics claim of the project.
- Terrain/Forest: a runnable sanity check (per ponytail convention) — assert every placed tree's slope/elevation is within the configured bounds, and no two tree positions are closer than the Poisson-disc minimum distance.
- Scene: visual verification by running the app in-browser (no automated rendering tests planned for v1).

## Out of scope for v1

- Larger forest scale (500-2000 trees) / LOD.
- Fuel regeneration or multi-session persistence.
- Free-fly camera or fixed cinematic camera modes.
- Fire-line drag ignition.
- Scott & Burgan 40 fuel model.
