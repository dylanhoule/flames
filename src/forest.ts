import { createNoise2D } from 'simplex-noise'
import { int, range } from './rng'
import type { Forest, FuelModel, Rng, Species, TerrainField, TreeCell } from './types'

export interface ForestOptions {
  /** Poisson-disc minimum spacing between tree centres, world units. */
  minDistance?: number
  /** Cells within this radius of each other are graph neighbours. */
  neighborRadius?: number
  /** Reject placement where slopeAt(...).magnitude exceeds this. */
  maxSlope?: number
  /**
   * Reject placement at or below waterLevel + shoreMargin. Defaults to a
   * fraction of the terrain's relief (see SHORE_MARGIN_RELIEF_FRACTION)
   * rather than a fixed number; pass this to override with an absolute
   * elevation margin instead.
   */
  shoreMargin?: number
  /** Reject placement outside this elevation band. */
  minElevation?: number
  maxElevation?: number
  /** Stop placing once this many trees have been accepted (soft cap: fewer is fine). */
  targetCount?: number
  /**
   * Spatial frequency of the fuel-model clump noise (cycles per world unit).
   * Defaults to a few cycles across the terrain footprint so stands read as
   * readable patches rather than salt-and-pepper noise.
   */
  fuelClumpFrequency?: number
}

const DEFAULTS: Required<ForestOptions> = {
  minDistance: 4,
  neighborRadius: 9,
  maxSlope: 0.6,
  shoreMargin: NaN, // NaN is the "unset" sentinel; resolved from terrain relief below
  minElevation: -Infinity,
  maxElevation: Infinity,
  targetCount: 150,
  fuelClumpFrequency: NaN, // NaN is the "unset" sentinel; resolved from terrain.size below
}

/**
 * Published Anderson 13 (1982) timber-litter constants, converted to kg/m^2.
 * See context/learning/anderson-13-fuel-models.md for sourcing and the
 * tons/acre -> kg/m^2 arithmetic. fuelLoad here is the summed dead 1-hr +
 * 10-hr + 100-hr load (live load, present only in model 10, is intentionally
 * excluded: TreeCell has a single moistureContent field and live fuel runs
 * at a very different moisture regime than dead litter).
 */
const FUEL_MODELS: Record<FuelModel, { species: Species; fuelLoad: number; moistureOfExtinction: number }> = {
  8: { species: 'conifer', fuelLoad: 1.121, moistureOfExtinction: 0.3 },
  9: { species: 'hardwood', fuelLoad: 0.78, moistureOfExtinction: 0.25 },
  10: { species: 'conifer', fuelLoad: 2.242, moistureOfExtinction: 0.25 },
}

/**
 * Half-width, in noise units, of the FM9 (hardwood) band around zero used
 * when thresholding the clump noise below. 2D simplex noise is NOT uniform
 * on [-1, 1]: it is bell-shaped and concentrated near zero, so a naive +/-1/3
 * split over-selects the middle band. Empirically calibrated (25 seeds x 150
 * samples each, matching this module's actual sampling frequency) so the
 * grove comes out conifer-dominant per the art direction: ~70% conifer
 * (models 8 + 10 combined) / ~30% hardwood (model 9), inside the requested
 * 65-75% / 25-35% band. See forest.test.ts for the regression check.
 */
const HARDWOOD_BAND_HALF_WIDTH = 0.21

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * shoreMargin is an ELEVATION offset, so a fixed number is wrong: on a
 * ~32-unit-relief peak, 1.5 units of height is a thin shoreline strip; on a
 * ~4.5-unit-relief rolling landform, the same 1.5 units is a third of the
 * entire height range and sweeps out most of the plantable footprint. The
 * default instead takes this fraction of the terrain's actual relief
 * (heightmap max - min), calibrated so ~30-unit relief reproduces roughly
 * the old fixed 1.5-unit margin (30 * 0.05 = 1.5). Callers who want a fixed
 * elevation margin regardless of terrain can still pass shoreMargin explicitly.
 */
const SHORE_MARGIN_RELIEF_FRACTION = 0.05

function terrainRelief(terrain: TerrainField): number {
  let min = Infinity
  let max = -Infinity
  for (const h of terrain.heightmap) {
    if (h < min) min = h
    if (h > max) max = h
  }
  return max - min
}

/**
 * Hand-rolled Bridson Poisson-disc sampling over an axis-aligned rectangle.
 * See context/learning/poisson-disc-sampling.md for the algorithm.
 *
 * `accept` is an extra per-candidate predicate (slope/elevation/water here);
 * the spacing grid only enforces minDist between accepted points.
 */
