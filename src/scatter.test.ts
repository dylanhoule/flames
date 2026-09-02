import { describe, it, expect } from 'vitest'
import { generateScatter } from './scatter'
import { mulberry32 } from './rng'
import type { Forest, Slope, TerrainField } from './types'

function terrainWith(
  height: (x: number, z: number) => number,
  waterLevel = -1000,
  slope = 0,
): TerrainField {
  return {
    size: 100,
    resolution: 2,
    landform: 'rolling',
    waterLevel,
    heightmap: new Float32Array(4),
    elevationAt: (x, z) => height(x, z),
    slopeAt: (): Slope => ({ magnitude: slope, direction: [0, 0] }),
  }
}

const emptyForest: Forest = { cells: [] }

function forestAt(points: Array<[number, number]>): Forest {
  return {
    cells: points.map(([x, z], id) => ({
      id,
      position: [x, 0, z] as const,
      fuelModel: 9 as const,
      species: 'hardwood' as const,
      fuelLoad: 1,
      moistureContent: 0.07,
      moistureOfExtinction: 0.25,
      neighbors: [],
    })),
  }
}

describe('scatter', () => {
  it('places props across the footprint', () => {
    const props = generateScatter(terrainWith(() => 10), emptyForest, mulberry32(1))
    expect(props.length).toBeGreaterThan(10)
    for (const p of props) {
      expect(Math.abs(p.position[0])).toBeLessThanOrEqual(50)
      expect(Math.abs(p.position[2])).toBeLessThanOrEqual(50)
      expect(p.scale).toBeGreaterThan(0)
    }
  })

  it('never places below the waterline', () => {
    // Ground slopes down toward -x; water covers everything left of x = 0.
    const terrain = terrainWith((x) => x, 0, 0)
    const props = generateScatter(terrain, emptyForest, mulberry32(2), { shoreMargin: 0.5 })
    expect(props.length).toBeGreaterThan(0)
    for (const p of props) expect(p.position[1]).toBeGreaterThan(0.5)
  })

  it('rejects ground steeper than the threshold', () => {
    const steep = terrainWith(() => 10, -1000, 2)
    expect(generateScatter(steep, emptyForest, mulberry32(3), { maxSlope: 0.75 })).toHaveLength(0)
  })

  it('keeps clear of trees so props never intersect a trunk', () => {
    // A dense lattice of trees over the whole footprint.
    const points: Array<[number, number]> = []
    for (let x = -48; x <= 48; x += 4) for (let z = -48; z <= 48; z += 4) points.push([x, z])
    const forest = forestAt(points)
    const props = generateScatter(terrainWith(() => 5), forest, mulberry32(4), { treeClearance: 3 })
    for (const p of props) {
      for (const cell of forest.cells) {
        const d = Math.hypot(cell.position[0] - p.position[0], cell.position[2] - p.position[2])
        expect(d).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('reproduces exactly from a seed', () => {
    const run = () => generateScatter(terrainWith(() => 8), emptyForest, mulberry32(9))
    expect(run()).toEqual(run())
  })

  it('produces both kinds', () => {
    const kinds = new Set(generateScatter(terrainWith(() => 8), emptyForest, mulberry32(11)).map((p) => p.kind))
    expect(kinds.has('boulder')).toBe(true)
    expect(kinds.has('log')).toBe(true)
  })
})
