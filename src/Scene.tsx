import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

import { applyScorch, buildDiorama, ScorchMap } from './diorama'
import { FireEffects } from './fx'
import { buildFoliage, buildTrunk } from './trees'
import { generateScatter } from './scatter'
import type { ScatterProp } from './scatter'
import { mulberry32, range } from './rng'
import type { FireSim, Forest, Species, TerrainField, Wind } from './types'
import { BURNING, CHARRED } from './types'
import {
  BACKDROP, BURN, CAMERA, CLIFF_COLOR, FIRE_LIGHT, FOLIAGE, LIGHTS, POST, TREE_JITTER, TRUNK, WATER,
} from './visual'
import { BURN_SHADING_GLSL, burnIntensity, glslColor } from './burnShading'

/** Height of a tree in world units, before per-instance jitter. */
const BASE_TREE_HEIGHT = 7

export interface SceneProps {
  terrain: TerrainField
  forest: Forest
  sim: FireSim | null
  wind: Wind
  seed: number
  onIgnite?: (cellId: number) => void
  /** Mutated in place with total SIMULATED seconds advanced. */
  clock?: { elapsed: number }
}

/**
 * The diorama. Reads simulation state every frame and pushes it into instanced
 * attributes; it never mutates the sim except through the ignite click.
 */
export function Scene({ terrain, forest, sim, wind, seed, onIgnite, clock }: SceneProps) {
  return (
    <Canvas
      orthographic
      shadows
      camera={{ position: CAMERA.position as unknown as [number, number, number], zoom: CAMERA.zoom, near: 0.1, far: 1000 }}
      gl={{ antialias: false }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
        scene.background = new THREE.Color(BACKDROP.bottom)
      }}
    >
      <Lighting />
      <FireLights forest={forest} sim={sim} />
      <SimDriver sim={sim} clock={clock} />
      <Slab terrain={terrain} forest={forest} sim={sim} />
      <Water terrain={terrain} />
      <Scatter terrain={terrain} forest={forest} seed={seed} />
      <Trees terrain={terrain} forest={forest} sim={sim} wind={wind} seed={seed} onIgnite={onIgnite} />
      <FireEffects forest={forest} sim={sim} wind={wind} />
      <OrbitControls
        enablePan={false}
        enableDamping
        minPolarAngle={CAMERA.minPolarRad}
        maxPolarAngle={CAMERA.maxPolarRad}
        minZoom={CAMERA.minZoom}
        maxZoom={CAMERA.maxZoom}
      />
      <DeferredEffects />
    </Canvas>
  )
}

/**
 * Post-processing, mounted one frame late.
 *
 * Mounting EffectComposer in the same commit as the Canvas leaves it
 * initialised against a canvas that has not been measured yet, and it renders
 * black forever rather than recovering on the next resize. Waiting for one
 * frame costs nothing visible and makes a cold load behave like a hot reload.
 */
function DeferredEffects() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])
  if (!ready) return null
  return (
    <EffectComposer multisampling={4}>
      <Bloom
        intensity={POST.bloomIntensity}
        luminanceThreshold={POST.bloomThreshold}
        radius={POST.bloomRadius}
        mipmapBlur
      />
      <Vignette darkness={POST.vignette} eskil={false} />
    </EffectComposer>
  )
}

/** Advances the simulation once per frame. The Scene never mutates sim state
 *  anywhere else except through the ignite click. */
function SimDriver({ sim, clock }: { sim: FireSim | null; clock?: { elapsed: number } }) {
  useFrame((_, delta) => {
    if (!sim) return
    // Clamp so a backgrounded tab does not resume with one enormous step.
    const dt = Math.min(delta, 0.1)
    sim.tick(dt)
    if (clock) clock.elapsed += dt
  })
  return null
}

