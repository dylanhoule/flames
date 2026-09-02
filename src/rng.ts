import type { Rng } from './types'

/**
 * mulberry32: a small, fast, seedable 32-bit PRNG.
 *
 * Every procedural system in this project takes an Rng as a parameter rather
 * than calling Math.random(), for two reasons: the Regenerate button must be
 * able to reproduce a world from its seed, and every module's tests must be
 * deterministic.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** Uniform integer in [0, n). */
export function int(rng: Rng, n: number): number {
  return Math.floor(rng() * n)
}

/** Pick one element uniformly. Throws on an empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: empty array')
  return items[int(rng, items.length)]!
}
