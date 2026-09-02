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
 *
 * AMENDED (cinematic burn pass): the fire itself is now allowed to leave the
 * flat-shaded envelope. Blackbody colour, real light cast into the scene,
 * underlit smoke and a cooling scar are all deliberate departures, made
 * because the previous burn read as a single bright-to-black gradient. The
 * flat shading, the orthographic toy-model camera and the dark backdrop are
 * unchanged: only the fire got the cinematic treatment.
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
  /**
   * Cool fill from the opposite side so shadowed facets keep their shape.
   * Trimmed from 0.7 when the fire gained real point lights: the fill was
   * competing with the orange bounce and washing it out of the shadows, which
   * is exactly where fire light should be most visible.
   */
  fill: { color: '#8fb2d9', intensity: 0.55, position: [-45, 25, -35] },
  /** Lifts everything off the dark backdrop. Trimmed alongside fill. */
  ambient: { color: '#5a6a7d', intensity: 0.42 },
} as const

/**
 * The pool of point lights the fire drives. A FIXED count is mounted for the
 * lifetime of the scene and unused lights are driven to zero intensity rather
 * than unmounted: changing the number of lights changes three's
 * NUM_POINT_LIGHTS define, which recompiles every material in the scene and
 * hitches visibly mid-burn.
 */