/**
 * The fire's contribution to the scene lighting.
 *
 * Emissive material plus a bloom pass makes a glowing object, not a fire:
 * nothing around it changes. These lights are what put orange onto the terrain
 * and onto the unburnt trees beside the front, which is most of the difference
 * between "the trees are lit up" and "the forest is on fire".
 *
 * The pool is a FIXED size for the life of the scene and idle lights are driven
 * to zero intensity rather than unmounted. Adding or removing a light changes
 * three's NUM_POINT_LIGHTS define, which recompiles every material in the
 * scene; doing that as the fire grows would hitch exactly when the most is
 * happening on screen. None cast shadows: six shadow-casting lights would cost
 * six extra shadow passes a frame for an effect the key light already gives.
 */
function FireLights({ forest, sim }: { forest: Forest; sim: FireSim | null }) {
  const group = useRef<THREE.Group>(null)

  // Targets are plain numbers rather than Vector3s so this allocates nothing
  // per frame; the lights themselves are found by walking the group's children
  // rather than through an array of refs, which keeps mounting and updating
  // from having to agree about indices.
  const targets = useMemo(
    () => Array.from({ length: FIRE_LIGHT.count }, () => ({
      x: 0, y: 0, z: 0, intensity: 0, placed: false,
    })),
    [],
  )
  const sinceRetarget = useRef(0)

  useFrame((_, rawDelta) => {
    const g = group.current
    if (!g || !sim) return
    const delta = Math.min(rawDelta, 0.1)

    sinceRetarget.current += delta
    if (sinceRetarget.current >= FIRE_LIGHT.retargetSeconds) {
      sinceRetarget.current = 0
      retarget(forest, sim, targets)
    }

    // Lights glide toward their targets rather than snapping. Framing the
    // approach as 1 - exp(-rate * dt) keeps the motion frame-rate independent,
    // which a raw lerp(a, b, rate * dt) would not be.
    const k = 1 - Math.exp(-FIRE_LIGHT.followRate * delta)
    for (let i = 0; i < g.children.length; i++) {
      const light = g.children[i] as THREE.PointLight
      const t = targets[i]
      if (!t) continue
      if (t.placed) {
        // A light with nothing to light keeps its last position while it fades,
        // so it dims in place instead of sliding across the diorama.
        light.position.x += (t.x - light.position.x) * k
        light.position.y += (t.y - light.position.y) * k
        light.position.z += (t.z - light.position.z) * k
      }
      light.intensity += (t.intensity - light.intensity) * k
    }
  })

  return (
    <group ref={group}>
      {Array.from({ length: FIRE_LIGHT.count }, (_, i) => (
        <pointLight
          key={i}
          color={FIRE_LIGHT.color}
          intensity={0}
          distance={FIRE_LIGHT.distance}
          decay={FIRE_LIGHT.decay}
        />
      ))}
    </group>
  )
}

/**
 * Point each light at a hot cluster of burning cells.
 *
 * Greedy seed-and-claim rather than a real clustering pass: take the hottest
 * unclaimed cell, absorb everything within clusterRadius of it into that
 * light's cluster, repeat for the next light. It is O(burning * count) with
 * count fixed at six, needs no iteration to converge, and above all is STABLE
 * frame to frame, which k-means from a random seed is not. An unstable
 * assignment has lights trading places between frames and the whole diorama
 * strobes.
 */
