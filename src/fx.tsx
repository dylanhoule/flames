import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FireSim, Forest, Wind } from './types'
import { BURNING, CHARRED } from './types'
import { FLAME, EMBERS, SMOKE } from './visual'
import { NOISE_GLSL, BURN_PHASE_GLSL, BURN_SHADING_GLSL, burnIntensity } from './burnShading'

/**
 * Fire effects: smoke columns, flame billboards and ember sparks.
 *
 * All three are single instanced quads per element, oriented to face the
 * camera in the vertex shader rather than on the CPU, so the whole grove
 * costs three draw calls no matter how many cells are alight.
 *
 * Smoke and flames are now BOTH wind-legible: smoke plumes lean along the
 * wind vector as before, and flames shear in the same direction, tip trailing
 * further than base. That is the fix for the fire reading as a decal stuck on
 * a tree: before this pass `Flames` never even received `wind`.
 *
 * Flames, embers and the tree material all read `burnIntensity`/`blackbody`
 * from burnShading.ts, so they peak together instead of each inventing its
 * own smoothstep and drifting out of sync.
 */

// ------------------------------------------------------------- tuning knobs
// Grouped here because they are budget decisions as much as aesthetic ones:
// at peak burn roughly 90 of 150 cells are alight, and every constant below
// multiplies against that.

/** Puffs per burning cell. */
const PUFFS_PER_CELL = 3
/** Seconds for one puff to travel its full rise and fade out. */
const PUFF_LIFETIME = 3.2
/** How strongly wind pushes a puff sideways, world units per (m/s) per second. */
const SMOKE_DRIFT = 0.55

/**
 * Sparks spawned per second by one fully-lit (burnIntensity == 1) burning
 * cell. Chosen so that at peak burn (~90 cells alight, average intensity
 * well under 1 because most of those cells are in the sustained/smoulder
 * acts, not the crown flash) the steady-state population of concurrently
 * active sparks (spawnRate * EMBERS.lifetime) lands comfortably under
 * EMBERS.maxCount rather than constantly slamming the ring buffer. The ring
 * buffer is a hard backstop either way, so this only has to be roughly right.
 */
const SPARK_SPAWN_RATE = 3

/** Post-multiply on ember colour so sparks clear POST.bloomThreshold (1.0). */
const EMBER_BRIGHTNESS = 2.2
/** Post-multiply on flame colour, same reason. */
const FLAME_BRIGHTNESS = 1.15

/** Deterministic pseudo-random in [0, 1) from an index, no Math.random. */
const frac = (x: number) => x - Math.floor(x)

export interface FxProps {
  forest: Forest
  sim: FireSim | null
  wind: Wind
}

export function FireEffects({ forest, sim, wind }: FxProps) {
  return (
    <>
      <Smoke forest={forest} sim={sim} wind={wind} />
      <Flames forest={forest} sim={sim} wind={wind} />
      <Embers forest={forest} sim={sim} wind={wind} />
    </>
  )
}

/**
 * A unit quad in the XY plane, billboarded in the shader.
 *
 * `aOffset` is the instance's world anchor, `aData` carries (seed, scale) and
 * `aAge` is written every frame. Keeping age on its own attribute means the
 * per-frame upload is one float per instance.
 */
function billboardGeometry(count: number) {
  // Built by hand rather than borrowed from a PlaneGeometry: taking another
  // geometry's attributes and then disposing it frees the GPU buffers these
  // still point at, which kills the whole frame with no console error.
  // The quad spans y 0..1 so it grows upward from its anchor, which is what a
  // flame wants, and uv.y doubles as height along the flame.
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3),
  )
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  geo.instanceCount = count
  return geo
}

/**
 * Shared vertex shader: expand a unit quad toward the camera, then shear it
 * by the wind.
 *
 * `uWindLean` is a world-space vector (already scaled to world units of TIP
 * displacement, i.e. speed * a per-system lean constant baked in on the CPU
 * side). It is projected into view space with the same rotation the billboard
 * itself uses, and its contribution grows with uv.y^2 so the tip trails much
 * further than the base, which is what makes a flame or puff read as leaning
 * rather than merely offset. Systems that already bake wind into their
 * per-instance position (the ember ring buffer) just leave this at (0, 0).
 */
