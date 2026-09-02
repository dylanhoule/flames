import { describe, it, expect } from 'vitest'
import { Box3 } from 'three'
import { mulberry32 } from './rng'
import { buildFoliage, buildTrunk, trunkHeightFraction, treeVariation } from './trees'
import { FLAME } from './visual'
import type { Species } from './types'

const SPECIES: Species[] = ['conifer', 'hardwood']

function bounds(geo: { computeBoundingBox(): void; boundingBox: Box3 | null }) {
  geo.computeBoundingBox()
  return geo.boundingBox!
}

describe('tree geometry', () => {
  // Several seeds, because tier and blob counts vary with the seed and the
  // extremes are what these bounds are guarding.
  it.each(SPECIES)('%s foliage is seated on the trunk and reaches the tree top', (species) => {
    for (const seed of [1, 4, 7, 11, 23, 42]) {
      const b = bounds(buildFoliage(species, mulberry32(seed)))
      const trunk = trunkHeightFraction(species)
      // Seated at the trunk top, not sitting on the ground. Dropping this
      // translate is what made trees a quarter short and left the flames,
      // which anchor as a fraction of tree height, hanging above the crown.
      // The bound is loose because a hardwood's lowest blob is randomly
      // offset and legitimately dips a little below the canopy base.
      expect(b.min.y).toBeGreaterThan(trunk * 0.8)
      // Crown reaches the top of the normalised tree. The conifer's topmost
      // tier is allowed to spire slightly past it: tiers deliberately overlap.
      expect(b.max.y).toBeGreaterThan(0.85)
      expect(b.max.y).toBeLessThanOrEqual(1.12)
    }
  })

  it.each(SPECIES)('%s crown overlaps the trunk rather than floating above it', (species) => {
    const foliage = bounds(buildFoliage(species, mulberry32(4)))
    expect(foliage.min.y).toBeLessThan(bounds(buildTrunk(species)).max.y)
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

/**
 * The flames used to hang in the air above the trees, and the reason was that
 * their anchor was an absolute world height while a tree's height is jittered
 * by a quarter either way. Both are fractions of the tree's own height now, so
 * the relationship can be checked once in unit space and holds for every tree.
 */
describe('flame anchoring', () => {
  it.each(SPECIES)('%s flames are anchored inside the crown and clear its top', (species) => {
    for (const seed of [1, 4, 7, 11, 23, 42]) {
      const crown = bounds(buildFoliage(species, mulberry32(seed)))
      // Anchored in the crown, not below it and not floating above it.
      expect(FLAME.liftFraction).toBeGreaterThan(crown.min.y)
      expect(FLAME.liftFraction).toBeLessThan(crown.max.y)
      // Even the shortest tongue (0.75 jitter) at full intensity reaches past
      // the foliage, so no tree burns with its flames buried in its own crown.
      expect(FLAME.liftFraction + FLAME.heightFraction * 0.75).toBeGreaterThan(crown.max.y)
    }
  })

  it('tree variation is deterministic per cell and independent of call order', () => {
    const a = treeVariation(7, 99)
    const b = treeVariation(7, 99)
    expect(a).toEqual(b)
    // Reading a different tree in between must not shift the answer: the Scene
    // and the fire effects walk the forest in different orders.
    treeVariation(3, 99)
    expect(treeVariation(7, 99)).toEqual(a)
    expect(treeVariation(8, 99).height).not.toBe(a.height)
  })
})
