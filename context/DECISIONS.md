# Project Decisions

Living record of choices made during design discussion, and why. Update as decisions change; don't just append contradictions.

## Purpose

Resume/portfolio project. Priority is shipping a polished, complete, working demo fast, over demonstrating deep engine/graphics-from-scratch skill.

## Stack: web-native (React Three Fiber / three.js)

Considered Unity+WebGL, Godot+HTML5 export, and web-native. Chose web-native because:
- No C# on the resume, and Unity's WebGL export adds build friction (large bundle, slow load, no instant reload) that fights the "new to 3D, ship fast" priority.
- A browser link with zero install is the delivery target; three.js is already a webpage, no export step.
- Fits the existing React/JS-facing resume story better than an engine editor workflow.

## Scope: v1 is a small tight grove

~50-200 trees, camera orbits a single clearing/hillside, all visible at once. Deliberately not the larger forest patch (500-2000 trees) yet — instancing/LOD for that scale is a v2 concern once the core sim + rendering loop works. Scaling up later is more instances of the same system, not a rewrite.

## Fire spread model: simplified cellular automaton with real parameters

Not a literal implementation of Rothermel (1972) — too much math to implement and validate correctly for a v1 timeframe. Not a game-y distance+randomness approximation either — too weak a claim to "follows the laws of wildland fire."

Landed in between: a grid/graph of cells, each tree carries fuel load + moisture; spread probability and rate between neighboring cells is driven by real fuel-model constants, wind, and slope, loosely inspired by Rothermel's rate-of-spread model. Physically-motivated and explainable, tractable to build and tune.

Per AGENTS.md rule 2, once this model is actually implemented, its physics reference belongs in `context/learning/` (e.g. `context/learning/rate-of-spread-model.md`), precise enough to double-check against the real fuel-model literature.

## Wind: user-adjustable

Slider/compass control, fire visibly reacts live. Chosen over fixed wind for interactivity/impressiveness, accepting the extra UI and sim edge cases that come with it.

## Terrain: procedural elevation (Perlin/simplex heightmap)

Slope is a real fire-spread factor (fire runs faster uphill), and flat ground both drops that physics input and looks more like a diorama than a landscape. Trees get placed on the generated heightmap.

## Ignition: click a tree

Raycast from mouse to the nearest tree mesh, mark that cell as burning. No drag/paint interaction in v1.

## Aftermath: full burn progression

Each tree animates through visual stages as it burns: green -> burning -> charred skeleton, rather than an instant material swap. More asset/animation work than the minimal option, chosen deliberately for visual payoff.

## Camera: orbit controls

Standard mouse-drag-to-orbit, scroll-to-zoom, via drei's `OrbitControls`. No free-fly, no fixed cinematic-only mode.

## Fuel model: Anderson 13

Constants for fuel load/moisture come from the 1982 Anderson 13 standard fire behavior fuel models (forest grove maps to timber litter, models 8/9/10). Chosen over Scott & Burgan 40 for easier sourcing/verification at this scope.

## Tree placement: Poisson-disc sampling + slope/elevation exclusion

Even, natural spacing across the heightmap via Poisson-disc sampling; cells that are too steep or out of elevation range are excluded from placement.
