/**
 * Frozen cross-module contract for the wildfire demo.
 *
 * Every module in this project codes against these shapes and nothing else.
 * Terrain -> Forest -> Fire sim -> Scene, one direction only.
 *
 * DO NOT EDIT while implementation work is in flight. If a signature here is
 * wrong, raise it rather than changing it: three modules are built in parallel
 * against this file and a silent edit desynchronises all of them.
 */

/** Injected seeded generator. Nothing in this project calls Math.random(). */
export type Rng = () => number

// ---------------------------------------------------------------- terrain

/** Which landform generator produced a given world. Chosen by seed. */
export type Landform = 'peak' | 'ridge-valley' | 'rolling'

/** A unit vector in the xz plane. */
export type Vec2 = readonly [x: number, z: number]

export interface Slope {
  /** Gradient magnitude: rise over run, so 1 is a 45 degree face. */
  magnitude: number
  /** Unit vector in xz pointing DOWNHILL. Zero vector on flat ground. */
  direction: Vec2
}

export interface TerrainField {
  /** World units along one side of the square footprint. */
  size: number
  /** Heightmap grid dimension; heightmap.length === resolution ** 2. */
  resolution: number
  /** Which generator ran, for display and debugging. */
  landform: Landform
  /** Elevation at or below this is water. Trees never placed here. */
  waterLevel: number
  /** Row-major, length resolution ** 2, AFTER terracing has been applied. */
  heightmap: Float32Array
  /** Bilinear sample of the heightmap. Clamps to edge outside the footprint. */
  elevationAt(x: number, z: number): number
  /** Central-difference gradient of the final (terraced) heightmap. */
  slopeAt(x: number, z: number): Slope
}

// ----------------------------------------------------------------- forest

/** Anderson 13 timber-litter fuel models. 8 and 9 and 10 only. */
export type FuelModel = 8 | 9 | 10

/** Derived from fuelModel. Drives which geometry the Scene instances. */
export type Species = 'conifer' | 'hardwood'

export interface TreeCell {
  id: number
  /** World position: x, elevation, z. */
  position: readonly [x: number, y: number, z: number]
  fuelModel: FuelModel
  species: Species
  /** Oven-dry fuel load, kg/m^2. */
  fuelLoad: number
  /** Fuel moisture as a fraction of oven-dry weight, 0..1. */
  moistureContent: number
  /** Moisture of extinction for this cell's fuel model, fraction 0..1. */
  moistureOfExtinction: number
  /**
   * Ids of cells this one can spread fire to. Symmetric, never self.
   * Links whose segment crosses water are omitted, which is what makes
   * rivers and lakes act as firebreaks without the sim knowing any geometry.
   */
  neighbors: number[]
}

export interface Forest {
  cells: TreeCell[]
}

// --------------------------------------------------------------- fire sim

export const UNBURNED = 0
export const BURNING = 1
export const CHARRED = 2

/** Parallel-array encoding of CellState, indexed by TreeCell.id. */
export type CellState = typeof UNBURNED | typeof BURNING | typeof CHARRED

export interface Wind {
  /** Metres per second. */
  speed: number
  /**
   * Radians, the direction the wind blows TOWARD, measured in the xz plane
   * from +x toward +z. A wind of 0 pushes fire in the +x direction.
   */
  directionRad: number
}

export interface FireSim {
  /** Indexed by cell id. One of UNBURNED / BURNING / CHARRED. */
  readonly states: Uint8Array
  /** Indexed by cell id. Burn progress 0..1. Drives the Scene's visuals. */
  readonly progress: Float32Array
  /** Live-adjustable from the UI. Mutate in place or reassign. */
  wind: Wind
  /** No-op if the cell is already burning or charred. */
  ignite(cellId: number): void
  /** Advance the simulation. dt in seconds. */
  tick(dt: number): void
  /** True once no cell is still burning. */
  isSettled(): boolean
}
