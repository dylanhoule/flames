import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Rng, Species } from './types'
import { range } from './rng'

/**
 * Faceted low-poly tree geometry for the diorama.
 *
 * Every geometry here is built to a NORMALISED unit height of 1.0 with its
 * base at y = 0, so a single per-instance scale turns it into a tree of any
 * size. Foliage and trunk are separate geometries, and therefore separate
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

/**
 * Tapered trunk, base at y = 0, top at y = 1.
 * Instanced with a scale of (1, treeHeight, 1) so it always reaches the canopy.
 */
export function buildTrunk(species: Species): THREE.BufferGeometry {
  const r = TRUNK_RADIUS[species]
  const h = TRUNK_FRACTION[species] + 0.06 // overlap slightly into the canopy
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
 * Built with its base at y = 0 so the Scene can seat it at the trunk top and
 * shrink it downward as it burns.
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
  return species === 'conifer' ? buildConiferFoliage(rng) : buildHardwoodFoliage(rng)
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
