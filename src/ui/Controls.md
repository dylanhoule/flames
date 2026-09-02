# Controls.tsx

The HTML overlay that sits outside the R3F canvas: a Regenerate button, wind
speed and direction sliders, a small SVG compass showing which way the wind is
blowing, and a readout of the current seed, landform and live burn counts.

Wind is the demo's main interactive lever, so it gets both a numeric speed and a
visible direction indicator rather than a bare slider. The compass arrow points
the way the wind blows, matching the `Wind.directionRad` convention in
`types.ts` (0 is +x, increasing toward +z).

Imports:
- `../types` for the `Wind` and `Landform` contract types.
React is provided by the JSX runtime rather than imported directly.