function retarget(
  forest: Forest,
  sim: FireSim,
  targets: Array<{ x: number; y: number; z: number; intensity: number; placed: boolean }>,
): void {
  const hot: Array<{ x: number; y: number; z: number; w: number }> = []
  for (const cell of forest.cells) {
    if (sim.states[cell.id] !== BURNING) continue
    const w = burnIntensity(sim.progress[cell.id] ?? 0)
    if (w <= 0.01) continue
    hot.push({ x: cell.position[0], y: cell.position[1], z: cell.position[2], w })
  }
  hot.sort((a, b) => b.w - a.w)

  const claimed = new Uint8Array(hot.length)
  const sepSq = FIRE_LIGHT.clusterRadius * FIRE_LIGHT.clusterRadius
  let next = 0

  for (const target of targets) {
    while (next < hot.length && claimed[next]) next++
    if (next >= hot.length) { target.intensity = 0; continue }

    // Weighted centroid of the seed and its neighbours, so the light sits in
    // the middle of a burning patch rather than on whichever single cell
    // happened to sort first.
    const s = hot[next]!
    let sx = 0, sy = 0, sz = 0, sw = 0
    for (let h = next; h < hot.length; h++) {
      if (claimed[h]) continue
      const c = hot[h]!
      const dx = c.x - s.x
      const dz = c.z - s.z
      if (dx * dx + dz * dz > sepSq) continue
      claimed[h] = 1
      sx += c.x * c.w; sy += c.y * c.w; sz += c.z * c.w; sw += c.w
    }
    if (sw <= 0) { target.intensity = 0; continue }

    target.x = sx / sw
    target.y = sy / sw + FIRE_LIGHT.lift
    target.z = sz / sw
    target.placed = true
    // Saturating rather than linear in cluster weight: a 40-cell blaze should
    // be brighter than a 4-cell one but not ten times brighter, or a mature
    // fire blows out the whole slab.
    target.intensity = FIRE_LIGHT.intensity * (1 - Math.exp(-sw / FIRE_LIGHT.weightScale))
  }
}

function Lighting() {
  return (
    <>
      <ambientLight color={LIGHTS.ambient.color} intensity={LIGHTS.ambient.intensity} />
      <directionalLight
        color={LIGHTS.key.color}
        intensity={LIGHTS.key.intensity}
        position={LIGHTS.key.position as unknown as [number, number, number]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={1}
        shadow-camera-far={300}
        shadow-bias={-0.0004}
        shadow-normalBias={0.8}
      />
      <directionalLight
        color={LIGHTS.fill.color}
        intensity={LIGHTS.fill.intensity}
        position={LIGHTS.fill.position as unknown as [number, number, number]}
      />
    </>
  )
}

/** Terrain surface plus the cut sides that make the slab read as a model. */
function Slab({
  terrain, forest, sim,
}: { terrain: TerrainField; forest: Forest; sim: FireSim | null }) {
  const { surface, sides } = useMemo(() => buildDiorama(terrain), [terrain])
  useEffect(() => () => { surface.dispose(); sides.dispose() }, [surface, sides])

  const scorch = useMemo(() => new ScorchMap(terrain.size), [terrain])
  useEffect(() => () => scorch.dispose(), [scorch])

  const surfaceMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
    })
    applyScorch(m, scorch, terrain.size)
    return m
  }, [scorch, terrain])
  useEffect(() => () => surfaceMat.dispose(), [surfaceMat])

  // Stamp the scar only when a cell newly chars, never per frame: the upload
  // is the expensive part and charring is rare relative to the frame rate.
  const stamped = useRef<Set<number>>(new Set())
  useEffect(() => { stamped.current = new Set(); scorch.clear() }, [scorch])
  useFrame((_, rawDelta) => {
    if (!sim) return
    for (const cell of forest.cells) {
      if (sim.states[cell.id] !== CHARRED || stamped.current.has(cell.id)) continue
      stamped.current.add(cell.id)
      scorch.stamp(cell.position[0], cell.position[2])
    }
    // Cooling runs every frame so the trailing edge fades smoothly. It sweeps
    // only the rect that currently holds heat, and costs nothing once the last
    // of it has gone out.
    scorch.decayHeat(Math.min(rawDelta, 0.1))
  })

  return (
    <group>
      <mesh geometry={surface} material={surfaceMat} castShadow receiveShadow />
      <mesh geometry={sides} receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={1} metalness={0} />
      </mesh>
    </group>
  )
}

/**
 * Boulders and fallen logs, two instanced draw calls. Decorative only: they
 * carry no fuel and the simulation never sees them.
 */
