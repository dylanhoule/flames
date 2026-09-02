import type { Forest, Rng, TerrainField } from './types'
import { range } from './rng'

/**
 * Decorative ground scatter: boulders and fallen logs.
 *
 * Purely visual. These carry no fuel load and take no part in the simulation;
 * they exist so bare plateaus and the ground between stands do not read as
 * empty. Placement deliberately reuses the terrain's own slope and water
 * queries so props obey the same ground rules the trees do.
 */

export type PropKind = 'boulder' | 'log'

export interface ScatterProp {
  kind: PropKind
  /** World position: x, elevation, z. */
  position: readonly [x: number, y: number, z: number]
  /** Uniform-ish size multiplier. */
  scale: number
  /** Rotation about Y, radians. */
  spin: number
  /** Small lean, radians, so nothing sits perfectly upright. */
  tilt: number
}

export interface ScatterOptions {
  /** Spacing of the candidate grid, world units. */
  step?: number
  /** Reject where slopeAt(...).magnitude exceeds this. */
  maxSlope?: number
  /** Reject within this distance of a tree, so props do not intersect trunks. */
  treeClearance?: number
  /** Reject at or below waterLevel plus this margin. */
  shoreMargin?: number
  /** Fraction of accepted candidates that actually get a prop. */
  density?: number
}

const DEFAULTS: Required<ScatterOptions> = {
  step: 7,
  maxSlope: 0.75,
  treeClearance: 2.6,
  shoreMargin: 0.5,
  density: 0.45,
}

/**
 * Jittered-grid sampling rather than Poisson-disc: props only need to look
 * scattered, not to guarantee a minimum spacing, and the grid gives even
 * coverage across the whole slab for a fraction of the work.
 */
export function generateScatter(
  terrain: TerrainField,
  forest: Forest,
  rng: Rng,
  opts: ScatterOptions = {},
): ScatterProp[] {
  const o = { ...DEFAULTS, ...opts }
  const half = terrain.size / 2
  const clearanceSq = o.treeClearance * o.treeClearance
  const props: ScatterProp[] = []

  for (let gz = -half; gz < half; gz += o.step) {
    for (let gx = -half; gx < half; gx += o.step) {
      // Draw jitter for every cell so the sequence does not depend on which
      // candidates happen to be accepted; that keeps a seed reproducible.
      const x = gx + range(rng, 0, o.step)
      const z = gz + range(rng, 0, o.step)
      const roll = rng()
      const kindRoll = rng()
      const scale = range(rng, 0.6, 1.5)
      const spin = range(rng, 0, Math.PI * 2)
      const tilt = range(rng, -0.25, 0.25)

      if (roll > o.density) continue
      if (x < -half || x > half || z < -half || z > half) continue

      const elevation = terrain.elevationAt(x, z)
      if (elevation <= terrain.waterLevel + o.shoreMargin) continue
      if (terrain.slopeAt(x, z).magnitude > o.maxSlope) continue

      let tooClose = false
      for (const cell of forest.cells) {
        const dx = cell.position[0] - x
        const dz = cell.position[2] - z
        if (dx * dx + dz * dz < clearanceSq) { tooClose = true; break }
      }
      if (tooClose) continue

      props.push({
        kind: kindRoll < 0.72 ? 'boulder' : 'log',
        position: [x, elevation, z],
        scale,
        spin,
        tilt,
      })
    }
  }

  return props
}
