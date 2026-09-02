import { describe, it, expect } from 'vitest'
import { mulberry32 } from './rng'
import { createFireSim } from './fire'
import { BURNING, CHARRED, UNBURNED } from './types'
import type { Forest, TerrainField, TreeCell } from './types'

// A minimal TerrainField stand-in. The fire sim only receives it as a
// parameter and never reads it directly (elevation lives on TreeCell), but
// it's part of createFireSim's signature so every test builds one.
function fixtureTerrain(): TerrainField {
  return {
    size: 100,
    resolution: 2,
    landform: 'rolling',
    waterLevel: -1,
    heightmap: new Float32Array(4),
    elevationAt: () => 0,
    slopeAt: () => ({ magnitude: 0, direction: [0, 0] }),
  }
}

function cell(overrides: Partial<TreeCell> & { id: number }): TreeCell {
  return {
    position: [overrides.id * 5, 0, 0],
    fuelModel: 9,
    species: 'conifer',
    fuelLoad: 1.2,
    moistureContent: 0.08,
    moistureOfExtinction: 0.25,
    neighbors: [],
    ...overrides,
  }
}

function link(a: TreeCell, b: TreeCell) {
  a.neighbors.push(b.id)
  b.neighbors.push(a.id)
}

const rng = () => mulberry32(42)

