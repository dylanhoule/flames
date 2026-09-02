import type { Rng, TerrainField } from './types'

export interface TerrainOptions {
  size?: number
  resolution?: number
}

/**
 * STUB, owned by task T1. Do not implement here.
 * See the T1 brief: three seeded landform generators plus hybrid terracing.
 */
export function generateTerrain(_rng: Rng, _opts: TerrainOptions = {}): TerrainField {
  throw new Error('generateTerrain: not implemented (task T1)')
}
