import { describe, it, expect } from 'vitest'
import { Box3 } from 'three'
import { mulberry32 } from './rng'
import { buildFoliage, buildTrunk, trunkHeightFraction } from './trees'
import type { Species } from './types'

const SPECIES: Species[] = ['conifer', 'hardwood']

function bounds(geo: { computeBoundingBox(): void; boundingBox: Box3 | null }) {
  geo.computeBoundingBox()
  return geo.boundingBox!
}

describe('tree geometry', () => {
  it.each(SPECIES)('%s foliage sits above the trunk and inside unit height', (species) => {
    const geo = buildFoliage(species, mulberry32(4))
    const b = bounds(geo)
    // Canopy is authored in the same unit space as the trunk, starting at or
    // above the trunk top, and never poking out past the normalised height.
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01)
    expect(b.max.y).toBeLessThanOrEqual(1.05)
    expect(b.max.y).toBeGreaterThan(trunkHeightFraction(species) * 0.5)
  })

  it.each(SPECIES)('%s trunk starts at the ground', (species) => {
    const b = bounds(buildTrunk(species))
    expect(Math.abs(b.min.y)).toBeLessThan(1e-6)
    expect(b.max.y).toBeGreaterThan(0)
  })

  it.each(SPECIES)('%s foliage is non-indexed so facets stay hard', (species) => {
    const geo = buildFoliage(species, mulberry32(11))
    // Indexed geometry would average normals across merged seams and smooth
    // the facets, which is the one thing the art direction cannot have.
    expect(geo.index).toBeNull()
    expect(geo.getAttribute('normal')).toBeDefined()
  })

  it.each(SPECIES)('%s foliage has only finite vertices', (species) => {
    const pos = buildFoliage(species, mulberry32(23)).getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    for (let i = 0; i < pos.count * 3; i++) {
      expect(Number.isFinite(pos.array[i])).toBe(true)
    }
  })

  it('varies between seeds but reproduces for one seed', () => {
    const a = buildFoliage('conifer', mulberry32(1)).getAttribute('position').count
    const b = buildFoliage('conifer', mulberry32(1)).getAttribute('position').count
    expect(a).toBe(b)
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (s) => buildFoliage('conifer', mulberry32(s)).getAttribute('position').count,
    )
    expect(new Set(seeds).size).toBeGreaterThan(1)
  })
})
