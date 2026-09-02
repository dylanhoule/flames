/**
 * Locked art direction for the diorama.
 *
 * Low-poly isometric diorama: a finite terrain slab with cut strata sides,
 * floating on a dark charcoal backdrop, lit like a museum model on a table
 * rather than like a landscape. Flat shading everywhere, no fog, no sky dome.
 *
 * The backdrop is deliberately dark. The reference images this was drawn from
 * sit on pale backgrounds, but fire is the subject here, and emissive orange
 * plus bloom only reads hard against a dark frame.
 *
 * Every colour and constant the Scene needs lives here so rendering code is a
 * lookup rather than a fresh aesthetic decision at each call site.
 */

// ------------------------------------------------------------ environment

export const BACKDROP = {
  /** Flat neutral gradient behind the slab. Top is very slightly lifted. */
  top: '#23262b',
  bottom: '#141619',
  /** Opacity of the soft contact shadow under the slab. */
  contactShadow: 0.55,
} as const

export const LIGHTS = {
  /** High key, crisp facet definition and the shadow caster. */
  key: { color: '#fff4e0', intensity: 2.6, position: [40, 70, 30] },
  /** Cool fill from the opposite side so shadowed facets keep their shape. */
  fill: { color: '#8fb2d9', intensity: 0.7, position: [-45, 25, -35] },
  /** Lifts everything off the dark backdrop. */
  ambient: { color: '#5a6a7d', intensity: 0.55 },
} as const

// ---------------------------------------------------------------- terrain

/**
 * Flat elevation bands, low to high, as a fraction of the slab's height.
 * Transitions are deliberately hard-ish: this is a stylised model, not a
 * blended satellite texture.
 */
export const ELEVATION_BANDS = [
  { upTo: 0.05, color: '#d8cba4' }, // shoreline sand
  { upTo: 0.40, color: '#6fa84b' }, // meadow
  { upTo: 0.70, color: '#3f7a37' }, // treeline forest floor
  { upTo: 0.88, color: '#7d8189' }, // exposed rock
  { upTo: 1.0, color: '#eef2f5' }, // snow
] as const

/** Steep terraced faces read as rock whatever band they fall in. */
export const CLIFF_COLOR = '#6b7079'
/** Slope magnitude at or above which a face is drawn as cliff rock. */
export const CLIFF_SLOPE = 1.3

/** The cut side of the slab, top course first. */
export const STRATA = [
  { thickness: 0.06, color: '#4e8f3d' }, // grass lip
  { thickness: 0.22, color: '#6b4a2f' }, // topsoil
  { thickness: 0.34, color: '#8a7355' }, // stone course (masonry texture)
  { thickness: 0.38, color: '#b9b3a6' }, // pale base
] as const

/** Ground darkening left behind by fire. */
export const SCORCH = {
  color: '#241d18',
  /** World-unit radius a charred tree darkens around itself. */
  radius: 6,
  /** Peak darkening strength, 0..1. */
  strength: 0.5,
} as const

// ------------------------------------------------------------------ water

export const WATER = {
  color: '#2b8299',
  deepColor: '#186a86',
  opacity: 0.78,
  /** UV scroll speed for the surface, world units per second. */
  flow: 0.05,
  foam: '#eaf6f8',
} as const

// ------------------------------------------------------------------ trees

/** Foliage colour range. Per-instance hue jitter picks within it. */
export const FOLIAGE = {
  coniferA: '#2f6b3a',
  coniferB: '#1f5340',
  hardwoodA: '#5d9c3c',
  hardwoodB: '#78ad42',
  /** Snow tint blended onto upper tiers above this elevation fraction. */
  snowAbove: 0.82,
  snow: '#e8f0f4',
} as const

export const TRUNK = {
  color: '#5a4230',
  charred: '#17130f',
} as const

/** Per-instance variation, as multipliers or radians. */
export const TREE_JITTER = {
  height: 0.25,
  radius: 0.15,
  tiltRad: 0.06,
} as const

// ------------------------------------------------------------- burn stages

export const BURN = {
  /** Progress at which foliage has fully reached peak ember colour. */
  ignitionRamp: 0.2,
  ember: '#ff6a1a',
  emberHot: '#ffd28a',
  ash: '#1b1613',
  /** Emissive multiplier at peak burn, pre-tone-mapping. */
  emissivePeak: 2.4,
  /** Flicker depth and rate for the per-instance emissive noise. */
  flickerDepth: 0.35,
  flickerHz: 7.0,
  /** Foliage scale at full char. Not zero, so a stub remains. */
  charredFoliageScale: 0.06,
} as const

export const SMOKE = {
  color: '#9aa3ab',
  opacity: 0.2,
  /** Metres per second of rise, before wind advection. */
  rise: 2.4,
  /** Seconds a column keeps emitting after its cell chars. */
  lingerAfterChar: 6,
} as const

// -------------------------------------------------------------------- post

export const POST = {
  bloomThreshold: 1.0,
  bloomIntensity: 1.3,
  bloomRadius: 0.55,
  vignette: 0.42,
} as const

// ------------------------------------------------------------------ camera

export const CAMERA = {
  /** Orthographic keeps the isometric toy-model read while orbiting. */
  zoom: 9,
  position: [60, 55, 60],
  /** Clamp so the viewer always looks down at the model, never up from below. */
  minPolarRad: 0.35,
  maxPolarRad: 1.32,
  minZoom: 4,
  maxZoom: 26,
} as const
