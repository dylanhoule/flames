# rng.ts

A seedable pseudo-random number generator (mulberry32) plus small helpers for
picking a number in a range, an integer, or an element of an array. Every
procedural system in the project takes one of these as a parameter instead of
calling `Math.random()`, so a world can be reproduced from its seed (the
Regenerate button) and so every module's tests are deterministic.

Imports no libraries. See `context/learning/seeded-prng.md` for how mulberry32
works and why it was chosen.
