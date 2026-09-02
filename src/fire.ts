import { BURNING, CHARRED, UNBURNED } from './types'
import type { FireSim, Forest, Rng, TerrainField, TreeCell, Wind } from './types'

export interface FireOptions {
  wind?: Wind
}

// --------------------------------------------------------------- tuning
//
// Full derivations and literature citations live in
// context/learning/rate-of-spread-model.md. This block is just the numbers.

/** Fuel load (kg/m^2) a cell's R0 is normalised against. Mid-range Anderson 9. */
const REFERENCE_FUEL_LOAD = 1.2

/**
 * Seconds for one cell to fully char (progress 0 -> 1) at REFERENCE_FUEL_LOAD.
 * Actual per-cell duration scales linearly with that cell's fuelLoad. Tuned
 * jointly with BASE_IGNITION_SECONDS and BACKING_FLOOR (below) so that even a
 * pure-backing edge (bracket clamped to BACKING_FLOOR) reliably ignites a
 * reference-fuel neighbour before the source cell finishes charring.
 */
const BASE_BURN_SECONDS = 7.5

/**
 * Seconds for a burning cell to ignite one adjacent unburned neighbour of
 * REFERENCE_FUEL_LOAD, under no wind, no slope, zero moisture. See
 * BASE_BURN_SECONDS: this and BACKING_FLOOR are tuned together.
 */
const BASE_IGNITION_SECONDS = 0.5
const R0_MAX = 1 / BASE_IGNITION_SECONDS

/** Per-edge ignition accumulator threshold. Arbitrary units; R integrates toward it. */
const EDGE_IGNITION_THRESHOLD = 1

/** phi_wind = WIND_COEFF * windSpeed(m/s) * alignment(-1..1). Tuned by feel. */
const WIND_COEFF = 0.28

/** phi_slope = SLOPE_COEFF * (rise / run) of the cell-to-neighbour segment. Tuned by feel. */
const SLOPE_COEFF = 3

/**
 * Floor on (1 + phi_wind + phi_slope). Real fires back into the wind and
 * downhill, slowly, rather than stopping dead: this is a backing-fire creep
 * rate, not "no wind effect." Without a floor, a strong-enough headwind or
 * downhill run drives the bracket to (or past) zero, which was both
 * physically wrong (a real backing fire still consumes fuel behind the
 * front) and a demo-breaking bug: once the bracket hit zero, every wind
 * speed beyond that point produced byte-identical outcomes (the slider did
 * nothing), and cells reachable only against the wind never charred at all.
 * Tuned by feel; kept well below 1 so the front is still clearly faster than
 * the backing edge.
 */
const BACKING_FLOOR = 0.3

/** +/- fraction of per-edge random spread-rate variation, for an organic-looking front. */
const EDGE_JITTER_MAGNITUDE = 0.15

const ZERO_WIND: Wind = { speed: 0, directionRad: 0 }

/**
 * Rothermel/Albini-form moisture damping coefficient. 1 at zero moisture,
 * monotonically decreasing, exactly 0 at the moisture of extinction.
 * See rate-of-spread-model.md for the citation and the monotonicity check.
 */
function moistureDamping(moistureContent: number, moistureOfExtinction: number): number {
  if (moistureOfExtinction <= 0 || moistureContent >= moistureOfExtinction) return 0
  const r = moistureContent / moistureOfExtinction
  const damping = 1 - 2.59 * r + 5.11 * r * r - 3.52 * r * r * r
  return damping < 0 ? 0 : damping > 1 ? 1 : damping
}

function edgeKey(fromId: number, toId: number): string {
  return `${fromId}->${toId}`
}