const BILLBOARD_VERT = /* glsl */ `
  ${BURN_PHASE_GLSL}
  attribute vec3 aOffset;
  attribute vec2 aData;   // x: per-instance seed, y: base scale
  attribute float aAge;   // 0..1 normalised lifetime, <0 means inactive
  uniform vec2 uWindLean;
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;

  void main() {
    vUv = uv;
    vAge = aAge;
    vSeed = aData.x;

    if (aAge < 0.0) {
      // Park unused instances behind the camera rather than drawing degenerate
      // quads, which is cheaper than resizing buffers as the fire grows.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float scale = aData.y * SCALE_CURVE;
    vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
    mv.xy += position.xy * scale;

    vec3 windView = mat3(modelViewMatrix) * vec3(uWindLean.x, 0.0, uWindLean.y);
    mv.xy += windView.xy * (uv.y * uv.y);

    gl_Position = projectionMatrix * mv;
  }
`

function vertexShader(scaleCurve: string) {
  return BILLBOARD_VERT.replace('SCALE_CURVE', scaleCurve)
}

function Smoke({ forest, sim, wind }: FxProps) {
  const count = forest.cells.length * PUFFS_PER_CELL
  const ref = useRef<THREE.Mesh>(null)

  const { geometry, material, offset, age } = useMemo(() => {
    const geometry = billboardGeometry(count)
    const offset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const data = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)
    const age = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1), 1)

    for (let i = 0; i < count; i++) {
      const seed = (i * 0.6180339887) % 1
      // Per-puff size jitter (part of "growth so puffs are not identical
      // discs"): the vertex scale curve still expands every puff as it ages,
      // but they no longer all expand from and to the same base size.
      data.setXY(i, seed, 1.3 + frac(seed * 7.0) * 0.8)
    }
    geometry.setAttribute('aOffset', offset)
    geometry.setAttribute('aData', data)
    geometry.setAttribute('aAge', age)

    const material = new THREE.ShaderMaterial({
      transparent: true,
      // Smoke occludes rather than glows, so normal alpha, and no depth write
      // so overlapping puffs do not carve holes in each other.
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uFreshColor: { value: new THREE.Color(SMOKE.freshColor) },
        uColor: { value: new THREE.Color(SMOKE.color) },
        uUnderlitColor: { value: new THREE.Color(SMOKE.underlitColor) },
        uOpacity: { value: SMOKE.opacity },
        uWindLean: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: vertexShader('(0.6 + aAge * 2.4)'),
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform vec3 uFreshColor;
        uniform vec3 uColor;
        uniform vec3 uUnderlitColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vAge;
        varying float vSeed;

        void main() {
          // Per-puff rotation, so noise-perturbed silhouettes do not all sit
          // at the same angle. Rotation only affects shape (below); the
          // underlight test further down deliberately stays in unrotated
          // screen space, because "lower face" means lower on screen.
          float ang = vSeed * 6.2831853;
          vec2 c = vUv - 0.5;
          float ca = cos(ang), sa = sin(ang);
          vec2 cr = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
          float d = length(cr);
          float edge = 0.5 - 0.22 * noise((cr + 0.5) * 5.0 + vSeed * 37.0);
          float mask = smoothstep(edge, 0.0, d);
          // Fade in quickly, then out over the rest of the life.
          float fade = smoothstep(0.0, 0.10, vAge) * (1.0 - smoothstep(0.18, 0.75, vAge));
          float a = mask * fade * uOpacity;
          if (a < 0.004) discard;

          // Dark and dense fresh off the fire, lightening toward the cooled
          // colour as the puff rises and ages.
          vec3 col = mix(uFreshColor, uColor, smoothstep(0.0, 0.6, vAge));
          // Underlight the lower face of a YOUNG puff with the fire beneath
          // it: 1 at the bottom edge fading to 0 by mid-height, and only
          // while the puff is still close to its source.
          float lower = 1.0 - smoothstep(-0.5, 0.1, c.y);
          float young = 1.0 - smoothstep(0.0, 0.4, vAge);
          col = mix(col, uUnderlitColor, lower * young * mask * 0.55);

          gl_FragColor = vec4(col, a);
        }
      `,
    })
    return { geometry, material, offset, age }
  }, [count])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  // Per-cell emission clock, so puffs stagger instead of pulsing in unison.
  const clocks = useMemo(() => new Float32Array(forest.cells.length), [forest])
  const linger = useMemo(() => new Float32Array(forest.cells.length), [forest])

  useFrame((_, rawDelta) => {
    if (!sim || !ref.current) return
    const delta = Math.min(rawDelta, 0.1)
    const windX = Math.cos(wind.directionRad) * wind.speed * SMOKE_DRIFT
    const windZ = Math.sin(wind.directionRad) * wind.speed * SMOKE_DRIFT
    ;(material.uniforms.uWindLean!.value as THREE.Vector2).set(0, 0)

    const offArr = offset.array as Float32Array
    const ageArr = age.array as Float32Array

    for (let c = 0; c < forest.cells.length; c++) {
      const cell = forest.cells[c]!
      const state = sim.states[cell.id]
      if (state === BURNING) linger[c] = SMOKE.lingerAfterChar
      else if (state === CHARRED && linger[c]! > 0) linger[c] = Math.max(0, linger[c]! - delta)
      else if (state !== BURNING) linger[c] = state === CHARRED ? linger[c]! : 0

      const emitting = state === BURNING || (state === CHARRED && linger[c]! > 0)
      clocks[c] = (clocks[c]! + delta) % PUFF_LIFETIME

      for (let p = 0; p < PUFFS_PER_CELL; p++) {
        const i = c * PUFFS_PER_CELL + p
        // Stagger each puff a fixed fraction of a lifetime apart.
        const phase = (clocks[c]! / PUFF_LIFETIME + p / PUFFS_PER_CELL) % 1
        if (!emitting) { ageArr[i] = -1; continue }
        ageArr[i] = phase
        const t = phase * PUFF_LIFETIME
        offArr[i * 3] = cell.position[0] + windX * t
        offArr[i * 3 + 1] = cell.position[1] + 4 + SMOKE.rise * t
        offArr[i * 3 + 2] = cell.position[2] + windZ * t
      }
    }
    offset.needsUpdate = true
    age.needsUpdate = true
  })

  return <mesh ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}

function Flames({ forest, sim, wind }: FxProps) {
  const tongues = FLAME.tonguesPerCell
  const count = forest.cells.length * tongues
  const ref = useRef<THREE.Mesh>(null)

  const { geometry, material, age } = useMemo(() => {
    const geometry = billboardGeometry(count)
    const offset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const data = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)
    const age = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1), 1)

    // Anchors, per-tongue scale and noise phase are all static: cells do not
    // move, so this is written once here rather than every frame. Only aAge
    // (burn progress) changes per frame, which keeps the flame system's
    // per-frame upload to one float per instance same as the smoke's.
    for (let c = 0; c < forest.cells.length; c++) {
      const cell = forest.cells[c]!
      for (let t = 0; t < tongues; t++) {
        const i = c * tongues + t
        const seedA = frac(i * 0.7548776662)
        const seedB = frac(i * 0.5698402910 + 0.5)
        const seedC = frac(i * 0.3618033989 + 0.25)
        const jitterX = (seedA - 0.5) * 2 * FLAME.spread
        const jitterZ = (seedB - 0.5) * 2 * FLAME.spread
        offset.setXYZ(i, cell.position[0] + jitterX, cell.position[1] + FLAME.lift, cell.position[2] + jitterZ)
        // data.x doubles as both the noise phase (so tongues don't flicker in
        // lockstep) and the per-tongue height jitter seed.
        data.setXY(i, seedA, FLAME.height * (0.75 + seedC * 0.5))
      }
    }
    geometry.setAttribute('aOffset', offset)
    geometry.setAttribute('aData', data)
    geometry.setAttribute('aAge', age)

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Additive so overlapping flames build heat, and so bloom picks them up.
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uWindLean: { value: new THREE.Vector2(0, 0) },
      },
      // Height and brightness now come from the shared burn phase curve
      // (preheat / crown flash / sustained / smoulder) instead of an ad-hoc
      // grow-hold-shrink smoothstep pair, so a tree's flames peak at exactly
      // the moment its material and its embers do.
      vertexShader: vertexShader('burnIntensity(aAge)'),
      fragmentShader: /* glsl */ `
        ${BURN_SHADING_GLSL}
        uniform float uTime;
        varying vec2 vUv;
        varying float vAge;
        varying float vSeed;

        void main() {
          vec2 c = vUv - vec2(0.5, 0.0);
          // Taper toward the tip so the quad reads as a flame, not a square.
          float taper = 1.0 - vUv.y;
          float halfWidth = 0.42 * taper;
          float body = smoothstep(halfWidth, 0.0, abs(c.x));
          // Licking motion: scroll noise upward, seeded per tongue.
          float n = noise(vec2(vUv.x * 3.0 + vSeed * 19.0, vUv.y * 2.5 - uTime * 2.2 + vSeed * 7.0));
          float flicker = 0.55 + 0.75 * n;
          float envelope = burnIntensity(vAge);
          float shape = body * smoothstep(0.0, 0.35, taper) * flicker;
          float alpha = shape * envelope;
          if (alpha < 0.02) discard;

          // Blackbody temperature: hottest at the base and down the centre
          // line, cooling toward the tip and toward the silhouette edges,
          // instead of the old two-stop base-to-tip mix.
          float centerness = clamp(1.0 - abs(c.x) / max(halfWidth, 0.001), 0.0, 1.0);
          float baseness = 1.0 - vUv.y;
          float temp = envelope * mix(0.35, 1.0, centerness) * mix(0.55, 1.0, baseness) * flicker;
          vec3 col = blackbody(clamp(temp, 0.0, 1.0));

          gl_FragColor = vec4(col * alpha * ${FLAME_BRIGHTNESS.toFixed(2)}, alpha);
        }
      `,
    })
    // `offset` is deliberately not returned: flame anchors are static, so
    // unlike the smoke there is nothing to write back to it per frame.
    return { geometry, material, age }
  }, [count, tongues])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame((state) => {
    if (!sim || !ref.current) return
    material.uniforms.uTime!.value = state.clock.elapsedTime
    // Wind lean: tip displacement in world units per m/s, applied in the
    // shader as a view-space shear that grows with uv.y^2 (see BILLBOARD_VERT).
    // This is the fix that makes the wind slider legible in the fire itself,
    // not only in the smoke: before this pass Flames never received `wind`.
    ;(material.uniforms.uWindLean!.value as THREE.Vector2).set(
      Math.cos(wind.directionRad) * wind.speed * FLAME.windLean,
      Math.sin(wind.directionRad) * wind.speed * FLAME.windLean,
    )

    const ageArr = age.array as Float32Array
    for (let c = 0; c < forest.cells.length; c++) {
      const cell = forest.cells[c]!
      const p = sim.states[cell.id] === BURNING ? sim.progress[cell.id]! : -1
      for (let t = 0; t < tongues; t++) ageArr[c * tongues + t] = p
    }
    age.needsUpdate = true
  })

  return <mesh ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />
}

/**
 * Ember sparks lifting off burning cells.
 *
 * Unlike Smoke and Flames, whose instance counts scale with the forest, this
 * is a FIXED-size ring buffer sized EMBERS.maxCount, independent of how many
 * cells exist or are alight. At peak burn roughly 90 of 150 cells are alight;
 * an uncapped per-cell spawner is the one thing in this scene that could
 * genuinely blow the frame budget, so the cap is structural, not a tuning
 * suggestion. When the buffer is full, spawning a new spark simply overwrites
 * the next ring slot, cutting short whatever spark lived there.
 *
 * Positions are recomputed from each spark's own elapsed age every frame,
 * the same "no integration" approach the smoke uses: it is what lets a wind
 * change instantly bend every live spark instead of only the new ones.
 */
function Embers({ forest, sim, wind }: FxProps) {
  const maxCount = EMBERS.maxCount
  const ref = useRef<THREE.Mesh>(null)

  const { geometry, material, offset, age, data } = useMemo(() => {
    const geometry = billboardGeometry(maxCount)
    const offset = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3), 3)
    const data = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 2), 2)
    const age = new THREE.InstancedBufferAttribute(new Float32Array(maxCount).fill(-1), 1)
    geometry.setAttribute('aOffset', offset)
    geometry.setAttribute('aData', data)
    geometry.setAttribute('aAge', age)

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Additive so sparks build heat like the flames and clear bloom.
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(EMBERS.color) },
        // Left at zero: unlike the flame quad, an ember's whole position
        // (including wind drift) is recomputed from its age every frame, so
        // shearing the quad on top of that would double up the wind effect.
        uWindLean: { value: new THREE.Vector2(0, 0) },
      },
      // Quick grow-in, then a slow shrink as the spark cools, aAge here being
      // fraction-of-lifetime rather than burn progress.
      vertexShader: vertexShader('(smoothstep(0.0, 0.08, aAge) * (1.0 - 0.35 * aAge))'),
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vAge;
        varying float vSeed;

        void main() {
          vec2 c = vUv - vec2(0.5, 0.5);
          float d = length(c) * 2.2;
          float mask = smoothstep(1.0, 0.0, d);
          float fade = smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
          float a = mask * fade;
          if (a < 0.015) discard;
          // Brighter and whiter-hot when young, cooling toward uColor as it dies.
          vec3 col = mix(vec3(1.0), uColor, smoothstep(0.0, 0.3, vAge));
          gl_FragColor = vec4(col * a * ${EMBER_BRIGHTNESS.toFixed(2)}, a);
        }
      `,
    })
    return { geometry, material, offset, age, data }
  }, [maxCount])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  // Per-cell spawn accumulator: fractional sparks owed to a cell, carried
  // frame to frame so the spawn rate is correct however delta lands.
  const spawnAccum = useMemo(() => new Float32Array(forest.cells.length), [forest])

  // Ring buffer state, in plain arrays rather than React state: this is
  // mutated every frame from useFrame and must never trigger a re-render.
  const particles = useMemo(
    () => ({
      ageSec: new Float32Array(maxCount).fill(Infinity),
      seed: new Float32Array(maxCount),
      spawnX: new Float32Array(maxCount),
      spawnY: new Float32Array(maxCount),
      spawnZ: new Float32Array(maxCount),
      cursor: 0,
      spawnCounter: 0,
    }),
    [maxCount],
  )

  useFrame((_, rawDelta) => {
    if (!sim || !ref.current) return
    const delta = Math.min(rawDelta, 0.1)
    const windX = Math.cos(wind.directionRad) * wind.speed * EMBERS.drift
    const windZ = Math.sin(wind.directionRad) * wind.speed * EMBERS.drift

    // Spawn, weighted by the shared burn-phase curve so sparks concentrate in
    // the crown-flash and sustained acts rather than trickling out evenly
    // across the whole burn (preheat and smoulder barely spark at all).
    for (let c = 0; c < forest.cells.length; c++) {
      const cell = forest.cells[c]!
      if (sim.states[cell.id] !== BURNING) { spawnAccum[c] = 0; continue }
      spawnAccum[c]! += SPARK_SPAWN_RATE * burnIntensity(sim.progress[cell.id]!) * delta
      while (spawnAccum[c]! >= 1) {
        spawnAccum[c]! -= 1
        const slot = particles.cursor
        particles.cursor = (particles.cursor + 1) % maxCount
        particles.ageSec[slot] = 0
        particles.seed[slot] = frac(particles.spawnCounter * 0.6180339887)
        particles.spawnCounter++
        particles.spawnX[slot] = cell.position[0]
        particles.spawnY[slot] = cell.position[1] + FLAME.lift * 0.5
        particles.spawnZ[slot] = cell.position[2]
      }
    }

    const offArr = offset.array as Float32Array
    const ageArr = age.array as Float32Array
    const dataArr = data.array as Float32Array
    for (let i = 0; i < maxCount; i++) {
      const life = particles.ageSec[i]! + delta
      particles.ageSec[i] = life
      const t = life / EMBERS.lifetime
      if (t >= 1) { ageArr[i] = -1; continue }
      ageArr[i] = t
      const seed = particles.seed[i]!
      // Buoyant rise plus wind advection plus a small sinusoidal wander,
      // decorrelated per spark by seed. Not integrated: recomputed from
      // elapsed life every frame, same reasoning as the smoke.
      const wobbleX = Math.sin(life * 2.3 + seed * 43.0) * EMBERS.wander
      const wobbleZ = Math.cos(life * 1.7 + seed * 67.0) * EMBERS.wander
      offArr[i * 3] = particles.spawnX[i]! + windX * life + wobbleX
      offArr[i * 3 + 1] = particles.spawnY[i]! + EMBERS.rise * life
      offArr[i * 3 + 2] = particles.spawnZ[i]! + windZ * life + wobbleZ
      dataArr[i * 2] = seed
      dataArr[i * 2 + 1] = EMBERS.size
    }
    offset.needsUpdate = true
    age.needsUpdate = true
    data.needsUpdate = true
  })

  return <mesh ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />
}
