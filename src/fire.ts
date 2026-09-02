import type { FireSim, Forest, Rng, TerrainField, Wind } from './types'

export interface FireOptions {
  wind?: Wind
}

/**
 * STUB, owned by task T3. Do not implement here.
 * See the T3 brief: a pure Rothermel-inspired spread model,
 * R = R0 * (1 + phi_wind + phi_slope), no three.js and no React.
 */
export function createFireSim(
  _forest: Forest,
  _terrain: TerrainField,
  _rng: Rng,
  _opts: FireOptions = {},
): FireSim {
  throw new Error('createFireSim: not implemented (task T3)')
}
