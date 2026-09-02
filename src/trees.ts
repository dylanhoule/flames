import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Rng, Species } from './types'
import { mulberry32, range } from './rng'
import { BASE_TREE_HEIGHT, TREE_JITTER } from './visual'

/**
 * Faceted low-poly tree geometry for the diorama.
 *
 * Every geometry here is built to a NORMALISED unit height of 1.0 with the
 * TREE's base at y = 0, so a single per-instance scale turns it into a tree of
 * any size. The trunk starts at 0; the canopy is authored from 0 and seated on
 * the trunk by `buildFoliage`, so it lands at TRUNK_FRACTION and the tree tops
 * out at 1. Foliage and trunk are separate geometries, and therefore separate
 * instanced meshes, for one reason: as a tree burns its foliage shrinks away
 * while the trunk remains as a charred spire. Splitting them lets the Scene
 * animate foliage scale independently without touching the trunk.
 *
 * Segment counts are deliberately low (6-7 radial) so facets read clearly
 * under flat shading. Smooth cones would fight the art direction.
 */

/** Fraction of total tree height taken by the bare trunk below the canopy. */
const TRUNK_FRACTION: Record<Species, number> = {
  conifer: 0.3,
  hardwood: 0.42,
}

/** Trunk radius as a fraction of total height. */
const TRUNK_RADIUS: Record<Species, number> = {
  conifer: 0.035,
  hardwood: 0.055,
}

export function trunkHeightFraction(species: Species): number {
  return TRUNK_FRACTION[species]
}

/** Per-tree fixed variation. See `treeVariation`. */
export interface TreeVariation {
  /** World units, base to normalised top. */
  height: number
  /** Multiplier on canopy width, 1 being the authored width. */
  radius: number
  tiltX: number
  tiltZ: number
  spin: number
  /** 0..1, mixes the species' two foliage greens. */
  hue: number
}

/**
 * Per-tree fixed variation, seeded from the cell id rather than drawn from one
 * sequential stream.
 *
 * The renderer and the fire effects both need a tree's height (the Scene to
 * scale it, fx to anchor flames in its crown) and they walk different subsets
 * of the forest in different orders. Keying on the id means either can ask for
 * one tree in isolation and get the same answer, with no shared stream to keep
 * in step and nothing to thread through props.
 */
export function treeVariation(cellId: number, seed: number): TreeVariation {
  const rng = mulberry32((seed ^ Math.imul(cellId + 1, 0x9e3779b1)) >>> 0)
  return {
    height: BASE_TREE_HEIGHT * (1 + range(rng, -TREE_JITTER.height, TREE_JITTER.height)),
    radius: 1 + range(rng, -TREE_JITTER.radius, TREE_JITTER.radius),
    tiltX: range(rng, -TREE_JITTER.tiltRad, TREE_JITTER.tiltRad),
    tiltZ: range(rng, -TREE_JITTER.tiltRad, TREE_JITTER.tiltRad),
    spin: range(rng, 0, Math.PI * 2),
    hue: rng(),
  }
}

/**
 * Tapered trunk, base at y = 0, top at y = 1.
 * Instanced with a scale of (1, treeHeight, 1) so it always reaches the canopy.
 */
export function buildTrunk(species: Species): THREE.BufferGeometry {
  const r = TRUNK_RADIUS[species]
  // Overlap up into the canopy so no seam shows where the crown is seated.
  // 0.10, not the old 0.06: a hardwood's lowest blob is randomly offset and on
  // some seeds starts 0.083 above the canopy base, which left the crown
  // hovering a hair off the trunk. Invisible either way, being inside the
  // foliage, so size it for the worst seed rather than the average one.
  const h = TRUNK_FRACTION[species] + 0.10
  const geo = new THREE.CylinderGeometry(r * 0.62, r, h, 6, 1)
  geo.translate(0, h / 2, 0)
  return geo
}

