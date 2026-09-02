import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FireSim, Forest, Wind } from './types'
import { BURNING, CHARRED } from './types'
import { BURN, SMOKE } from './visual'

/**
 * Fire effects: smoke columns and flame billboards.
 *
 * Both are single instanced quads per element, oriented to face the camera in
 * the vertex shader rather than on the CPU, so the whole grove costs two draw
 * calls no matter how many cells are alight.
 *
 * Smoke matters more than the flames. It is the only element that makes the
 * wind control legible: the columns lean along the wind vector, so changing
 * direction mid-burn visibly swings every plume. The flames are the thing that
 * stops the fire reading as merely "glowing trees".
 */

/** Puffs per burning cell. Small: at peak burn ~90 cells are alight. */
const PUFFS_PER_CELL = 3

/** Seconds for one puff to travel its full rise and fade out. */
const PUFF_LIFETIME = 3.2

/** How strongly wind pushes a puff sideways, world units per (m/s) per second. */
const SMOKE_DRIFT = 0.55

export interface FxProps {
  forest: Forest
  sim: FireSim | null
  wind: Wind
}

export function FireEffects({ forest, sim, wind }: FxProps) {
  return (
    <>
      <Smoke forest={forest} sim={sim} wind={wind} />
      <Flames forest={forest} sim={sim} />
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

/** Shared vertex shader: expand a unit quad toward the camera. */
const BILLBOARD_VERT = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec2 aData;   // x: per-instance seed, y: base scale
  attribute float aAge;   // 0..1 normalised lifetime, <0 means inactive
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
    gl_Position = projectionMatrix * mv;
  }
`

function vertexShader(scaleCurve: string) {
  return BILLBOARD_VERT.replace('SCALE_CURVE', scaleCurve)
}

/** Cheap value noise, enough to break up a billboard's silhouette. */
const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
`

function Smoke({ forest, sim, wind }: FxProps) {
  const count = forest.cells.length * PUFFS_PER_CELL
  const ref = useRef<THREE.Mesh>(null)

  const { geometry, material, offset, age } = useMemo(() => {
    const geometry = billboardGeometry(count)
    const offset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const data = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)
    const age = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1), 1)

    for (let i = 0; i < count; i++) {
      data.setXY(i, (i * 0.6180339887) % 1, 1.7)
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
      uniforms: { uColor: { value: new THREE.Color(SMOKE.color) }, uOpacity: { value: SMOKE.opacity } },
      vertexShader: vertexShader('(0.6 + aAge * 2.4)'),
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vAge;
        varying float vSeed;

        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c);
          // Soft round puff, roughened so it does not read as a circle.
          float edge = 0.5 - 0.22 * noise(vUv * 5.0 + vSeed * 37.0);
          float mask = smoothstep(edge, 0.0, d);
          // Fade in quickly, then out over the rest of the life.
          float fade = smoothstep(0.0, 0.10, vAge) * (1.0 - smoothstep(0.18, 0.75, vAge));
          float a = mask * fade * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
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

function Flames({ forest, sim }: { forest: Forest; sim: FireSim | null }) {
  const count = forest.cells.length
  const ref = useRef<THREE.Mesh>(null)

  const { geometry, material, offset, age } = useMemo(() => {
    const geometry = billboardGeometry(count)
    const offset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const data = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)
    const age = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1), 1)
    for (let i = 0; i < count; i++) data.setXY(i, (i * 0.7548776662) % 1, 3.4)
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
        uEmber: { value: new THREE.Color(BURN.ramp.orange) },
        uHot: { value: new THREE.Color(BURN.ramp.yellow) },
      },
      // Flames grow in over the ignition ramp and shrink away as the cell chars.
      vertexShader: vertexShader('(smoothstep(0.0, 0.18, aAge) * (1.0 - smoothstep(0.5, 1.0, aAge)))'),
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uTime;
        uniform vec3 uEmber;
        uniform vec3 uHot;
        varying vec2 vUv;
        varying float vAge;
        varying float vSeed;

        void main() {
          vec2 c = vUv - vec2(0.5, 0.0);
          // Taper toward the tip so the quad reads as a flame, not a square.
          float taper = 1.0 - vUv.y;
          float body = smoothstep(0.42 * taper, 0.0, abs(c.x));
          // Licking motion: scroll noise upward, seeded per instance.
          float n = noise(vec2(vUv.x * 3.0 + vSeed * 19.0, vUv.y * 2.5 - uTime * 2.2 + vSeed * 7.0));
          float flame = body * smoothstep(0.0, 0.35, taper) * (0.55 + 0.75 * n);
          flame *= 1.0 - smoothstep(0.55, 1.0, vUv.y);
          if (flame < 0.02) discard;
          // Hottest at the base, cooling toward the tip.
          vec3 col = mix(uHot, uEmber, smoothstep(0.0, 0.35, vUv.y));
          gl_FragColor = vec4(col * flame * 0.9, flame);
        }
      `,
    })
    return { geometry, material, offset, age }
  }, [count])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame((state) => {
    if (!sim || !ref.current) return
    material.uniforms.uTime!.value = state.clock.elapsedTime
    const offArr = offset.array as Float32Array
    const ageArr = age.array as Float32Array
    for (let c = 0; c < forest.cells.length; c++) {
      const cell = forest.cells[c]!
      if (sim.states[cell.id] !== BURNING) { ageArr[c] = -1; continue }
      ageArr[c] = sim.progress[cell.id]!
      offArr[c * 3] = cell.position[0]
      offArr[c * 3 + 1] = cell.position[1] + 2.6
      offArr[c * 3 + 2] = cell.position[2]
    }
    offset.needsUpdate = true
    age.needsUpdate = true
  })

  return <mesh ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />
}
