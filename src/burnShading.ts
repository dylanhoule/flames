/**
 * Shared burn shading: the phase curve and the colour ramp, in GLSL and in TS.
 *
 * Four subsystems have to agree about what "burning" means at a given moment:
 * the tree material, the flame billboards, the ember sparks and the fire
 * lights. When each one invented its own smoothsteps they peaked at different
 * times, which is a large part of why the old burn read as a wash rather than
 * as an event. The curve lives here once, is exported as a GLSL chunk for the
 * shaders and as a plain function for the CPU-side systems, and both are
 * generated from the same tokens in visual.ts.
 *
 * The GLSL is emitted as strings with the tokens baked in as literals rather
 * than passed as uniforms: these numbers are art direction, they never change
 * at runtime, and a uniform per constant would be a dozen extra uploads a
 * frame for nothing.
 */

import { BURN } from './visual'

/** #rrggbb -> "vec3(r, g, b)" in linear-ish sRGB literals, for inlining into GLSL. */
export function glslColor(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`
}

const f = (n: number) => n.toFixed(4)

/**
 * Cheap value noise. Lifted out of fx.tsx, which used to be its only consumer;
 * the tree material and the ember sparks want the same one now, and two copies
 * of a hash function that must agree is exactly the kind of drift this file
 * exists to prevent.
 */
export const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i + vec3(0, 0, 0)), hash3(i + vec3(1, 0, 0)), u.x),
          mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x),
          mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
  }
`

/**
 * `vec3 blackbody(float t)` — t of 0 is cold ash, 1 is the white-hot core.
 *
 * Five stops rather than two. The bands are deliberately uneven: most of the
 * visible range of a fire sits between deep red and orange, so those get the
 * width, and white-hot is a narrow cap that only the flame cores and the
 * moving front ever reach.
 */
export const BLACKBODY_GLSL = /* glsl */ `
  vec3 blackbody(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c = mix(${glslColor(BURN.ramp.ash)}, ${glslColor(BURN.ramp.deepRed)}, smoothstep(0.00, 0.28, t));
    c = mix(c, ${glslColor(BURN.ramp.orange)}, smoothstep(0.28, 0.55, t));
    c = mix(c, ${glslColor(BURN.ramp.yellow)}, smoothstep(0.55, 0.80, t));
    c = mix(c, ${glslColor(BURN.ramp.white)},  smoothstep(0.80, 1.00, t));
    return c;
  }
`

/**
 * `float burnIntensity(float p)` and `float burnFront(float p)`.
 *
 * The four acts are summed rather than branched. Each term's smoothstep window
 * is disjoint from the others', so exactly one term is moving at any given p
 * and the result is monotonic within each act: it rises to preheatLevel, rises
 * again to 1 at the flash, then steps down to sustainLevel and again to
 * smoulderLevel. Written this way it is branch-free, and the TS mirror below
 * is a line-for-line transcription rather than a reimplementation.
 */
export const BURN_PHASE_GLSL = /* glsl */ `
  float burnIntensity(float p) {
    float pre   = smoothstep(0.0, ${f(BURN.preheatEnd)}, p) * ${f(BURN.preheatLevel)};
    float flash = smoothstep(${f(BURN.preheatEnd)}, ${f(BURN.flashEnd)}, p) * ${f(1 - BURN.preheatLevel)};
    float decay = smoothstep(${f(BURN.flashEnd)}, ${f(BURN.sustainEnd)}, p) * ${f(1 - BURN.sustainLevel)};
    float fade  = smoothstep(${f(BURN.sustainEnd)}, 1.0, p) * ${f(BURN.sustainLevel - BURN.smoulderLevel)};
    return clamp(pre + flash - decay - fade, 0.0, 1.0);
  }

  float burnFront(float p) {
    return smoothstep(${f(BURN.frontStart)}, ${f(BURN.flashEnd)}, p);
  }
`

/** All three chunks, in dependency order. Most consumers want exactly this. */
export const BURN_SHADING_GLSL = NOISE_GLSL + BLACKBODY_GLSL + BURN_PHASE_GLSL

// ------------------------------------------------------------ CPU mirrors

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Line-for-line mirror of the GLSL above, for the systems that decide things
 * on the CPU: how bright each fire light should be, and how many sparks a cell
 * should be throwing this frame.
 */
export function burnIntensity(p: number): number {
  const pre = smoothstep(0, BURN.preheatEnd, p) * BURN.preheatLevel
  const flash = smoothstep(BURN.preheatEnd, BURN.flashEnd, p) * (1 - BURN.preheatLevel)
  const decay = smoothstep(BURN.flashEnd, BURN.sustainEnd, p) * (1 - BURN.sustainLevel)
  const fade = smoothstep(BURN.sustainEnd, 1, p) * (BURN.sustainLevel - BURN.smoulderLevel)
  return Math.min(1, Math.max(0, pre + flash - decay - fade))
}

/** Fraction of the tree's height the burn front has climbed to. */
export function burnFront(p: number): number {
  return smoothstep(BURN.frontStart, BURN.flashEnd, p)
}
