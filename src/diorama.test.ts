import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { buildDiorama, ScorchMap } from './diorama'
import { CLIFF_COLOR, SCORCH } from './visual'
import type { Slope, TerrainField } from './types'

/**
 * Synthetic TerrainField so this suite never depends on src/terrain.ts.
 * `height(u, v)` takes normalised grid coordinates in [0, 1].
 */
function fakeTerrain(
  height: (u: number, v: number) => number,
  resolution = 17,
  size = 100,
): TerrainField {
  const heightmap = new Float32Array(resolution * resolution)
  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      heightmap[iz * resolution + ix] = height(ix / (resolution - 1), iz / (resolution - 1))
    }
  }
  return {
    size,
    resolution,
    landform: 'rolling',
    waterLevel: -Infinity,
    heightmap,
    elevationAt: () => 0,
    slopeAt: (): Slope => ({ magnitude: 0, direction: [0, 0] }),
  }
}

function attr(geo: { getAttribute(n: string): { array: ArrayLike<number>; count: number } }, n: string) {
  return geo.getAttribute(n)
}

describe('diorama', () => {
  const flat = fakeTerrain(() => 5)

  it('emits two triangles per grid quad', () => {
    const { surface } = buildDiorama(flat)
    const quads = (flat.resolution - 1) ** 2
    expect(attr(surface, 'position').count).toBe(quads * 6)
  })

  it('keeps the surface inside the footprint', () => {
    const { surface } = buildDiorama(flat)
    const pos = attr(surface, 'position').array
    const half = flat.size / 2
    for (let i = 0; i < pos.length; i += 3) {
      expect(Math.abs(pos[i]!)).toBeLessThanOrEqual(half + 1e-6)
      expect(Math.abs(pos[i + 2]!)).toBeLessThanOrEqual(half + 1e-6)
    }
  })

  it('drops the slab below the lowest terrain point', () => {
    const bumpy = fakeTerrain((u, v) => 4 + 3 * Math.sin(u * 6) * Math.cos(v * 5))
    const { sides, bottomY } = buildDiorama(bumpy)
    const minTerrain = Math.min(...bumpy.heightmap)
    expect(bottomY).toBeLessThan(minTerrain)

    const pos = attr(sides, 'position').array
    let lowest = Infinity
    for (let i = 1; i < pos.length; i += 3) lowest = Math.min(lowest, pos[i]!)
    expect(lowest).toBeCloseTo(bottomY, 5)
  })

  it('produces only finite vertices and in-gamut colours', () => {
    const { surface, sides } = buildDiorama(
      fakeTerrain((u, v) => 10 * u + 4 * Math.sin(v * 9)),
    )
    for (const geo of [surface, sides]) {
      for (const name of ['position', 'color']) {
        const a = attr(geo, name).array
        expect(a.length).toBeGreaterThan(0)
        for (let i = 0; i < a.length; i++) {
          expect(Number.isFinite(a[i]!)).toBe(true)
          if (name === 'color') {
            expect(a[i]!).toBeGreaterThanOrEqual(0)
            expect(a[i]!).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('paints steep faces as cliff rock and flat ground as anything but', () => {
    const cliff = new Color(CLIFF_COLOR)
    const hasCliff = (t: TerrainField) => {
      const c = attr(buildDiorama(t).surface, 'color').array
      for (let i = 0; i < c.length; i += 3) {
        if (
          Math.abs(c[i]! - cliff.r) < 1e-4 &&
          Math.abs(c[i + 1]! - cliff.g) < 1e-4 &&
          Math.abs(c[i + 2]! - cliff.b) < 1e-4
        )
          return true
      }
      return false
    }
    // A near-vertical wall across the middle must register as cliff.
    expect(hasCliff(fakeTerrain((u) => (u < 0.5 ? 0 : 40)))).toBe(true)
    // Dead flat ground must not.
    expect(hasCliff(flat)).toBe(false)
  })
})

describe('scorch map', () => {
  it('darkens where it is stamped and leaves distant ground clean', () => {
    const scorch = new ScorchMap(100)
    expect(scorch.sample(0, 0)).toBe(0)

    scorch.stamp(0, 0)
    expect(scorch.sample(0, 0)).toBeGreaterThan(SCORCH.strength * 0.9)
    // Falls off with distance rather than tiling a hard disc.
    expect(scorch.sample(2, 0)).toBeLessThan(scorch.sample(0, 0))
    // Well outside SCORCH.radius, untouched.
    expect(scorch.sample(40, 40)).toBe(0)
  })

  it('keeps the strongest stamp where scars overlap', () => {
    const scorch = new ScorchMap(100)
    scorch.stamp(0, 0)
    const peak = scorch.sample(0, 0)
    scorch.stamp(2, 0) // overlapping, weaker at the original centre
    expect(scorch.sample(0, 0)).toBeGreaterThanOrEqual(peak)
  })

  it('maps world coordinates to the right corner of the mask', () => {
    const scorch = new ScorchMap(100)
    scorch.stamp(-40, -40)
    expect(scorch.sample(-40, -40)).toBeGreaterThan(SCORCH.strength * 0.9)
    expect(scorch.sample(40, 40)).toBe(0)
  })

  it('clears back to clean ground', () => {
    const scorch = new ScorchMap(100)
    scorch.stamp(0, 0)
    scorch.clear()
    expect(scorch.sample(0, 0)).toBe(0)
  })
})

describe('ScorchMap heat', () => {
  it('stamps heat that cools toward zero over time', () => {
    const map = new ScorchMap(100)
    map.stamp(0, 0)
    const fresh = map.sampleHeat(0, 0)
    expect(fresh).toBeGreaterThan(0)

    // Several seconds of cooling should take it well down but the darkening
    // it was stamped alongside must be untouched: the scar is permanent, only
    // the glow fades.
    const darkBefore = map.sample(0, 0)
    for (let i = 0; i < 60; i++) map.decayHeat(0.1)
    expect(map.sampleHeat(0, 0)).toBeLessThan(fresh * 0.5)
    expect(map.sample(0, 0)).toBe(darkBefore)
  })

  it('leaves heat at zero outside the heat radius', () => {
    const map = new ScorchMap(100)
    map.stamp(0, 0)
    expect(map.sampleHeat(40, 40)).toBe(0)
  })
})
