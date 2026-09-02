import * as THREE from 'three'
import type { TerrainField } from './types'
import { CLIFF_COLOR, CLIFF_SLOPE, ELEVATION_BANDS, SCORCH, STRATA } from './visual'

/**
 * Geometry for the diorama slab: the terrain surface, the cut sides showing
 * their strata, and the base cap.
 *
 * The finite edge is the whole point of the art direction, so unlike a normal
 * terrain renderer nothing here tries to hide the footprint boundary. The slab
 * is a museum model on a table: hard edges, visible geology, floating.
 *
 * Everything is emitted NON-INDEXED with one flat colour per triangle, so
 * facets stay hard under flat shading and each face can take its own band
 * colour without needing a texture.
 */

/** How far the slab extends below the lowest point of the terrain. */
const SLAB_DEPTH = 9

/** Thickness of the grass rim that follows the terrain silhouette. */
const GRASS_LIP = 0.7

export interface DioramaGeometry {
  surface: THREE.BufferGeometry
  sides: THREE.BufferGeometry
  bottomY: number
}


export function buildDiorama(terrain: TerrainField): DioramaGeometry {
  const { heightmap } = terrain
  let minH = Infinity
  let maxH = -Infinity
  for (const h of heightmap) {
    if (h < minH) minH = h
    if (h > maxH) maxH = h
  }
  const bottomY = minH - SLAB_DEPTH

  return {
    surface: buildSurface(terrain, minH, maxH),
    sides: buildSides(terrain, minH, bottomY),
    bottomY,
  }
}


/** World position of a heightmap grid node. */
function nodeAt(terrain: TerrainField, ix: number, iz: number): THREE.Vector3 {
  const { size, resolution, heightmap } = terrain
  const u = ix / (resolution - 1)
  const v = iz / (resolution - 1)
  return new THREE.Vector3(
    (u - 0.5) * size,
    heightmap[iz * resolution + ix]!,
    (v - 0.5) * size,
  )
}

/** Flat elevation band lookup, by height normalised across the whole map. */
function bandColor(normalised: number): THREE.Color {
  for (const band of ELEVATION_BANDS) {
    if (normalised <= band.upTo) return new THREE.Color(band.color)
  }
  return new THREE.Color(ELEVATION_BANDS[ELEVATION_BANDS.length - 1]!.color)
}

/**
 * Terrain surface. Each grid quad becomes two triangles, and each triangle
 * gets ONE colour chosen from its own centroid height and its own steepness,
 * so terraced cliff walls read as exposed rock against the green plateaus
 * above and below them.
 */
function buildSurface(terrain: TerrainField, minH: number, maxH: number): THREE.BufferGeometry {
  const { resolution } = terrain
  const span = Math.max(maxH - minH, 1e-6)
  const positions: number[] = []
  const colors: number[] = []

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const cy = (a.y + b.y + c.y) / 3

    // Steepness of this triangle from its own normal, so the cliff test uses
    // the real rendered face rather than a resampled gradient.
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize()
    const steepness = Math.tan(Math.acos(Math.min(1, Math.abs(normal.y))))

    const color =
      steepness >= CLIFF_SLOPE
        ? new THREE.Color(CLIFF_COLOR)
        : bandColor((cy - minH) / span)

    for (const v of [a, b, c]) positions.push(v.x, v.y, v.z)
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b)
  }

  for (let iz = 0; iz < resolution - 1; iz++) {
    for (let ix = 0; ix < resolution - 1; ix++) {
      const p00 = nodeAt(terrain, ix, iz)
      const p10 = nodeAt(terrain, ix + 1, iz)
      const p01 = nodeAt(terrain, ix, iz + 1)
      const p11 = nodeAt(terrain, ix + 1, iz + 1)
      pushTri(p00, p01, p10)
      pushTri(p10, p01, p11)
    }
  }

  return finalise(positions, colors)
}

/**
 * The cut sides, plus the base cap.
 *
 * Strata are laid out the way real geology reads: the base and stone courses
 * sit at FIXED absolute heights so they stay level all the way round the slab,
 * while the topsoil above them thickens and thins to follow the terrain, and a
 * thin grass rim tracks the silhouette exactly. Making every band follow the
 * terrain would look like a stack of blankets rather than rock.
 */
