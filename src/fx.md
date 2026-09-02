# fx.tsx

Fire effects: smoke columns and flame billboards. Both are single instanced
quads per element, oriented toward the camera in the vertex shader rather than
on the CPU, so the whole grove costs two draw calls however many cells are
alight.

Smoke matters more than the flames. It is the only element that makes the wind
control legible: plumes are advected along the wind vector, so changing
direction mid-burn visibly swings every column. It is deliberately restrained,
low opacity and short-lived, because at peak burn roughly 90 of 150 cells are
alight and a heavier setting buries the diorama entirely. Cells keep emitting
briefly after charring so the burn leaves a trailing haze.

The flames are additive, noise-shaded and scaled by burn progress, so they grow
in and die back. They are what stops the fire reading as merely glowing trees.

Imports:
- `react` for memo, ref and effect hooks.
- `@react-three/fiber` for `useFrame`, which drives both the smoke advection
  and the flame flicker uniform.
- `three` for the buffer geometries, shader materials and colours.
- `./types` for `Forest`, `FireSim`, `Wind` and the cell-state constants.
- `./visual` for the smoke and burn colour tokens.
