import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'
import type { Landform, Rng, Slope, TerrainField, Vec2 } from './types'
import { pick, range } from './rng'

export interface TerrainOptions {
  size?: number
  resolution?: number
}

const LANDFORMS: readonly Landform[] = ['peak', 'ridge-valley', 'rolling']

/** Fraction of the final height range treated as water, roughly the 15th percentile. */
const WATER_PERCENTILE = 0.15

/**
 * Relief (max - min elevation) per landform, as a fraction of the footprint size.
 * Not a single shared value: rolling fbm oscillates many times across the footprint,
 * so stretching it to the same relief as one dominant peak makes every small hill
 * absurdly steep and terraces almost the whole map. Each archetype gets its own
 * scale instead, tallest to shallowest, so Regenerate reads as a different world.
 */
const PEAK_HEIGHT_FRACTION = 0.32
const RIDGE_VALLEY_HEIGHT_FRACTION = 0.22
const ROLLING_HEIGHT_FRACTION = 0.07

const HEIGHT_FRACTION: Record<Landform, number> = {
  peak: PEAK_HEIGHT_FRACTION,
  'ridge-valley': RIDGE_VALLEY_HEIGHT_FRACTION,
  rolling: ROLLING_HEIGHT_FRACTION,
}

/** Slope (rise/run) at which terracing starts to bite. */
const TERRACE_SLOPE_THRESHOLD = 0.6

/**
 * Slope at which a vertex snaps all the way onto its step. Between the two the
 * snap is blended in, because a binary test at 0.6 terraced whole landforms
 * rather than their cliff faces: a peak's flank clears 0.6 over 22% of the map
 * but almost never reaches 1.8, so the entire cone came out as a ziggurat, and
 * the quantised treads broke the elevation bands into speckle. A ridge-valley
 * still puts ~6% of its vertices above 1.8, so real cliff bands survive.
 */
const TERRACE_CLIFF_SLOPE = 1.8

/** Number of discrete elevation steps spanning the full height range. */
const TERRACE_LEVELS = 9

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Multi-octave fbm. Returns a value in roughly [-1, 1]. */
function fbm(
  noise2D: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * noise2D(x * frequency, z * frequency)
    norm += amplitude
    amplitude *= persistence
    frequency *= lacunarity
  }
  return sum / norm
}

/** Ridged fbm: 1 - |noise| per octave, so ridges sit at noise zero-crossings. Returns [0, 1]. */
function ridgedFbm(
  noise2D: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * (1 - Math.abs(noise2D(x * frequency, z * frequency)))
    norm += amplitude
    amplitude *= persistence
    frequency *= lacunarity
  }
  return sum / norm
}

/**
 * Slope of the seabed beyond the cone's base, per unit of normalised distance.
 * Clamping the falloff at zero instead left a dead-flat floor over ~18% of the
 * map; WATER_PERCENTILE then landed inside that tie block, so the water plane
 * came out exactly coplanar with the ground (z-fighting stripes) and the sea
 * had no depth for the sand band to sit above.
 */
const PEAK_SEABED_SLOPE = 0.5

/** Radial falloff from a seeded center, fbm-detailed. One dominant mountain. */
function heightPeak(rng: Rng, noise2D: NoiseFunction2D, half: number, size: number) {
  const cx = range(rng, -0.3, 0.3) * half
  const cz = range(rng, -0.3, 0.3) * half
  const power = range(rng, 1.4, 2.2)
  const detailFreq = range(rng, 3, 6) / size
  const detailStrength = 0.18
  return (x: number, z: number): number => {
    const dx = x - cx
    const dz = z - cz
    const dist = Math.sqrt(dx * dx + dz * dz) / (half * 1.1)
    const falloff = 1 - dist
    // Past the base the ground keeps descending, linearly so the seabed has a
    // constant grade rather than the tangentially-flat one a power curve gives.
    const shaped = falloff >= 0 ? Math.pow(falloff, power) : falloff * PEAK_SEABED_SLOPE
    const detail = fbm(noise2D, x * detailFreq, z * detailFreq, 4, 0.5, 2)
    return shaped + shaped * detail * detailStrength
  }
}

/** Ridged noise oriented along a seeded axis, with a valley envelope on one side. */
function heightRidgeValley(rng: Rng, noise2D: NoiseFunction2D, half: number, size: number) {
  const theta = range(rng, 0, Math.PI)
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  const freq = range(rng, 2, 4) / size
  return (x: number, z: number): number => {
    // rx runs along the ridge axis, rz is lateral distance from it.
    const rx = x * cosT + z * sinT
    const rz = -x * sinT + z * cosT
    const ridge = ridgedFbm(noise2D, rx * freq, rz * freq * 0.4, 5, 0.55, 2)
    const lateral = rz / half
    const valleyFactor = smoothstep(-0.05, 0.6, lateral)
    const envelope = 1 - 0.7 * valleyFactor
    return ridge * envelope
  }
}

/** Plain multi-octave fbm. Gentle varied hills. */
function heightRolling(rng: Rng, noise2D: NoiseFunction2D, size: number) {
  const freq = range(rng, 2.5, 5) / size
  return (x: number, z: number): number => {
    const n = fbm(noise2D, x * freq, z * freq, 5, 0.5, 2)
    return (n + 1) / 2
  }
}