/**
 * Conifer canopy: 4-6 cone tiers of decreasing radius, each nudged and spun a
 * little so the silhouette clumps rather than stacking as a clean regular
 * pyramid. Merged into ONE geometry so the whole canopy is a single instanced
 * draw call.
 *
 * Authored with its base at y = 0 against a canopy budget of 1 - TRUNK_FRACTION.
 * `buildFoliage` seats it on the trunk; do not call this directly expecting a
 * placed canopy.
 */
export function buildConiferFoliage(rng: Rng): THREE.BufferGeometry {
  const tiers = 4 + Math.floor(rng() * 3) // 4, 5 or 6
  const canopy = 1 - TRUNK_FRACTION.conifer
  const parts: THREE.BufferGeometry[] = []

  for (let i = 0; i < tiers; i++) {
    const t = i / tiers
    // Lower tiers are wider and taller; the top tier is a small spire.
    const radius = (0.3 - 0.19 * t) * range(rng, 0.9, 1.1)
    const height = (canopy / tiers) * range(rng, 1.5, 1.85)
    const y = canopy * t * 0.92

    const cone = new THREE.ConeGeometry(radius, height, 7, 1)
    cone.rotateY(rng() * Math.PI * 2)
    cone.translate(range(rng, -0.02, 0.02), y + height / 2, range(rng, -0.02, 0.02))
    parts.push(cone)
  }

  return finalise(parts)
}

/**
 * Hardwood canopy: several offset spheroid blobs merged into one lumpy mass.
 * Icosahedron at detail 1 gives large flat triangles, which is exactly the
 * faceted look wanted; a sphere would read as smooth and plastic.
 */
export function buildHardwoodFoliage(rng: Rng): THREE.BufferGeometry {
  const blobs = 3 + Math.floor(rng() * 3) // 3, 4 or 5
  const canopy = 1 - TRUNK_FRACTION.hardwood
  const parts: THREE.BufferGeometry[] = []

  for (let i = 0; i < blobs; i++) {
    const radius = canopy * range(rng, 0.3, 0.46)
    const blob = new THREE.IcosahedronGeometry(radius, 1)
    // Squash slightly so the canopy is wider than tall, like a broadleaf crown.
    blob.scale(range(rng, 1.0, 1.25), range(rng, 0.72, 0.92), range(rng, 1.0, 1.25))
    blob.rotateY(rng() * Math.PI * 2)
    blob.rotateX(range(rng, -0.3, 0.3))

    const spread = canopy * 0.26
    blob.translate(
      range(rng, -spread, spread),
      canopy * range(rng, 0.32, 0.62),
      range(rng, -spread, spread),
    )
    parts.push(blob)
  }

  return finalise(parts)
}

export function buildFoliage(species: Species, rng: Rng): THREE.BufferGeometry {
  const geo = species === 'conifer' ? buildConiferFoliage(rng) : buildHardwoodFoliage(rng)
  // Seat the crown on the trunk. Both builders author their canopy base at
  // y = 0 against a canopy budget of `1 - TRUNK_FRACTION`, so without this the
  // crown sits on the ground, swallows the trunk, and the tree tops out a
  // quarter short of its normalised height. That shortfall is what put the
  // flame anchors above the trees.
  //
  // Done in the GEOMETRY rather than in the Scene's instance matrix: the
  // per-tree tilt quaternion and the burn shader's settle rotation both pivot
  // about the object origin (the tree base), so a world-space Y offset applied
  // after them would swing the crown about its own base instead of the trunk's.
  geo.translate(0, TRUNK_FRACTION[species], 0)
  geo.computeBoundingSphere()
  return geo
}

/**
 * Merge the parts, drop the index, and recompute normals.
 *
 * Going non-indexed matters: with shared indexed vertices the merged blobs
 * would average their normals across seams and the facets would soften into
 * exactly the smooth look the art direction rejects.
 */
function finalise(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('buildFoliage: geometry merge failed')
  parts.forEach((p) => p.dispose())

  const flat = merged.toNonIndexed()
  merged.dispose()
  flat.computeVertexNormals()
  flat.computeBoundingSphere()
  return flat
}
