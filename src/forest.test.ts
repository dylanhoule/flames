import { describe, expect, it } from 'vitest'
import { generateForest } from './forest'
import { mulberry32 } from './rng'
import type { TerrainField } from './types'

const SIZE = 40
const RESOLUTION = 2 // unused by generateForest; elevationAt/slopeAt are the real interface

function flatTerrain(waterLevel = -100): TerrainField {
  return {
    size: SIZE,
    resolution: RESOLUTION,
    landform: 'rolling',
    waterLevel,
    heightmap: new Float32Array(RESOLUTION * RESOLUTION),
    elevationAt: () => 5,
    slopeAt: () => ({ magnitude: 0, direction: [0, 0] }),
  }
}

/** Elevation rises linearly with x at a constant slope; z is flat. */
function rampTerrain(slope = 0.2): TerrainField {
  return {
    size: SIZE,
    resolution: RESOLUTION,
    landform: 'rolling',
    waterLevel: -100,
    heightmap: new Float32Array(RESOLUTION * RESOLUTION),
    elevationAt: (x) => x * slope,
    slopeAt: () => ({ magnitude: slope, direction: [1, 0] }),
  }
}

/** A below-water channel of half-width 2 running along x, splitting the field at z=0. */
function channelTerrain(): TerrainField {
  return {
    size: SIZE,
    resolution: RESOLUTION,
    landform: 'ridge-valley',
    waterLevel: 0,
    heightmap: new Float32Array(RESOLUTION * RESOLUTION),
    elevationAt: (_x, z) => (Math.abs(z) <= 2 ? -5 : 5),
    slopeAt: () => ({ magnitude: 0, direction: [0, 0] }),
  }
}

/**
 * Low-relief "shallow pool" landform: elevation rises radially from a low
 * centre to a flat plateau at the edges, with only ~5 units of total relief
 * (heightmap spans 0..5) and water sitting near the top of that range. This
 * is the shape that exposed the shoreMargin bug: a FIXED elevation margin
 * (the old default, 1.5) swallows most of a shallow terrain's height range,
 * while a margin scaled to relief (the fix) leaves most of the footprint
 * plantable, as real gentle "rolling" terrain needs.
 */
function lowReliefTerrain(): TerrainField {
  const size = 100
  const relief = 5
  const waterLevel = 3.4
  const half = size / 2
  return {
    size,
    resolution: 2,
    landform: 'rolling',
    waterLevel,
    heightmap: new Float32Array([0, relief, 0, relief]),
    elevationAt: (x, z) => Math.min(relief, (relief * Math.sqrt(x * x + z * z)) / half),
    slopeAt: () => ({ magnitude: 0.05, direction: [0, 0] }),
  }
}

/**
 * Flat, dry terrain except for a steep, always-rejected vertical strip
 * through the middle (wider than any single Poisson-disc growth step can
 * jump), splitting the plantable footprint into two disconnected islands.
 * A single-seed sampler can only ever fill whichever island its one seed
 * lands in; this is what the multi-seed reseed fix (Cause 2) is for.
 */
function islandsTerrain(): TerrainField {
  const size = 60
  return {
    size,
    resolution: 2,
    landform: 'rolling',
    waterLevel: -100,
    heightmap: new Float32Array([5, 5, 5, 5]),
    elevationAt: () => 5,
    slopeAt: (x) => ({ magnitude: Math.abs(x) < 6 ? 1 : 0, direction: [0, 0] }),
  }
}

function dist2(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return dx * dx + dz * dz
}