function Scatter({
  terrain, forest, seed,
}: { terrain: TerrainField; forest: Forest; seed: number }) {
  const props = useMemo(
    () => generateScatter(terrain, forest, mulberry32(seed ^ 0x5ca7)),
    [terrain, forest, seed],
  )
  const boulders = useMemo(() => props.filter((p) => p.kind === 'boulder'), [props])
  const logs = useMemo(() => props.filter((p) => p.kind === 'log'), [props])
  return (
    <>
      <PropGroup items={boulders} kind="boulder" />
      <PropGroup items={logs} kind="log" />
    </>
  )
}

function PropGroup({ items, kind }: { items: ScatterProp[]; kind: 'boulder' | 'log' }) {
  const ref = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => {
    if (kind === 'boulder') {
      // Detail 0 keeps the facets big, matching the low-poly terrain.
      const g = new THREE.IcosahedronGeometry(1, 0)
      g.scale(1, 0.72, 1)
      return g
    }
    const g = new THREE.CylinderGeometry(0.34, 0.42, 3.4, 6)
    g.rotateZ(Math.PI / 2) // lay it on its side
    return g
  }, [kind])
  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    items.forEach((p, i) => {
      e.set(p.tilt, p.spin, p.tilt * 0.5)
      q.setFromEuler(e)
      pos.set(p.position[0], p.position[1] + (kind === 'boulder' ? 0.35 : 0.3) * p.scale, p.position[2])
      scl.setScalar(p.scale)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, kind])

  const color = kind === 'boulder' ? CLIFF_COLOR : TRUNK.color
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, Math.max(items.length, 1)]}
      castShadow
      receiveShadow
      frustumCulled={false}
      count={items.length}
    >
      <meshStandardMaterial color={color} flatShading roughness={0.95} metalness={0} />
    </instancedMesh>
  )
}

/** Flat translucent sheet at the terrain's water level. */
function Water({ terrain }: { terrain: TerrainField }) {
  // A waterfall spilling off the cut edge was built and dropped: the geometry
  // was correct (verified by rendering it with a plain material) but its
  // ShaderMaterial took the whole frame down with no console error, under a
  // controlled single-variable toggle. The flat sheet stands on its own, and a
  // page that renders nothing is far worse than one without a waterfall.
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, terrain.waterLevel, 0]}>
      <planeGeometry args={[terrain.size, terrain.size]} />
      <meshStandardMaterial
        color={WATER.color}
        transparent
        opacity={WATER.opacity}
        roughness={0.15}
        metalness={0.1}
      />
    </mesh>
  )
}

/**
 * One instanced mesh per species per part (foliage, trunk): four draw calls for
 * the whole grove. Burn state rides on a custom per-instance attribute that the
 * standard material's shader is patched to read, so colour, emissive and
 * foliage shrink all come from one number per tree.
 */
function Trees(props: SceneProps & { terrain: TerrainField }) {
  return (
    <>
      <SpeciesGroup {...props} species="conifer" />
      <SpeciesGroup {...props} species="hardwood" />
    </>
  )
}

