import type { Forest, Rng, TerrainField } from './types'

export interface ForestOptions {
  minDistance?: number
  neighborRadius?: number
  maxSlope?: number
  shoreMargin?: number
}

/**
 * STUB, owned by task T2. Do not implement here.
 * See the T2 brief: Bridson Poisson-disc placement, Anderson 13 fuel models in
 * spatial clumps, and a neighbour graph whose links never cross water.
 */
export function generateForest(
  _terrain: TerrainField,
  _rng: Rng,
  _opts: ForestOptions = {},
): Forest {
  throw new Error('generateForest: not implemented (task T2)')
}