function poissonDiscSample(
  rng: Rng,
  originX: number,
  originZ: number,
  width: number,
  height: number,
  minDist: number,
  maxCount: number,
  accept: (x: number, z: number) => boolean,
  k = 30,
): Array<[number, number]> {
  const cellSize = minDist / Math.SQRT2
  const gridW = Math.max(1, Math.ceil(width / cellSize))
  const gridH = Math.max(1, Math.ceil(height / cellSize))
  const grid = new Int32Array(gridW * gridH).fill(-1)
  const points: Array<[number, number]> = []
  const active: number[] = []

  const cellOf = (x: number, z: number) => [
    Math.floor((x - originX) / cellSize),
    Math.floor((z - originZ) / cellSize),
  ] as const

  const farEnough = (x: number, z: number) => {
    const [gx, gz] = cellOf(x, z)
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx
        const nz = gz + dz
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridH) continue
        const idx = grid[nz * gridW + nx]!
        if (idx < 0) continue
        const [px, pz] = points[idx]!
        const ddx = px - x
        const ddz = pz - z
        if (ddx * ddx + ddz * ddz < minDist * minDist) return false
      }
    }
    return true
  }

  const place = (x: number, z: number) => {
    const idx = points.length
    points.push([x, z])
    active.push(idx)
    const [gx, gz] = cellOf(x, z)
    grid[gz * gridW + gx] = idx
  }

  // Rejection-sample a single new seed point anywhere in the footprint that
  // clears `accept` and (once other points exist) the spacing check. Used
  // both for the very first point and to restart in a fresh region once the
  // active list drains: a single seed can only ever grow through *connected*
  // plantable ground, so when slope/elevation/water rejection fragments the
  // footprint into separate islands, reseeding is what reaches the others.
  const trySeed = (): boolean => {
    const x = range(rng, originX, originX + width)
    const z = range(rng, originZ, originZ + height)
    if (!accept(x, z) || !farEnough(x, z)) return false
    place(x, z)
    return true
  }

  // ponytail: flat rejection-sample budget shared by the initial seed and
  // every later island reseed, bounded so a genuinely full/exhausted domain
  // fails fast instead of spinning. 500 is generous for finding a modestly
  // sized disconnected region; raise it if future terrain gets far patchier.
  const SEED_BUDGET = 500
  let seedTries = 0

  while (points.length < maxCount) {
    if (active.length === 0) {
      if (seedTries >= SEED_BUDGET) break
      seedTries++
      trySeed()
      continue
    }

    const activeSlot = int(rng, active.length)
    const [ax, az] = points[active[activeSlot]!]!
    let placed = false
    for (let i = 0; i < k; i++) {
      const angle = range(rng, 0, Math.PI * 2)
      const radius = range(rng, minDist, 2 * minDist)
      const x = ax + Math.cos(angle) * radius
      const z = az + Math.sin(angle) * radius
      if (x < originX || x > originX + width || z < originZ || z > originZ + height) continue
      if (!farEnough(x, z) || !accept(x, z)) continue
      place(x, z)
      placed = true
      break
    }
    if (!placed) {
      active[activeSlot] = active[active.length - 1]!
      active.pop()
    }
  }

  return points
}

/** True if the straight segment between the two points dips at or below waterLevel anywhere. */
function crossesWater(terrain: TerrainField, x1: number, z1: number, x2: number, z2: number): boolean {
  const samples = 9
  for (let s = 0; s <= samples; s++) {
    const t = s / samples
    const elevation = terrain.elevationAt(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)
    if (elevation <= terrain.waterLevel) return true
  }
  return false
}

function linkNeighbors(cells: TreeCell[], terrain: TerrainField, radius: number): void {
  const r2 = radius * radius
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i]!
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j]!
      const dx = a.position[0] - b.position[0]
      const dz = a.position[2] - b.position[2]
      if (dx * dx + dz * dz > r2) continue
      if (crossesWater(terrain, a.position[0], a.position[2], b.position[0], b.position[2])) continue
      a.neighbors.push(b.id)
      b.neighbors.push(a.id)
    }
  }
}

/**
 * Generates a grove of 50-200 trees: Bridson Poisson-disc placement over the
 * terrain footprint, Anderson 13 timber-litter fuel models assigned in
 * spatial clumps via low-frequency noise, and a neighbour graph that treats
 * water as a firebreak. See src/forest.md for the summary and
 * context/learning/ for the algorithm and fuel-model references.
 */
export function generateForest(terrain: TerrainField, rng: Rng, opts: ForestOptions = {}): Forest {
  const o = { ...DEFAULTS, ...opts }
  const half = terrain.size / 2
  const shoreMargin = Number.isNaN(o.shoreMargin)
    ? terrainRelief(terrain) * SHORE_MARGIN_RELIEF_FRACTION
    : o.shoreMargin

  const accept = (x: number, z: number): boolean => {
    const elevation = terrain.elevationAt(x, z)
    if (elevation <= terrain.waterLevel + shoreMargin) return false
    if (elevation < o.minElevation || elevation > o.maxElevation) return false
    if (terrain.slopeAt(x, z).magnitude > o.maxSlope) return false
    return true
  }

  const points = poissonDiscSample(rng, -half, -half, terrain.size, terrain.size, o.minDistance, o.targetCount, accept)

  // eslint-disable-next-line no-console
  console.log(`generateForest: placed ${points.length}/${o.targetCount} trees`)

  const freq = Number.isNaN(o.fuelClumpFrequency) ? 1.2 / terrain.size : o.fuelClumpFrequency
  const clumpNoise = createNoise2D(rng)

  const cells: TreeCell[] = points.map(([x, z], id) => {
    const n = clumpNoise(x * freq, z * freq) // [-1, 1], low frequency -> spatially clumped
    const fuelModel: FuelModel =
      n < -HARDWOOD_BAND_HALF_WIDTH ? 8 : n < HARDWOOD_BAND_HALF_WIDTH ? 9 : 10
    const model = FUEL_MODELS[fuelModel]

    const fuelLoad = model.fuelLoad * range(rng, 0.85, 1.15)
    // Anderson 13 publishes moisture of EXTINCTION, not a nominal moisture
    // content (that's a weather input, not a fuel-model constant). Baseline
    // moisture content here is a project default set well below Mx so cells
    // stay flammable, not a literature value; see the learning doc.
    const baseline = model.moistureOfExtinction * 0.3
    const moistureContent = clamp(baseline + range(rng, -0.03, 0.03), 0.01, model.moistureOfExtinction * 0.9)

    return {
      id,
      position: [x, terrain.elevationAt(x, z), z],
      fuelModel,
      species: model.species,
      fuelLoad,
      moistureContent,
      moistureOfExtinction: model.moistureOfExtinction,
      neighbors: [],
    }
  })

  linkNeighbors(cells, terrain, o.neighborRadius)

  return { cells }
}