export const FIRE_LIGHT = {
  count: 6,
  color: '#ff8b3d',
  /** Peak intensity of one light when its cluster is at full burn. */
  intensity: 26,
  /** Falloff distance in world units. */
  distance: 46,
  decay: 1.6,
  /** Fraction of the gap a light closes toward its target per second, 0..1. */
  followRate: 3.5,
  /** Seconds between re-clustering passes. Lights glide between targets. */
  retargetSeconds: 0.25,
  /** World-unit radius of one light's cluster of burning cells. */
  clusterRadius: 22,
  /** Height above the cluster centroid the light sits at. */
  lift: 5,
  /**
   * Summed cluster weight at which a light reaches ~63% of peak intensity.
   * The response saturates, so a large blaze is brighter than a small one
   * without being proportionally brighter, which would blow out the slab.
   */
  weightScale: 6,
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

/** Ground darkening left behind by fire, plus the heat that fades out of it. */
export const SCORCH = {
  color: '#241d18',
  /** World-unit radius a charred tree darkens around itself. */
  radius: 6,
  /** Peak darkening strength, 0..1. */
  strength: 0.5,

  /**
   * Residual heat stamped alongside the darkening. This is what turns the scar
   * from a flat stamp into a moving front: ground just behind the fire still
   * glows and cools over the following few seconds, so the leading edge of the
   * scar is visible as a line rather than only as an absence of green.
   */
  heatColor: '#ff5a12',
  /** Peak emissive strength of fresh heat, 0..1. */
  heatStrength: 0.85,
  /** Heat radius is smaller than the darkening: the glow is a rim, not a pool. */
  heatRadius: 4.2,
  /** Fraction of remaining heat lost per second. */
  heatDecayPerSecond: 0.42,
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
  /**
   * Phase breakpoints on the simulation's progress 0..1. The burn is four
   * readable acts rather than one ramp, which is the whole point of this pass:
   *
   *   0 .. preheatEnd    preheat      foliage dries and dulls, no flame yet
   *   .. flashEnd        crown flash  front reaches the crown, peak everything
   *   .. sustainEnd      sustained    flames shorten, char spreads downward
   *   .. 1               smoulder     flames gone, ember cracks pulse in char
   *
   * burnShading.ts turns these into the intensity curve every subsystem reads,
   * so the trees, the flames, the sparks and the lights all peak together.
   */
  preheatEnd: 0.12,
  flashEnd: 0.3,
  sustainEnd: 0.65,
  /** Intensity held at the end of each of the first three acts. */
  preheatLevel: 0.15,
  sustainLevel: 0.45,
  smoulderLevel: 0.05,

  /**
   * The burn front's sweep up the tree, in progress units. It starts before
   * the crown flash and arrives at the top exactly at flashEnd: fire reaching
   * the crown IS the flash. Foliage geometry is normalised to unit height with
   * its base at y = 0 (see trees.ts), so the front is compared directly
   * against the vertex's own y.
   */
  frontStart: 0.06,
  /** Softness of the front, in tree-height fractions. Wider reads as a wash. */
  frontBand: 0.22,

  /**
   * Blackbody ramp, cold to hot. Replaces the old two-stop ember/emberHot mix,
   * which was half the reason the burn read as a plain gradient: two colours
   * interpolated linearly can only ever look like an interpolation.
   */
  ramp: {
    ash: '#1b1613',
    deepRed: '#a01f08',
    orange: '#ff7a1e',
    yellow: '#ffd66b',
    white: '#fff6e8',
  },

  /**
   * Ember cracks: noise-thresholded veins that keep glowing in the blackened
   * char after the flames are gone, so the end of the burn is a smouldering
   * skeleton rather than a solid black shape.
   */
  crackScale: 9.0,
  /** Noise above this reads as a crack. Higher means fewer, sparser veins. */
  crackThreshold: 0.62,
  crackPulseHz: 0.9,
  /**
   * How far up the blackbody ramp an ember crack reaches. Deliberately low:
   * a crack is glowing charcoal, not a flame core, and at full strength every
   * crack fragment hit the white cap and the char read as white blobs.
   */
  crackHeat: 0.42,

  /** Strength of the dry-brown preheat tint, 0..1. */
  preheatTint: 0.3,

  /** Radians a crown slumps by at full char, so the aftermath reads structurally. */
  settleRad: 0.22,

  /**
   * Emissive multiplier at peak burn, pre-tone-mapping. Cut from 2.4 once the
   * fire gained real point lights: the material no longer has to carry the
   * whole impression of brightness on its own, and at 2.4 the front saturated
   * to white across its full width instead of only at its core.
   */
  emissivePeak: 1.5,
  /** Flicker depth and rate for the per-instance emissive noise. */
  flickerDepth: 0.35,
  flickerHz: 7.0,
  /** Foliage scale at full char. Not zero, so a stub remains. */
  charredFoliageScale: 0.06,
} as const

/**
 * Flame billboards. Flames lean downwind (they did not, before) and a burning
 * cell gets several tongues rather than one symmetric quad, because a single
 * mirror-symmetric shape is what made the old flames read as a decal.
 */
export const FLAME = {
  /** Tongues per burning cell. Each gets its own jitter, scale and time phase. */
  tonguesPerCell: 3,
  /** World units of sideways lean at the flame tip, per m/s of wind. */
  windLean: 0.38,
  /** Base height in world units at full intensity, before per-tongue jitter. */
  height: 4.2,
  /** Spread of tongue anchors around the cell centre, world units. */
  spread: 1.1,
  /**
   * How far above the cell's ground position the flames are anchored.
   * Trees stand about 7 units with a canopy filling roughly 2 to 7, so the
   * old 2.6 buried every flame INSIDE its own crown, where the depth test
   * discarded it: only trees with unusually small canopies showed a flame at
   * all. Anchoring near the top of the crown puts the tongues where a crown
   * fire actually burns and lets them lick clear of the foliage.
   */
  lift: 5.4,
} as const

/**
 * Ember sparks lifting off the front. Additive and tiny, so bloom does most of
 * the work. The count is a hard cap on a recycled ring buffer, not a spawn
 * rate: at peak burn roughly 90 cells are alight and an uncapped spawner would
 * be the one thing in this scene that can actually run out of frame budget.
 */
export const EMBERS = {
  maxCount: 600,
  color: '#ffb347',
  /** Seconds a spark lives. */
  lifetime: 2.4,
  /** Upward speed in world units per second, before wind. */
  rise: 5.5,
  /** Sideways travel per (m/s) of wind, per second. */
  drift: 1.15,
  /** Random sideways wander, world units per second. */
  wander: 0.9,
  /** Screen-space size in world units. */
  size: 0.32,
} as const

export const SMOKE = {
  /** Fresh smoke at the source: dark, dense, close to the fire. */
  freshColor: '#3b3631',
  /** Cooled smoke high in the column, thinned out and drifting. */
  color: '#9aa3ab',
  /** Tint the underside of a young puff picks up from the fire below it. */
  underlitColor: '#ff7a2e',
  opacity: 0.2,
  /** Metres per second of rise, before wind advection. */
  rise: 2.4,
  /** Seconds a column keeps emitting after its cell chars. */
  lingerAfterChar: 6,
} as const

// -------------------------------------------------------------------- post

export const POST = {
  /**
   * Raised from 1.0 with the blackbody ramp: white-hot flame cores and the
   * burn front now push well past 1, so the old threshold caught the merely
   * warm parts of the fire too and the whole burn smeared. Higher means bloom
   * picks out the genuinely hot core and the embers, and leaves the cooling
   * char alone.
   */
  bloomThreshold: 1.35,
  bloomIntensity: 1.15,
  bloomRadius: 0.6,
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