describe('createFireSim', () => {
  it('downwind bias: wind blowing +x ignites the +x neighbour strictly before the -x one', () => {
    // Heavy fuel load on the source cell so it burns long enough (~40s) for
    // both the fast downwind edge and the slower upwind edge to resolve
    // before the source itself chars and stops spreading.
    const center = cell({ id: 0, position: [0, 0, 0], fuelLoad: 1.2 })
    const downwind = cell({ id: 1, position: [5, 0, 0] }) // +x, same direction wind blows
    const upwind = cell({ id: 2, position: [-5, 0, 0] })
    link(center, downwind)
    link(center, upwind)
    const forest: Forest = { cells: [center, downwind, upwind] }

    // Moderate wind: strong enough for a clear bias, weak enough that the
    // upwind edge still has a positive (just much slower) spread rate.
    const sim = createFireSim(forest, fixtureTerrain(), rng(), {
      wind: { speed: 3, directionRad: 0 },
    })
    sim.ignite(0)

    let downwindTick = -1
    let upwindTick = -1
    for (let t = 1; t <= 2000 && (downwindTick < 0 || upwindTick < 0); t++) {
      sim.tick(0.05)
      if (downwindTick < 0 && sim.states[1] !== UNBURNED) downwindTick = t
      if (upwindTick < 0 && sim.states[2] !== UNBURNED) upwindTick = t
    }

    expect(downwindTick).toBeGreaterThan(0)
    expect(upwindTick).toBeGreaterThan(0)
    expect(downwindTick).toBeLessThan(upwindTick)
  })

  it('uphill bias: with zero wind, the equidistant uphill neighbour ignites strictly before the downhill one', () => {
    // Heavy fuel load on the source cell, same reasoning as the wind test:
    // gives both edges time to resolve before the source chars. A gentle
    // slope (~11 degrees) keeps the downhill spread rate positive rather
    // than clamped to zero.
    const center = cell({ id: 0, position: [0, 0, 0], fuelLoad: 1.2 })
    const uphill = cell({ id: 1, position: [5, 1, 0] })
    const downhill = cell({ id: 2, position: [-5, -1, 0] })
    link(center, uphill)
    link(center, downhill)
    const forest: Forest = { cells: [center, uphill, downhill] }

    const sim = createFireSim(forest, fixtureTerrain(), rng(), {
      wind: { speed: 0, directionRad: 0 },
    })
    sim.ignite(0)

    let uphillTick = -1
    let downhillTick = -1
    for (let t = 1; t <= 2000 && (uphillTick < 0 || downhillTick < 0); t++) {
      sim.tick(0.05)
      if (uphillTick < 0 && sim.states[1] !== UNBURNED) uphillTick = t
      if (downhillTick < 0 && sim.states[2] !== UNBURNED) downhillTick = t
    }

    expect(uphillTick).toBeGreaterThan(0)
    expect(downhillTick).toBeGreaterThan(0)
    expect(uphillTick).toBeLessThan(downhillTick)
  })

  it('moisture of extinction: a cell at or above Mx never ignites its neighbours', () => {
    const wet = cell({ id: 0, position: [0, 0, 0], moistureContent: 0.25, moistureOfExtinction: 0.25 })
    const neighbor = cell({ id: 1, position: [5, 0, 0] })
    link(wet, neighbor)
    const forest: Forest = { cells: [wet, neighbor] }

    const sim = createFireSim(forest, fixtureTerrain(), rng(), {
      wind: { speed: 10, directionRad: 0 },
    })
    sim.ignite(0)

    for (let t = 0; t < 5000; t++) sim.tick(0.1)

    expect(sim.states[1]).toBe(UNBURNED)
    // the wet cell itself still burns out on its own timeline
    expect(sim.states[0]).toBe(CHARRED)
  })

  it('termination: reachable cells all char, disconnected cells never ignite, sim settles', () => {
    const a = cell({ id: 0, position: [0, 0, 0] })
    const b = cell({ id: 1, position: [5, 0, 0] })
    const c = cell({ id: 2, position: [10, 0, 0] })
    link(a, b)
    link(b, c)
    const isolated = cell({ id: 3, position: [1000, 0, 0] }) // no links: disconnected
    const forest: Forest = { cells: [a, b, c, isolated] }

    const sim = createFireSim(forest, fixtureTerrain(), rng(), { wind: { speed: 3, directionRad: 0.7 } })
    sim.ignite(0)

    for (let t = 0; t < 5000 && !sim.isSettled(); t++) sim.tick(0.1)

    expect(sim.isSettled()).toBe(true)
    expect(sim.states[0]).toBe(CHARRED)
    expect(sim.states[1]).toBe(CHARRED)
    expect(sim.states[2]).toBe(CHARRED)
    expect(sim.states[3]).toBe(UNBURNED)
  })

  it('state machine: no backwards transitions, ignite is a no-op once burning or charred', () => {
    const a = cell({ id: 0, position: [0, 0, 0] })
    const b = cell({ id: 1, position: [5, 0, 0] })
    link(a, b)
    const forest: Forest = { cells: [a, b] }

    const sim = createFireSim(forest, fixtureTerrain(), rng(), {})
    sim.ignite(0)
    expect(sim.states[0]).toBe(BURNING)

    // re-ignite while burning: no-op, progress unaffected
    sim.tick(1)
    const progressAfterOneTick = sim.progress[0]
    sim.ignite(0)
    expect(sim.progress[0]).toBe(progressAfterOneTick)

    let sawBurning = false
    for (let t = 0; t < 5000 && sim.states[0] !== CHARRED; t++) {
      sim.tick(0.1)
      if (sim.states[0] === BURNING) sawBurning = true
    }
    expect(sim.states[0]).toBe(CHARRED)
    expect(sawBurning).toBe(true)

    // re-ignite while charred: no-op
    sim.ignite(0)
    expect(sim.states[0]).toBe(CHARRED)
  })

  it('determinism: same seed and same tick sequence produce identical results', () => {
    function buildAndRun() {
      const a = cell({ id: 0, position: [0, 0, 0] })
      const b = cell({ id: 1, position: [5, 0, 0] })
      const c = cell({ id: 2, position: [5, 5, 5] })
      link(a, b)
      link(a, c)
      link(b, c)
      const forest: Forest = { cells: [a, b, c] }
      const sim = createFireSim(forest, fixtureTerrain(), mulberry32(7), {
        wind: { speed: 4, directionRad: 1.2 },
      })
      sim.ignite(0)
      const snapshots: number[] = []
      for (let t = 0; t < 300; t++) {
        sim.tick(0.05)
        snapshots.push(sim.states[0]!, sim.states[1]!, sim.states[2]!, sim.progress[0]!, sim.progress[1]!, sim.progress[2]!)
      }
      return snapshots
    }

    expect(buildAndRun()).toEqual(buildAndRun())
  })

  it('dt independence: 100 ticks of 0.1s and 200 ticks of 0.05s produce close to the same outcome', () => {
    function buildForest(): Forest {
      const a = cell({ id: 0, position: [0, 0, 0] })
      const b = cell({ id: 1, position: [5, 0, 0] })
      const c = cell({ id: 2, position: [10, 0, 0] })
      link(a, b)
      link(b, c)
      return { cells: [a, b, c] }
    }

    const opts = { wind: { speed: 5, directionRad: 0 } }

    const coarse = createFireSim(buildForest(), fixtureTerrain(), mulberry32(9), opts)
    coarse.ignite(0)
    for (let t = 0; t < 100; t++) coarse.tick(0.1)

    const fine = createFireSim(buildForest(), fixtureTerrain(), mulberry32(9), opts)
    fine.ignite(0)
    for (let t = 0; t < 200; t++) fine.tick(0.05)

    for (let id = 0; id < 3; id++) {
      expect(coarse.states[id]).toBe(fine.states[id])
      expect(Math.abs(coarse.progress[id]! - fine.progress[id]!)).toBeLessThan(0.05)
    }
  })

  it('burn pacing: a small grove settles promptly and scales with fuel load', () => {
    // A 3x3 grid, 5m spacing, reference fuel load, moderate wind.
    const cells: TreeCell[] = []
    for (let ix = 0; ix < 3; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        cells.push(cell({ id: ix * 3 + iz, position: [ix * 5, 0, iz * 5] }))
      }
    }
    const byPos = (ix: number, iz: number) => cells[ix * 3 + iz]!
    for (let ix = 0; ix < 3; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        if (ix + 1 < 3) link(byPos(ix, iz), byPos(ix + 1, iz))
        if (iz + 1 < 3) link(byPos(ix, iz), byPos(ix, iz + 1))
      }
    }
    const forest: Forest = { cells }

    const sim = createFireSim(forest, fixtureTerrain(), mulberry32(123), {
      wind: { speed: 3, directionRad: 0.4 },
    })
    sim.ignite(byPos(0, 0).id)

    let elapsed = 0
    const dt = 0.1
    while (!sim.isSettled() && elapsed < 200) {
      sim.tick(dt)
      elapsed += dt
    }

    expect(sim.isSettled()).toBe(true)

    // NOTE: the project's real 20-40s pacing target is a property of a full
    // ~150-tree grove with real Anderson fuel loads, and is asserted across
    // several seeds in integration.test.ts. A nine-cell fixture legitimately
    // finishes sooner, so pinning that same window here would be false
    // precision. What this fixture CAN prove is that the sim terminates
    // promptly and that pacing responds to fuel load at all.
    expect(elapsed).toBeGreaterThan(2)
    expect(elapsed).toBeLessThan(45)

    // Heavier fuel must burn longer, which is the relationship the pacing
    // constants are tuned against.
    const heavy: Forest = { cells: cells.map((c) => ({ ...c, fuelLoad: c.fuelLoad * 2, neighbors: [...c.neighbors] })) }
    const heavySim = createFireSim(heavy, fixtureTerrain(), mulberry32(123), {
      wind: { speed: 3, directionRad: 0.4 },
    })
    heavySim.ignite(byPos(0, 0).id)
    let heavyElapsed = 0
    while (!heavySim.isSettled() && heavyElapsed < 400) {
      heavySim.tick(dt)
      heavyElapsed += dt
    }
    expect(heavyElapsed).toBeGreaterThan(elapsed)
  })

  // 8-connected NxN grid, centre-ignited. Used by the two regression tests
  // below (backing floor / high-wind full burn, and cell-order invariance).
  function buildGrid(n: number, spacing: number): { forest: Forest; at: (ix: number, iz: number) => TreeCell } {
    const cells: TreeCell[] = []
    for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) cells.push(cell({ id: ix * n + iz, position: [ix * spacing, 0, iz * spacing] }))
    const at = (ix: number, iz: number) => cells[ix * n + iz]!
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        if (ix + 1 < n) link(at(ix, iz), at(ix + 1, iz))
        if (iz + 1 < n) link(at(ix, iz), at(ix, iz + 1))
        if (ix + 1 < n && iz + 1 < n) link(at(ix, iz), at(ix + 1, iz + 1))
        if (ix + 1 < n && iz - 1 >= 0) link(at(ix, iz), at(ix + 1, iz - 1))
      }
    }
    return { forest: { cells }, at }
  }

  function runToSettled(forest: Forest, ignitedId: number, seed: number, windSpeed: number, dt = 0.1, maxSeconds = 200) {
    const sim = createFireSim(forest, fixtureTerrain(), mulberry32(seed), { wind: { speed: windSpeed, directionRad: 0 } })
    sim.ignite(ignitedId)
    let elapsed = 0
    while (!sim.isSettled() && elapsed < maxSeconds) {
      sim.tick(dt)
      elapsed += dt
    }
    return { sim, elapsed }
  }

  it('backing floor: a connected grove still fully chars at high wind, and the front keeps varying with speed', () => {
    // Regression test for the P1 defect: above a wind threshold the whole
    // upwind half of a grove used to freeze forever, and beyond another
    // threshold the wind slider stopped changing anything at all.
    const { forest: forestA, at: atA } = buildGrid(9, 5)
    const simA = createFireSim(forestA, fixtureTerrain(), mulberry32(42), { wind: { speed: 10, directionRad: 0 } })
    simA.ignite(atA(4, 4).id)
    let elapsedA = 0
    while (!simA.isSettled() && elapsedA < 200) {
      simA.tick(0.1)
      elapsedA += 0.1
    }
    let charred = 0
    for (let i = 0; i < forestA.cells.length; i++) if (simA.states[i] === CHARRED) charred++
    expect(simA.isSettled()).toBe(true)
    expect(charred / forestA.cells.length).toBeGreaterThan(0.98) // ~100%, not the old 55.6%

    // Front shape: the straight-downwind edge cell should ignite measurably
    // sooner at 12 m/s than at 6 m/s. If the wind bracket were still
    // clamping to a hard zero (or to a wind-invariant floor on the downwind
    // side too) these would be equal, reproducing the "slider does nothing"
    // half of the defect.
    function downwindIgniteTime(speed: number): number {
      const { forest, at } = buildGrid(9, 5)
      const sim = createFireSim(forest, fixtureTerrain(), mulberry32(42), { wind: { speed, directionRad: 0 } })
      sim.ignite(at(4, 4).id)
      const target = at(8, 4).id
      let elapsed = 0
      while (elapsed < 200 && sim.states[target] === UNBURNED) {
        sim.tick(0.1)
        elapsed += 0.1
      }
      return elapsed
    }
    const t6 = downwindIgniteTime(6)
    const t12 = downwindIgniteTime(12)
    expect(t12).toBeLessThan(t6)
  })

  it('cell-order invariance: shuffling forest.cells does not change the burn outcome for a fixed seed', () => {
    // Regression test for the P2 defect: a same-tick cascade meant a cell
    // ignited earlier in forest.cells' array order got to spread again in
    // the SAME tick, biasing spread toward higher cell ids. Reversing the
    // array order (same cells, same ids, same neighbours, same seed) must
    // produce an identical outcome once the tick is double-buffered.
    const { forest, at } = buildGrid(6, 5)
    const centerId = at(3, 3).id

    const forward: Forest = { cells: forest.cells }
    const shuffled: Forest = { cells: [...forest.cells].reverse() }

    const runA = runToSettled(forward, centerId, 7, 4)
    const runB = runToSettled(shuffled, centerId, 7, 4)
    expect(runA.elapsed).toBe(runB.elapsed)
    for (let id = 0; id < forward.cells.length; id++) {
      expect(runB.sim.states[id]).toBe(runA.sim.states[id])
      expect(runB.sim.progress[id]).toBeCloseTo(runA.sim.progress[id]!, 5)
    }
  })

  it('receiving-cell moisture gate: a target at or above its own moisture of extinction never ignites', () => {
    const dry = cell({ id: 0, position: [0, 0, 0] })
    const wetTarget = cell({ id: 1, position: [5, 0, 0], moistureContent: 0.3, moistureOfExtinction: 0.25 })
    link(dry, wetTarget)
    const forest: Forest = { cells: [dry, wetTarget] }

    const sim = createFireSim(forest, fixtureTerrain(), rng(), { wind: { speed: 10, directionRad: 0 } })
    sim.ignite(0)
    for (let t = 0; t < 5000; t++) sim.tick(0.1)

    expect(sim.states[1]).toBe(UNBURNED)
    expect(sim.states[0]).toBe(CHARRED)
  })
})