describe('generateForest', () => {
  it('places 50-200 trees on an open flat field', () => {
    const forest = generateForest(flatTerrain(), mulberry32(1))
    expect(forest.cells.length).toBeGreaterThanOrEqual(50)
    expect(forest.cells.length).toBeLessThanOrEqual(200)
  })

  it('never places two trees closer than the Poisson minimum distance', () => {
    const minDistance = 5
    const forest = generateForest(flatTerrain(), mulberry32(2), { minDistance })
    for (let i = 0; i < forest.cells.length; i++) {
      for (let j = i + 1; j < forest.cells.length; j++) {
        expect(dist2(forest.cells[i]!.position, forest.cells[j]!.position)).toBeGreaterThanOrEqual(
          minDistance * minDistance - 1e-6,
        )
      }
    }
  })

  it('respects the slope bound, elevation band, and shoreline margin', () => {
    const terrain = rampTerrain(0.2)
    const opts = { maxSlope: 0.5, minElevation: -5, maxElevation: 5, shoreMargin: 1, targetCount: 100 }
    const forest = generateForest(terrain, mulberry32(3), opts)
    expect(forest.cells.length).toBeGreaterThan(0)
    for (const cell of forest.cells) {
      const [x, , z] = cell.position
      expect(terrain.slopeAt(x, z).magnitude).toBeLessThanOrEqual(opts.maxSlope)
      const elevation = terrain.elevationAt(x, z)
      expect(elevation).toBeGreaterThanOrEqual(opts.minElevation)
      expect(elevation).toBeLessThanOrEqual(opts.maxElevation)
      expect(elevation).toBeGreaterThan(terrain.waterLevel + opts.shoreMargin)
    }
  })

  it('builds a symmetric neighbour graph with no self-links', () => {
    const forest = generateForest(flatTerrain(), mulberry32(4))
    const byId = new Map(forest.cells.map((c) => [c.id, c]))
    for (const cell of forest.cells) {
      expect(cell.neighbors).not.toContain(cell.id)
      for (const nId of cell.neighbors) {
        const neighbor = byId.get(nId)
        expect(neighbor).toBeDefined()
        expect(neighbor!.neighbors).toContain(cell.id)
      }
    }
  })

  it('treats a below-water channel as a firebreak: banks are disconnected components', () => {
    const terrain = channelTerrain()
    const forest = generateForest(terrain, mulberry32(5), { targetCount: 150, neighborRadius: 9 })

    const northBank = forest.cells.filter((c) => c.position[2] > 2)
    const southBank = forest.cells.filter((c) => c.position[2] < -2)
    expect(northBank.length).toBeGreaterThan(0)
    expect(southBank.length).toBeGreaterThan(0)

    // No neighbour link may cross the channel at all (a stronger, direct check).
    for (const cell of forest.cells) {
      for (const nId of cell.neighbors) {
        const neighbor = forest.cells.find((c) => c.id === nId)!
        const crossesChannel = Math.sign(cell.position[2]) !== Math.sign(neighbor.position[2])
        if (cell.position[2] === 0 || neighbor.position[2] === 0) continue
        expect(crossesChannel).toBe(false)
      }
    }

    // Flood-fill from a north-bank cell must never reach a south-bank cell.
    const byId = new Map(forest.cells.map((c) => [c.id, c]))
    const start = northBank[0]!
    const visited = new Set<number>([start.id])
    const stack = [start.id]
    while (stack.length > 0) {
      const current = byId.get(stack.pop()!)!
      for (const nId of current.neighbors) {
        if (!visited.has(nId)) {
          visited.add(nId)
          stack.push(nId)
        }
      }
    }
    for (const cell of southBank) {
      expect(visited.has(cell.id)).toBe(false)
    }
  })

  it('always agrees species with fuelModel', () => {
    const forest = generateForest(flatTerrain(), mulberry32(6), { targetCount: 180 })
    for (const cell of forest.cells) {
      if (cell.fuelModel === 9) {
        expect(cell.species).toBe('hardwood')
      } else {
        expect(cell.species).toBe('conifer')
      }
    }
  })

  it('clumps fuel models spatially rather than assigning them independently', () => {
    const forest = generateForest(flatTerrain(), mulberry32(7), { minDistance: 3, targetCount: 180 })
    expect(forest.cells.length).toBeGreaterThan(20)

    let matches = 0
    for (const cell of forest.cells) {
      let nearest = null as (typeof forest.cells)[number] | null
      let nearestD2 = Infinity
      for (const other of forest.cells) {
        if (other.id === cell.id) continue
        const d2 = dist2(cell.position, other.position)
        if (d2 < nearestD2) {
          nearestD2 = d2
          nearest = other
        }
      }
      if (nearest && nearest.fuelModel === cell.fuelModel) matches++
    }
    const ratio = matches / forest.cells.length
    // Independent random assignment over 3 models would land near 1/3; spatial
    // clumping via low-frequency noise should push this meaningfully higher.
    expect(ratio).toBeGreaterThan(0.5)
  })

  it('is conifer-dominant (65-75% models 8+10, 25-35% model 9) across seeds, while staying clumped', () => {
    const terrain = flatTerrain()
    let conifer = 0
    let hardwood = 0
    let matches = 0
    let total = 0

    for (let seed = 1; seed <= 20; seed++) {
      const forest = generateForest(terrain, mulberry32(seed), { minDistance: 3, targetCount: 120 })
      for (const cell of forest.cells) {
        if (cell.species === 'conifer') conifer++
        else hardwood++

        let nearest = null as (typeof forest.cells)[number] | null
        let nearestD2 = Infinity
        for (const other of forest.cells) {
          if (other.id === cell.id) continue
          const d2 = dist2(cell.position, other.position)
          if (d2 < nearestD2) {
            nearestD2 = d2
            nearest = other
          }
        }
        if (nearest && nearest.fuelModel === cell.fuelModel) matches++
        total++
      }
    }

    const coniferRatio = conifer / total
    const clumpRatio = matches / total
    expect(coniferRatio).toBeGreaterThanOrEqual(0.65)
    expect(coniferRatio).toBeLessThanOrEqual(0.75)
    // Independent random assignment over 3 models would land near 1/3; spatial
    // clumping via low-frequency noise should stay well above that.
    expect(clumpRatio).toBeGreaterThan(0.5)
  })

  it('places at least 50 trees on low-relief terrain with water cutting through it', () => {
    const terrain = lowReliefTerrain()
    for (let seed = 1; seed <= 10; seed++) {
      const forest = generateForest(terrain, mulberry32(seed))
      expect(forest.cells.length).toBeGreaterThanOrEqual(50)
    }
  })

  it('reaches both sides of terrain split into two disconnected islands', () => {
    const terrain = islandsTerrain()
    for (let seed = 1; seed <= 5; seed++) {
      const forest = generateForest(terrain, mulberry32(seed))
      const west = forest.cells.filter((c) => c.position[0] < -6)
      const east = forest.cells.filter((c) => c.position[0] > 6)
      expect(west.length).toBeGreaterThan(0)
      expect(east.length).toBeGreaterThan(0)
    }
  })

  it('reproduces an identical forest from the same seed', () => {
    const terrain = flatTerrain()
    const a = generateForest(terrain, mulberry32(42))
    const b = generateForest(terrain, mulberry32(42))
    expect(a).toEqual(b)
  })
})
