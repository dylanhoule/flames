import { describe, it, expect } from 'vitest'
import { mulberry32 } from './rng'
import { generateTerrain, fieldFromHeightmap } from './terrain'
import type { Landform, TerrainField } from './types'

/** Mean slopeAt().magnitude over an evenly-spaced sample grid. */
function meanSlope(field: TerrainField): number {
  const half = field.size / 2
  const samples = 24
  let sum = 0
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const x = -half + (i / (samples - 1)) * field.size
      const z = -half + (j / (samples - 1)) * field.size
      sum += field.slopeAt(x, z).magnitude
    }
  }
  return sum / (samples * samples)
}

/** Fraction of cells that share an exact elevation with a grid neighbor: the terraced-plateau signature. */
function terracedFraction(field: TerrainField): number {
  const res = field.resolution
  const hm = field.heightmap
  let terraced = 0
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const v = hm[j * res + i]!
      const left = i > 0 ? hm[j * res + i - 1] : undefined
      const right = i < res - 1 ? hm[j * res + i + 1] : undefined
      const up = j > 0 ? hm[(j - 1) * res + i] : undefined
      const down = j < res - 1 ? hm[(j + 1) * res + i] : undefined
      if (v === left || v === right || v === up || v === down) terraced++
    }
  }
  return terraced / hm.length
}

describe('slopeAt', () => {
  it('matches the analytic slope of a synthetic linear ramp', () => {
    // h(i, j) = 2 * i, constant in z: a uniform ramp rising in +x at rise/run = 2.
    const resolution = 5
    const size = 4 // cellSize = 1
    const heightmap = new Float32Array(resolution * resolution)
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        heightmap[j * resolution + i] = 2 * i
      }
    }
    const field = fieldFromHeightmap(size, resolution, heightmap, 'rolling', 0)

    const { magnitude, direction } = field.slopeAt(0, 0)
    expect(magnitude).toBeCloseTo(2, 6)
    // Height increases with +x, so downhill is -x.
    expect(direction[0]).toBeCloseTo(-1, 6)
    expect(direction[1]).toBeCloseTo(0, 6)
  })

  it('returns a zero vector on flat ground', () => {
    const resolution = 5
    const size = 4
    const heightmap = new Float32Array(resolution * resolution).fill(7)
    const field = fieldFromHeightmap(size, resolution, heightmap, 'rolling', 0)
    const { magnitude, direction } = field.slopeAt(0, 0)
    expect(magnitude).toBe(0)
    expect(direction[0]).toBe(0)
    expect(direction[1]).toBe(0)
  })
})

describe('elevationAt', () => {
  it('matches the stored heightmap value at exact grid coordinates', () => {
    const rng = mulberry32(1)
    const field = generateTerrain(rng, { resolution: 33 })
    const half = field.size / 2
    const cellSize = field.size / (field.resolution - 1)
    for (const [i, j] of [
      [0, 0],
      [10, 5],
      [32, 32],
      [16, 16],
    ]) {
      const x = -half + i! * cellSize
      const z = -half + j! * cellSize
      const expected = field.heightmap[j! * field.resolution + i!]!
      expect(field.elevationAt(x, z)).toBeCloseTo(expected, 5)
    }
  })
})

describe('generateTerrain determinism', () => {
  it('reproduces a byte-identical heightmap and landform for the same seed', () => {
    const a = generateTerrain(mulberry32(42), { resolution: 33 })
    const b = generateTerrain(mulberry32(42), { resolution: 33 })
    expect(a.landform).toBe(b.landform)
    expect(Array.from(a.heightmap)).toEqual(Array.from(b.heightmap))
  })
})

describe('landform selection', () => {
  it('produces all three landforms across many seeds', () => {
    const seen = new Set<Landform>()
    for (let seed = 0; seed < 60; seed++) {
      const field = generateTerrain(mulberry32(seed), { resolution: 17 })
      seen.add(field.landform)
    }
    expect(seen).toEqual(new Set<Landform>(['peak', 'ridge-valley', 'rolling']))
  })
})

describe('terracing', () => {
  it('produces flat runs on steep faces while gentle ground stays continuous', () => {
    const field = generateTerrain(mulberry32(42), { resolution: 65 })
    const res = field.resolution
    const hm = field.heightmap

    let maxRun = 1
    let varyingNeighbors = 0
    for (let j = 0; j < res; j++) {
      let run = 1
      for (let i = 1; i < res; i++) {
        const a = hm[j * res + i - 1]!
        const b = hm[j * res + i]!
        if (a === b) {
          run++
          if (run > maxRun) maxRun = run
        } else {
          run = 1
          varyingNeighbors++
        }
      }
    }

    expect(maxRun).toBeGreaterThanOrEqual(3)
    expect(varyingNeighbors).toBeGreaterThan(0)
  })
})

describe('landform relief', () => {
  it('keeps rolling gentler than peak and mostly untraced (regression: rolling used to be the steepest)', () => {
    const rollingSlopes: number[] = []
    const peakSlopes: number[] = []
    const rollingTerraced: number[] = []
    for (let seed = 0; seed < 40; seed++) {
      const field = generateTerrain(mulberry32(seed), { resolution: 65 })
      if (field.landform === 'rolling') {
        rollingSlopes.push(meanSlope(field))
        rollingTerraced.push(terracedFraction(field))
      } else if (field.landform === 'peak') {
        peakSlopes.push(meanSlope(field))
      }
    }
    // Guard the spread itself: an empty sample would make the assertions below vacuous.
    expect(rollingSlopes.length).toBeGreaterThan(3)
    expect(peakSlopes.length).toBeGreaterThan(3)

    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(avg(rollingSlopes)).toBeLessThan(avg(peakSlopes))
    expect(avg(rollingTerraced)).toBeLessThan(0.25)
  })
})

describe('heightmap shape', () => {
  it('has resolution^2 finite entries and a water level', () => {
    const field = generateTerrain(mulberry32(7))
    expect(field.heightmap.length).toBe(field.resolution ** 2)
    for (const v of field.heightmap) {
      expect(Number.isFinite(v)).toBe(true)
    }
    expect(Number.isFinite(field.waterLevel)).toBe(true)
  })
})