/** Central-difference slope magnitude at a grid vertex, edges clamped to the nearest neighbor. */
function gridSlopeMagnitude(
  hm: Float32Array,
  resolution: number,
  cellSize: number,
  i: number,
  j: number,
): number {
  const i0 = Math.max(i - 1, 0)
  const i1 = Math.min(i + 1, resolution - 1)
  const j0 = Math.max(j - 1, 0)
  const j1 = Math.min(j + 1, resolution - 1)
  const dhdx = (hm[j * resolution + i1]! - hm[j * resolution + i0]!) / ((i1 - i0) * cellSize)
  const dhdz = (hm[j1 * resolution + i]! - hm[j0 * resolution + i]!) / ((j1 - j0) * cellSize)
  return Math.hypot(dhdx, dhdz)
}

/**
 * Builds the elevationAt/slopeAt closures over a finished heightmap. Split out from
 * generateTerrain so the sampling math can be exercised directly against a hand-built
 * synthetic heightmap in tests.
 */
export function fieldFromHeightmap(
  size: number,
  resolution: number,
  heightmap: Float32Array,
  landform: Landform,
  waterLevel: number,
): TerrainField {
  const half = size / 2
  const cellSize = size / (resolution - 1)

  function worldToGrid(x: number, z: number): [number, number] {
    return [clamp((x + half) / cellSize, 0, resolution - 1), clamp((z + half) / cellSize, 0, resolution - 1)]
  }

  function elevationAt(x: number, z: number): number {
    const [gx, gz] = worldToGrid(x, z)
    const x0 = Math.floor(gx)
    const x1 = Math.min(x0 + 1, resolution - 1)
    const z0 = Math.floor(gz)
    const z1 = Math.min(z0 + 1, resolution - 1)
    const tx = gx - x0
    const tz = gz - z0
    const h00 = heightmap[z0 * resolution + x0]!
    const h10 = heightmap[z0 * resolution + x1]!
    const h01 = heightmap[z1 * resolution + x0]!
    const h11 = heightmap[z1 * resolution + x1]!
    const h0 = h00 * (1 - tx) + h10 * tx
    const h1 = h01 * (1 - tx) + h11 * tx
    return h0 * (1 - tz) + h1 * tz
  }

  function slopeAt(x: number, z: number): Slope {
    const eps = cellSize
    const dhdx = (elevationAt(x + eps, z) - elevationAt(x - eps, z)) / (2 * eps)
    const dhdz = (elevationAt(x, z + eps) - elevationAt(x, z - eps)) / (2 * eps)
    const magnitude = Math.hypot(dhdx, dhdz)
    if (magnitude < 1e-9) return { magnitude: 0, direction: [0, 0] }
    const direction: Vec2 = [-dhdx / magnitude, -dhdz / magnitude]
    return { magnitude, direction }
  }

  return { size, resolution, landform, waterLevel, heightmap, elevationAt, slopeAt }
}

/**
 * Generates a terrain field. Footprint is centered on the origin: x and z each range
 * over [-size/2, size/2]. Row-major heightmap: index = j * resolution + i, i along x, j along z.
 */
export function generateTerrain(rng: Rng, opts: TerrainOptions = {}): TerrainField {
  const size = opts.size ?? 100
  const resolution = opts.resolution ?? 129
  const half = size / 2
  const cellSize = size / (resolution - 1)
  const n = resolution * resolution

  // The seed (via rng) picks the landform too, so Regenerate can change the world's
  // structure, not just reshuffle noise within one shape.
  const landform = pick(rng, LANDFORMS)
  const noise2D = createNoise2D(rng)

  const heightFn =
    landform === 'peak'
      ? heightPeak(rng, noise2D, half, size)
      : landform === 'ridge-valley'
        ? heightRidgeValley(rng, noise2D, half, size)
        : heightRolling(rng, noise2D, size)

  const raw = new Float32Array(n)
  let min = Infinity
  let max = -Infinity
  for (let j = 0; j < resolution; j++) {
    const z = -half + j * cellSize
    for (let i = 0; i < resolution; i++) {
      const x = -half + i * cellSize
      const h = heightFn(x, z)
      raw[j * resolution + i] = h
      if (h < min) min = h
      if (h > max) max = h
    }
  }

  const maxHeight = size * HEIGHT_FRACTION[landform]
  const span = Math.max(max - min, 1e-6)
  for (let k = 0; k < n; k++) {
    raw[k] = ((raw[k]! - min) / span) * maxHeight
  }

  // Hybrid terracing: cliff-steep vertices snap to discrete step levels (stacked cliff
  // bands), gentle vertices keep their continuous value (the fire sim's slope input stays
  // smooth there instead of becoming all-or-nothing), and the band between eases from one
  // to the other so a uniformly steep landform keeps its silhouette.
  const stepHeight = maxHeight / TERRACE_LEVELS
  const heightmap = new Float32Array(n)
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const idx = j * resolution + i
      const slope = gridSlopeMagnitude(raw, resolution, cellSize, i, j)
      const snapped = Math.round(raw[idx]! / stepHeight) * stepHeight
      const blend = smoothstep(TERRACE_SLOPE_THRESHOLD, TERRACE_CLIFF_SLOPE, slope)
      // Full snap stays a separate branch so a cliff tread is exactly flat:
      // lerping by 1.0 is not bit-identical to the step it is lerping toward.
      heightmap[idx] = blend >= 1 ? snapped : raw[idx]! + (snapped - raw[idx]!) * blend
    }
  }

  const sorted = Array.from(heightmap).sort((a, b) => a - b)
  const waterLevel = sorted[Math.floor(WATER_PERCENTILE * (n - 1))]!

  return fieldFromHeightmap(size, resolution, heightmap, landform, waterLevel)
}