function SpeciesGroup({
  terrain, forest, sim, seed, species, onIgnite, wind,
}: SceneProps & { species: Species }) {
  const foliageRef = useRef<THREE.InstancedMesh>(null)
  const trunkRef = useRef<THREE.InstancedMesh>(null)

  // Per-tree fixed variation, derived once from the seed so a world reproduces.
  const trees = useMemo(() => {
    const rng = mulberry32(seed ^ (species === 'conifer' ? 0x9e37 : 0x85eb))
    let minH = Infinity
    let maxH = -Infinity
    for (const h of terrain.heightmap) {
      if (h < minH) minH = h
      if (h > maxH) maxH = h
    }
    const span = Math.max(maxH - minH, 1e-6)
    return forest.cells
      .filter((c) => c.species === species)
      .map((cell) => {
        const snow = (cell.position[1] - minH) / span > FOLIAGE.snowAbove
        return {
          cell,
          height: BASE_TREE_HEIGHT * (1 + range(rng, -TREE_JITTER.height, TREE_JITTER.height)),
          radius: 1 + range(rng, -TREE_JITTER.radius, TREE_JITTER.radius),
          tiltX: range(rng, -TREE_JITTER.tiltRad, TREE_JITTER.tiltRad),
          tiltZ: range(rng, -TREE_JITTER.tiltRad, TREE_JITTER.tiltRad),
          spin: range(rng, 0, Math.PI * 2),
          hue: rng(),
          snow,
        }
      })
  }, [forest, species, seed, terrain])

  const foliageGeo = useMemo(() => buildFoliage(species, mulberry32(seed + 17)), [species, seed])
  const trunkGeo = useMemo(() => buildTrunk(species), [species])

  const burnAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(trees.length, 1)), 1),
    [trees.length],
  )

  // Per-tree random phase so flicker and crack pulsing do not lock-step across
  // the grove. Written once, alongside the burn attribute: both live on the
  // geometries (not the material) because that is where three looks up
  // per-instance attributes for an InstancedMesh.
  const seedAttr = useMemo(() => {
    const arr = new Float32Array(Math.max(trees.length, 1))
    const rng = mulberry32(seed ^ (species === 'conifer' ? 0x51ed : 0xc0ffee))
    for (let i = 0; i < arr.length; i++) arr[i] = rng()
    return new THREE.InstancedBufferAttribute(arr, 1)
  }, [trees.length, seed, species])

  // The shader reads burn state and per-tree seed from these per-instance
  // attributes, so they have to live on the geometries themselves, not on the
  // material.
  useLayoutEffect(() => {
    foliageGeo.setAttribute('aBurn', burnAttr)
    trunkGeo.setAttribute('aBurn', burnAttr)
    foliageGeo.setAttribute('aSeed', seedAttr)
    trunkGeo.setAttribute('aSeed', seedAttr)
  }, [foliageGeo, trunkGeo, burnAttr, seedAttr])

  // Static transforms and base colours, written once per world.
  useLayoutEffect(() => {
    const fol = foliageRef.current
    const trk = trunkRef.current
    if (!fol || !trk) return

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const color = new THREE.Color()
    const green = new THREE.Color()
    const a = new THREE.Color(species === 'conifer' ? FOLIAGE.coniferA : FOLIAGE.hardwoodA)
    const b = new THREE.Color(species === 'conifer' ? FOLIAGE.coniferB : FOLIAGE.hardwoodB)
    const snowColor = new THREE.Color(FOLIAGE.snow)
    const trunkColor = new THREE.Color(TRUNK.color)

    trees.forEach((t, i) => {
      e.set(t.tiltX, t.spin, t.tiltZ)
      q.setFromEuler(e)
      pos.set(t.cell.position[0], t.cell.position[1], t.cell.position[2])

      scl.set(t.radius * t.height, t.height, t.radius * t.height)
      m.compose(pos, q, scl)
      fol.setMatrixAt(i, m)

      scl.set(t.height, t.height, t.height)
      m.compose(pos, q, scl)
      trk.setMatrixAt(i, m)

      green.copy(a).lerp(b, t.hue)
      color.copy(green)
      if (t.snow) color.lerp(snowColor, 0.35)
      fol.setColorAt(i, color)
      trk.setColorAt(i, trunkColor)
    })

    fol.instanceMatrix.needsUpdate = true
    trk.instanceMatrix.needsUpdate = true
    if (fol.instanceColor) fol.instanceColor.needsUpdate = true
    if (trk.instanceColor) trk.instanceColor.needsUpdate = true
    fol.computeBoundingSphere()
    trk.computeBoundingSphere()
  }, [trees, species])

  // Seconds each charred tree has been cooling, normalised 0..1 over
  // BURN.emberCoolSeconds. Kept here rather than derived from the sim because
  // the sim has no notion of it: progress stops dead at 1 when a cell chars.
  const afterglow = useMemo(() => new Float32Array(Math.max(trees.length, 1)), [trees.length])

  // Per-frame: push burn progress into the instance attribute.
  useFrame((_, rawDelta) => {
    if (!sim) return
    const delta = Math.min(rawDelta, 0.1)
    const arr = burnAttr.array as Float32Array
    let changed = false
    trees.forEach((t, i) => {
      const state = sim.states[t.cell.id]
      let p: number
      if (state === CHARRED) {
        // Past 1 the attribute stops meaning "burn progress" and starts
        // meaning "how long ago this finished burning". Every consumer of
        // vBurn already saturates at 1 (the phase curve settles to its
        // smoulder level, the front and the shrink are long since clamped),
        // so the extra range costs nothing and the ember cracks get the one
        // signal they need in order to go out.
        afterglow[i] = Math.min(1, afterglow[i]! + delta / BURN.emberCoolSeconds)
        p = 1 + afterglow[i]!
      } else {
        afterglow[i] = 0
        p = state === BURNING ? sim.progress[t.cell.id]! : 0
      }
      if (arr[i] !== p) { arr[i] = p; changed = true }
    })
    if (changed) burnAttr.needsUpdate = true
  })

  const count = Math.max(trees.length, 1)

  return (
    <group>
      <instancedMesh
        ref={foliageRef}
        args={[foliageGeo, undefined, count]}
        castShadow
        receiveShadow
        frustumCulled={false}
        onClick={(e) => {
          if (e.instanceId === undefined) return
          const tree = trees[e.instanceId]
          if (!tree) return
          e.stopPropagation()
          onIgnite?.(tree.cell.id)
        }}
      >
        <BurnMaterial shrink windSpeed={wind.speed} />
      </instancedMesh>
      <instancedMesh
        ref={trunkRef}
        args={[trunkGeo, undefined, count]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <BurnMaterial shrink={false} windSpeed={wind.speed} />
      </instancedMesh>
    </group>
  )
}

