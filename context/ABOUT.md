# About

A browser-playable 3D wildfire spread demo: a resume/portfolio project.

## Priority

Ship a polished, complete, working demo fast. This comes before demonstrating deep engine/graphics-from-scratch skill. See "Purpose" in `DECISIONS.md`.

## The experience

A procedurally generated small forest grove, rendered in 3D, camera orbitable. Clicking a tree ignites it; fire then spreads through the grove following a physically-motivated model (fuel, moisture, wind, slope). Burned trees progress through a visual char sequence (green -> burning -> charred skeleton), leaving a burnt aftermath behind. Wind is live-adjustable and the fire visibly reacts.

v1 is a small tight grove (~50-200 trees, one clearing/hillside, all visible at once), not the larger forest patch. See `ARCHITECTURE.md` for v1 scope and what's explicitly out of scope.

## Where to look next

- `ARCHITECTURE.md` — stack, modules, data flow, scope, testing.
- `DECISIONS.md` — the rationale log: what was chosen, what alternatives were considered, and why.
- `learning/` — one reference file per nontrivial library or math concept used in the code (e.g. the rate-of-spread model), created as that code is written. See the root `AGENTS.md` for the documentation rules this project follows.
