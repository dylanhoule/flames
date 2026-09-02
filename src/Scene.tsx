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
  BACKDROP, BURN, CAMERA, CLIFF_COLOR, FOLIAGE, LIGHTS, POST, TREE_JITTER, TRUNK, WATER,
} from './visual'

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
  useFrame(() => {
    if (!sim) return
    for (const cell of forest.cells) {
      if (sim.states[cell.id] !== CHARRED || stamped.current.has(cell.id)) continue
      stamped.current.add(cell.id)
      scorch.stamp(cell.position[0], cell.position[2])
    }
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
  terrain, forest, sim, seed, species, onIgnite,
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

  // The shader reads burn state from this per-instance attribute, so it has to
  // live on the geometries themselves, not on the material.
  useLayoutEffect(() => {
    foliageGeo.setAttribute('aBurn', burnAttr)
    trunkGeo.setAttribute('aBurn', burnAttr)
  }, [foliageGeo, trunkGeo, burnAttr])

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

  // Per-frame: push burn progress into the instance attribute.
  useFrame(() => {
    if (!sim) return
    const arr = burnAttr.array as Float32Array
    let changed = false
    trees.forEach((t, i) => {
      const state = sim.states[t.cell.id]
      const p = state === CHARRED ? 1 : state === BURNING ? sim.progress[t.cell.id]! : 0
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
        <BurnMaterial shrink />
      </instancedMesh>
      <instancedMesh
        ref={trunkRef}
        args={[trunkGeo, undefined, count]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <BurnMaterial shrink={false} />
      </instancedMesh>
    </group>
  )
}

/**
 * A standard material patched to read a per-instance burn value.
 *
 * Foliage shrinks toward its base and drives to ember emissive as it burns,
 * then collapses to a charred stub; the trunk keeps its shape and just darkens.
 * Doing this in the shader keeps the whole grove at one draw call per part
 * rather than needing a material per burn stage.
 */
function burnMaterialImpl(shrink: boolean) {
  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.85,
    metalness: 0,
  })

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    ;(mat.userData as { shader?: THREE.WebGLProgramParametersWithUniforms }).shader = shader

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aBurn;
         varying float vBurn;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vBurn = aBurn;
         ${shrink
           ? `float shrinkF = mix(1.0, ${BURN.charredFoliageScale.toFixed(3)}, smoothstep(0.15, 1.0, aBurn));
              transformed *= shrinkF;`
           : ''}`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         varying float vBurn;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         vec3 ember = vec3(${hexToGlsl(BURN.ember)});
         vec3 emberHot = vec3(${hexToGlsl(BURN.emberHot)});
         vec3 ash = vec3(${hexToGlsl(BURN.ash)});

         float ignite = smoothstep(0.0, ${BURN.ignitionRamp.toFixed(3)}, vBurn);
         float dying = smoothstep(0.55, 1.0, vBurn);
         float flicker = 1.0 + ${BURN.flickerDepth.toFixed(3)} *
           sin(uTime * ${BURN.flickerHz.toFixed(3)} + vBurn * 41.0 + gl_FragCoord.x * 0.01);

         vec3 hot = mix(ember, emberHot, 0.35) * ${BURN.emissivePeak.toFixed(3)} * flicker;
         vec3 burnt = mix(hot, ash, dying);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, burnt, ignite);`,
      )
  }

  return mat
}

/** #rrggbb -> "r.rrr, g.ggg, b.bbb" for inlining into GLSL. */
function hexToGlsl(hex: string): string {
  const c = new THREE.Color(hex)
  return `${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}`
}

/** Thin React wrapper so the patched material can be declared as JSX. */
function BurnMaterial({ shrink }: { shrink: boolean }) {
  const mat = useMemo(() => burnMaterialImpl(shrink), [shrink])
  useFrame((state) => {
    const shader = (mat.userData as { shader?: THREE.WebGLProgramParametersWithUniforms }).shader
    if (shader) shader.uniforms.uTime!.value = state.clock.elapsedTime
  })
  useEffect(() => () => mat.dispose(), [mat])
  return <primitive object={mat} attach="material" />
}