/**
 * Trunks slump much less than foliage crowns at full char: the wood keeps
 * its shape structurally while the burnt-out canopy above sags. This is a
 * fixed ratio, not art direction that needs retuning per world, so it stays
 * a local constant rather than a BURN token.
 */
const TRUNK_SETTLE_FACTOR = 0.15

/**
 * A standard material patched to read per-instance burn state and turn it
 * into a tree that is never one flat colour.
 *
 * The old version applied a single scalar uniformly to every fragment: a
 * whole tree flashed from orange to black together, because nothing in the
 * shader knew *where* on the tree a fragment was. The fix rides on a fact
 * that was already true and unused: geometry is built to unit height with
 * its base at y = 0 (trees.ts), so the raw `position.y` attribute IS the
 * 0..1 height fraction with no extra vertex data needed. Comparing that
 * against `burnFront(vBurn)` (from burnShading.ts) turns the burn into a
 * line climbing the tree: green canopy above it, a hot blackbody front at
 * it, cooling char below it.
 *
 * Foliage shrinks toward its base and settles (slumps) as it chars; the
 * trunk keeps its shape and settles far less. Doing this in the shader
 * keeps the whole grove at one draw call per part rather than needing a
 * material per burn stage.
 */
function burnMaterialImpl(shrink: boolean) {
  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.85,
    metalness: 0,
  })

  const f = (n: number) => n.toFixed(4)

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    shader.uniforms.uWindSpeed = { value: 0 }
    ;(mat.userData as { shader?: THREE.WebGLProgramParametersWithUniforms }).shader = shader

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aBurn;
         attribute float aSeed;
         varying float vBurn;
         varying float vSeed;
         varying float vHeight;
         varying vec3 vObjPos;

         // Rodrigues' rotation formula: rotate v about a unit axis through
         // the origin. The tree base sits at the origin in object space
         // (trees.ts normalises to y = 0), so rotating "transformed" about
         // an axis through the origin pivots the whole tree from its base
         // for free, with no separate translate-rotate-translate dance.
         vec3 rotateAxisAngle(vec3 v, vec3 axis, float angle) {
           float s = sin(angle);
           float c = cos(angle);
           return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
         }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vBurn = aBurn;
         vSeed = aSeed;
         vHeight = position.y;
         vObjPos = position;

         // Foliage shrink starts early (0.15) so the crown is visibly
         // thinning well before it fully chars; kept as it was, it read
         // correctly and item 1/3 below did not touch it.
         ${shrink
           ? `float shrinkF = mix(1.0, ${f(BURN.charredFoliageScale)}, smoothstep(0.15, 1.0, aBurn));
              transformed *= shrinkF;`
           : ''}

         // Structural slump: starts once the front has reached the crown
         // (flashEnd) rather than at first ignition, so the tree still
         // reads as "on fire, upright" through the flash and only sags as
         // it is actually consumed. Direction is per-tree (aSeed) so a
         // whole grove does not slump toward the same side, which read as
         // wind rather than as collapse when first tried with a fixed axis.
         float settleAmt = smoothstep(${f(BURN.flashEnd)}, 1.0, aBurn);
         float settleMag = ${f(BURN.settleRad)} * settleAmt * (0.4 + 0.6 * aSeed)
           * ${shrink ? '1.0' : f(TRUNK_SETTLE_FACTOR)};
         float settleDir = aSeed * 6.28318530718;
         vec3 settleAxis = normalize(vec3(cos(settleDir), 0.0, sin(settleDir)));
         transformed = rotateAxisAngle(transformed, settleAxis, settleMag);`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uWindSpeed;
         varying float vBurn;
         varying float vSeed;
         varying float vHeight;
         varying vec3 vObjPos;
         ${BURN_SHADING_GLSL}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         vec3 ash = ${glslColor(BURN.ramp.ash)};

         // --- preheat: dry, dull, no flame yet -------------------------
         // Desaturate toward a dry yellow-brown so ignition reads as having
         // a cause (the tree visibly dries out) rather than jumping
         // straight from green to fire. Faded back out once burnT (below)
         // says this fragment is actually alight or already past.
         float preheatT = smoothstep(0.0, ${f(BURN.preheatEnd)}, vBurn);
         float gray = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
         // Desaturate PART of the way toward a dry brown and darken slightly,
         // rather than replacing the colour with a grey. Mixing to vec3(gray)
         // at full strength threw the foliage hue away entirely and every tree
         // ahead of the front read as snow-covered rather than as drying out.
         vec3 dry = mix(gl_FragColor.rgb, vec3(gray), 0.55) * vec3(0.95, 0.82, 0.58);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, dry, preheatT * ${f(BURN.preheatTint)});

         // --- height-driven front (item 1) -----------------------------
         // d > 0: above the front, still green. d < 0: at or below it.
         // burnT sweeps 0 -> 1 across one frontBand of height, so the
         // transition is a moving line with soft edges, not a hard clip.
         float front = burnFront(vBurn);
         float d = (vHeight - front) / ${f(BURN.frontBand)};
         float burnT = 1.0 - smoothstep(0.0, 1.0, d);
         preheatT *= (1.0 - burnT); // preheat tint only where still unburned

         // --- blackbody ramp + phase curve (items 2 and 4) -------------
         // "heat" peaks exactly at the front (|d| small) and is scaled by
         // the shared four-act intensity curve, so a fragment right at the
         // climbing line during the crown-flash act is the single hottest
         // point on the tree, and the same fragment during smoulder (front
         // long past, act intensity low) is dim even though d is unchanged.
         float intensity = burnIntensity(vBurn);
         // Squared falloff rather than linear: with a linear ramp the whole
         // front band sat near 1.0 and tone-mapped to a flat white blob. This
         // keeps the white cap to the very centre of the front, which is what
         // makes it read as heat rather than as blown-out exposure.
         float prox = clamp(1.0 - abs(d), 0.0, 1.0);
         float heat = prox * prox * intensity;

         // --- ember cracks in the char (item 3) -------------------------
         // Object-space position is identical across instances (shared
         // geometry), so it is offset by the per-tree seed before hashing;
         // without that every burning tree in the grove would crack in the
         // exact same places. Thresholded noise picks a minority of the
         // char as veins; those pulse and only fade partway through the
         // smoulder act rather than to zero, so the aftermath keeps
         // visible embers instead of ever going solid black.
         vec3 crackP = vObjPos * ${f(BURN.crackScale)} + vec3(vSeed * 133.7, vSeed * 71.3, uTime * 0.05);
         float crackN = noise3(crackP);
         float crack = step(${f(BURN.crackThreshold)}, crackN);
         float pulse = 0.6 + 0.4 * sin(uTime * ${f(BURN.crackPulseHz * 6.28318530718)} + vSeed * 17.0);
         float smoulderT = smoothstep(${f(BURN.sustainEnd)}, 1.0, vBurn);
         float belowFront = clamp(-d, 0.0, 1.0);
         // Scaled well below 1: a crack is a glowing vein of charcoal, not a
         // flame core. Left at full strength every crack fragment reached the
         // white end of the blackbody ramp and the char read as white blobs.
         // Afterglow: vBurn keeps climbing past 1 once the cell has charred,
         // so this is time since the fire went out, not burn progress.
         // Without it smoulderT saturates the moment a tree chars and the
         // veins pulse at the same brightness forever, leaving a burnt-out
         // forest permanently lit.
         float cooled = clamp(vBurn - 1.0, 0.0, 1.0);
         float emberLife = mix(1.0, ${f(BURN.emberFloor)}, cooled);
         float crackHeat = crack * pulse * mix(1.0, 0.5, smoulderT) * emberLife
           * step(0.001, belowFront) * ${f(BURN.crackHeat)};

         // --- multi-octave flicker, per-instance phase (item 6) --------
         // Two sines at different rate and per-tree phase (vSeed), summed,
         // instead of one sine keyed off gl_FragCoord.x: the old version
         // flickered every tree in lock-step because screen position, not
         // instance identity, was the only source of variation.
         float flicker = 1.0
           + ${f(BURN.flickerDepth * 0.6)} * sin(uTime * ${f(BURN.flickerHz)} + vSeed * 41.0)
           + ${f(BURN.flickerDepth * 0.4)} * sin(uTime * ${f(BURN.flickerHz * 2.3)} + vSeed * 7.0 + vHeight * 3.0);

         // The slow wind-driven surge, shared with the flame billboards so the
         // whole fire breathes on one clock.
         flicker *= gust(uTime, uWindSpeed);

         float temp = clamp(max(heat, crackHeat), 0.0, 1.0);
         vec3 hot = blackbody(temp) * ${f(BURN.emissivePeak)} * flicker;
         // Char first (the tree darkens wherever the front has passed), then
         // heat added on top. Mixing toward the hot colour instead let a
         // bright crack wipe out the char under it and the aftermath lost
         // its shape.
         gl_FragColor.rgb = mix(gl_FragColor.rgb, ash, burnT);
         gl_FragColor.rgb += hot * temp;`,
      )
  }

  // Foliage (shrink: true) and trunk (shrink: false) look identical to
  // three's program cache (same material parameters; the difference is
  // baked into shader SOURCE via the ternaries above, which the cache never
  // hashes). Without a distinct key here they silently share one compiled
  // program and one of the two loses its shrink/settle behaviour. See the
  // matching note at diorama.ts:322 for the same failure mode elsewhere.
  mat.customProgramCacheKey = () => `burn-${shrink ? 'foliage' : 'trunk'}`

  return mat
}

/** Thin React wrapper so the patched material can be declared as JSX. */
function BurnMaterial({ shrink, windSpeed }: { shrink: boolean; windSpeed: number }) {
  const mat = useMemo(() => burnMaterialImpl(shrink), [shrink])
  useFrame((state) => {
    const shader = (mat.userData as { shader?: THREE.WebGLProgramParametersWithUniforms }).shader
    if (!shader) return
    shader.uniforms.uTime!.value = state.clock.elapsedTime
    shader.uniforms.uWindSpeed!.value = windSpeed
  })
  useEffect(() => () => mat.dispose(), [mat])
  return <primitive object={mat} attach="material" />
}