export function createFireSim(
  forest: Forest,
  _terrain: TerrainField,
  rng: Rng,
  opts: FireOptions = {},
): FireSim {
  const cellCount = forest.cells.reduce((max, c) => Math.max(max, c.id + 1), 0)
  const states = new Uint8Array(cellCount)
  const progress = new Float32Array(cellCount)
  const cellById = new Map<number, TreeCell>()
  for (const cell of forest.cells) cellById.set(cell.id, cell)

  // Per-directed-edge ignition-progress accumulator (dt-independent: it's a
  // running integral of R over time) and a fixed-at-construction jitter
  // multiplier for visual variety. Both keyed by "fromId->toId" since spread
  // rate is directional (wind/slope differ by direction of travel).
  //
  // Jitter is drawn in an edge order sorted by (fromId, toId) rather than in
  // forest.cells' array order: the array order is Forest-generator-defined
  // (e.g. Poisson placement order) and carries no physical meaning, so two
  // forests holding the identical cell/neighbour data in different array
  // orders must draw the same jitter per edge for the same seed. This is
  // also what makes the "shuffled cell order doesn't change the outcome"
  // regression test meaningful rather than accidentally sensitive to it.
  const edgeProgress = new Map<string, number>()
  const edgeJitter = new Map<string, number>()
  const edges: Array<[from: number, to: number]> = []
  for (const cell of forest.cells) {
    for (const neighborId of cell.neighbors) edges.push([cell.id, neighborId])
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (const [fromId, toId] of edges) {
    edgeJitter.set(edgeKey(fromId, toId), 1 + (rng() * 2 - 1) * EDGE_JITTER_MAGNITUDE)
  }

  const sim: FireSim = {
    states,
    progress,
    wind: opts.wind ?? ZERO_WIND,

    ignite(cellId: number): void {
      if (states[cellId] !== UNBURNED) return
      const cell = cellById.get(cellId)
      if (!cell) return
      states[cellId] = BURNING
      progress[cellId] = 0
    },

    tick(dt: number): void {
      // Double-buffered: every read in this pass sees start-of-tick state,
      // and all writes (progress, char transitions, edge accumulators, new
      // ignitions) are applied only after the whole sweep finishes. Without
      // this, a cell ignited earlier in forest.cells' iteration order gets
      // reached again later in the SAME tick (its state already flipped to
      // BURNING) and immediately advances and spreads again, so fire ran
      // faster toward higher cell ids within a single tick, a directional
      // bias tied to array/id order rather than physics.
      const newProgress = new Map<number, number>()
      const toChar: number[] = []
      const edgeUpdates: Array<[key: string, value: number]> = []
      const toIgnite = new Set<number>()

      for (const cell of forest.cells) {
        if (states[cell.id] !== BURNING) continue

        const burnDuration = BASE_BURN_SECONDS * (cell.fuelLoad / REFERENCE_FUEL_LOAD)
        const p = Math.min(1, progress[cell.id]! + dt / burnDuration)
        newProgress.set(cell.id, p)
        if (p >= 1) {
          toChar.push(cell.id)
          continue
        }

        for (const neighborId of cell.neighbors) {
          if (states[neighborId] !== UNBURNED) continue
          const neighbor = cellById.get(neighborId)
          if (!neighbor) continue

          const rate = spreadRate(cell, neighbor, sim.wind)
          if (rate <= 0) continue

          const key = edgeKey(cell.id, neighborId)
          const jitter = edgeJitter.get(key) ?? 1
          const next = (edgeProgress.get(key) ?? 0) + rate * jitter * dt
          if (next >= EDGE_IGNITION_THRESHOLD) {
            toIgnite.add(neighborId)
          } else {
            edgeUpdates.push([key, next])
          }
        }
      }

      for (const [id, p] of newProgress) progress[id] = p
      for (const id of toChar) states[id] = CHARRED
      for (const [key, value] of edgeUpdates) edgeProgress.set(key, value)
      for (const id of toIgnite) sim.ignite(id)
    },

    isSettled(): boolean {
      return states.indexOf(BURNING) === -1
    },
  }

  return sim
}

/**
 * R = R0 * max(BACKING_FLOOR, 1 + phi_wind + phi_slope). See
 * rate-of-spread-model.md for the full write-up.
 */
function spreadRate(from: TreeCell, to: TreeCell, wind: Wind): number {
  // Receiving-cell gate: fuel at or above its own moisture of extinction
  // will not carry a spreading flame, full stop, regardless of how hot or
  // well-aligned the source is. This is independent of and in addition to
  // the source-side check below (from.moistureDamping already zeroes R0 for
  // a source cell at its own extinction moisture).
  if (to.moistureContent >= to.moistureOfExtinction) return 0

  const dx = to.position[0] - from.position[0]
  const dy = to.position[1] - from.position[1]
  const dz = to.position[2] - from.position[2]
  const horizDist = Math.hypot(dx, dz)
  if (horizDist === 0) return 0

  const dirX = dx / horizDist
  const dirZ = dz / horizDist

  const r0 =
    R0_MAX *
    (from.fuelLoad / REFERENCE_FUEL_LOAD) *
    moistureDamping(from.moistureContent, from.moistureOfExtinction)
  if (r0 <= 0) return 0

  const windDirX = Math.cos(wind.directionRad)
  const windDirZ = Math.sin(wind.directionRad)
  const alignment = dirX * windDirX + dirZ * windDirZ
  const phiWind = WIND_COEFF * wind.speed * alignment

  const slopeRatio = dy / horizDist
  const phiSlope = SLOPE_COEFF * slopeRatio

  return r0 * Math.max(BACKING_FLOOR, 1 + phiWind + phiSlope)
}