function buildSides(
  terrain: TerrainField,
  minH: number,
  bottomY: number,
): THREE.BufferGeometry {
  const { resolution } = terrain
  const positions: number[] = []
  const colors: number[] = []

  const [lip, topsoil, stone, base] = STRATA
  const depth = minH - bottomY
  const baseTop = bottomY + base.thickness * depth
  const stoneTop = baseTop + stone.thickness * depth

  const quad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    hex: string,
  ) => {
    const col = new THREE.Color(hex)
    for (const v of [a, b, c, a, c, d]) {
      positions.push(v.x, v.y, v.z)
      colors.push(col.r, col.g, col.b)
    }
  }

  // Walk each of the four edges. `outward` keeps winding consistent so all
  // side faces point away from the model and none are culled.
  const edges: Array<{ node: (i: number) => THREE.Vector3; flip: boolean }> = [
    { node: (i) => nodeAt(terrain, i, 0), flip: true },
    { node: (i) => nodeAt(terrain, i, resolution - 1), flip: false },
    { node: (i) => nodeAt(terrain, 0, i), flip: false },
    { node: (i) => nodeAt(terrain, resolution - 1, i), flip: true },
  ]

  for (const edge of edges) {
    for (let i = 0; i < resolution - 1; i++) {
      const p = edge.node(i)
      const q = edge.node(i + 1)
      const [l, r] = edge.flip ? [q, p] : [p, q]

      const at = (v: THREE.Vector3, y: number) => new THREE.Vector3(v.x, y, v.z)
      const lipL = l.y - GRASS_LIP
      const lipR = r.y - GRASS_LIP

      quad(at(l, bottomY), at(r, bottomY), at(r, baseTop), at(l, baseTop), base.color)
      quad(at(l, baseTop), at(r, baseTop), at(r, stoneTop), at(l, stoneTop), stone.color)
      quad(at(l, stoneTop), at(r, stoneTop), at(r, lipR), at(l, lipL), topsoil.color)
      quad(at(l, lipL), at(r, lipR), r, l, lip.color)
    }
  }

  // Base cap, so orbiting to a low angle does not look inside a hollow shell.
  const half = terrain.size / 2
  quad(
    new THREE.Vector3(-half, bottomY, -half),
    new THREE.Vector3(-half, bottomY, half),
    new THREE.Vector3(half, bottomY, half),
    new THREE.Vector3(half, bottomY, -half),
    base.color,
  )

  return finalise(positions, colors)
}

function finalise(positions: number[], colors: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}


// ------------------------------------------------------------- burn scar

/** Resolution of the scorch mask over the footprint. */
const SCORCH_RES = 256

/**
 * A single-channel mask of where fire has been, stamped as cells char and
 * sampled by the terrain shader.
 *
 * This is the aftermath read: once the front has passed, the scar on the
 * ground is what still shows the path the fire actually took. It is a texture
 * rather than vertex colours so the darkening does not have to align with the
 * terrain's triangulation.
 */
export class ScorchMap {
  readonly texture: THREE.DataTexture
  private readonly data: Uint8Array
  private readonly size: number

  constructor(size: number) {
    this.size = size
    this.data = new Uint8Array(SCORCH_RES * SCORCH_RES * 4)
    this.texture = new THREE.DataTexture(this.data, SCORCH_RES, SCORCH_RES, THREE.RGBAFormat)
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.wrapS = THREE.ClampToEdgeWrapping
    this.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture.needsUpdate = true
  }

  /** Darken a soft disc around a world xz position. Idempotent-ish: keeps the max. */
  stamp(x: number, z: number): void {
    const half = this.size / 2
    const perUnit = SCORCH_RES / this.size
    const cx = (x + half) * perUnit
    const cz = (z + half) * perUnit
    const r = SCORCH.radius * perUnit
    const peak = SCORCH.strength * 255

    const i0 = Math.max(0, Math.floor(cx - r))
    const i1 = Math.min(SCORCH_RES - 1, Math.ceil(cx + r))
    const j0 = Math.max(0, Math.floor(cz - r))
    const j1 = Math.min(SCORCH_RES - 1, Math.ceil(cz + r))

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - cx, j - cz) / r
        if (d >= 1) continue
        // Smooth falloff so scars blend into one another instead of tiling discs.
        const falloff = (1 - d) * (1 - d)
        const v = peak * falloff
        const idx = (j * SCORCH_RES + i) * 4
        if (v > this.data[idx]!) {
          this.data[idx] = v
          this.data[idx + 3] = 255
        }
      }
    }
    this.texture.needsUpdate = true
  }

  /** Value at a world position, 0..1. Exposed for tests. */
  sample(x: number, z: number): number {
    const half = this.size / 2
    const perUnit = SCORCH_RES / this.size
    const i = Math.round((x + half) * perUnit)
    const j = Math.round((z + half) * perUnit)
    if (i < 0 || j < 0 || i >= SCORCH_RES || j >= SCORCH_RES) return 0
    return this.data[(j * SCORCH_RES + i) * 4]! / 255
  }

  clear(): void {
    this.data.fill(0)
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }
}

/**
 * Patch a terrain material to darken where the scorch mask is set.
 *
 * Injected rather than written as a custom material so the surface keeps all of
 * MeshStandardMaterial's lighting; only the base colour is modified.
 */
export function applyScorch(
  material: THREE.MeshStandardMaterial,
  scorch: ScorchMap,
  size: number,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScorch = { value: scorch.texture }
    shader.uniforms.uScorchColor = { value: new THREE.Color(SCORCH.color) }
    shader.uniforms.uFootprint = { value: size }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uScorch;
         uniform vec3 uScorchColor;
         uniform float uFootprint;
         varying vec3 vWorld;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec2 scorchUv = (vWorld.xz / uFootprint) + 0.5;
         float scorch = texture2D(uScorch, scorchUv).r;
         diffuseColor.rgb = mix(diffuseColor.rgb, uScorchColor, clamp(scorch, 0.0, 1.0));`,
      )
  }
  // Without this, three caches compiled programs by material parameters and
  // hands this material the slab sides' identical-looking program, which has
  // none of the injection above. The scar then silently never renders.
  material.customProgramCacheKey = () => 'terrain-scorch'
  material.needsUpdate = true
}
