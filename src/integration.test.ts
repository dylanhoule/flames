import { describe, it, expect } from 'vitest'
import { generateTerrain } from './terrain'
import { generateForest } from './forest'
import { createFireSim } from './fire'
import { mulberry32 } from './rng'
import { BURNING, CHARRED } from './types'
import type { Forest, TerrainField } from './types'

/**
 * End-to-end checks across the real modules. The unit suites use synthetic
 * fixtures by design; this file is what catches tuning that only holds for
 * fixture values. The fire pacing target lives here because it is a property
 * of a REAL grove's fuel loads, not of a hand-built one.
 */

const SEEDS = [0, 1, 2, 3, 7, 11]

function world(seed: number) {
  const rng = mulberry32(seed)
  const terrain = generateTerrain(rng)
  const forest = generateForest(terrain, rng)
  return { terrain, forest }
}

function centreCell(forest: Forest) {
  let best = forest.cells[0]!
  let bd = Infinity
  for (const c of forest.cells) {
    const d = Math.hypot(c.position[0], c.position[2])
    if (d < bd) { bd = d; best = c }
  }
  return best
}

/** Burns a world to completion, returning elapsed simulated seconds. */
function burn(terrain: TerrainField, forest: Forest, seed: number, speed: number) {
  const sim = createFireSim(forest, terrain, mulberry32(seed + 99), {
    wind: { speed, directionRad: 0 },
  })
  sim.ignite(centreCell(forest).id)
  let t = 0
  const dt = 0.05
  while (!sim.isSettled() && t < 2000) { sim.tick(dt); t += dt }
  let charred = 0
  for (const s of sim.states) if (s === CHARRED) charred++
  return { seconds: t, charredFraction: charred / forest.cells.length, settled: sim.isSettled() }
}

describe('world generation', () => {
  it.each(SEEDS)('seed %i places a usable grove', (seed) => {
    const { terrain, forest } = world(seed)
    expect(forest.cells.length).toBeGreaterThanOrEqual(50)
    expect(forest.cells.length).toBeLessThanOrEqual(200)
    for (const c of forest.cells) {
      expect(c.position[1]).toBeGreaterThan(terrain.waterLevel)
      expect(Number.isFinite(c.fuelLoad)).toBe(true)
    }
  })
})

describe('fire pacing on real groves', () => {
  // ARCHITECTURE's target: long enough to watch the front travel and react to a
  // mid-burn wind change, short enough to hold a casual viewer's attention.
  it.each(SEEDS)('seed %i fully burns within 20-40s', (seed) => {
    const { terrain, forest } = world(seed)
    const r = burn(terrain, forest, seed, 3)
    expect(r.settled).toBe(true)
    expect(r.charredFraction).toBeGreaterThan(0.95)
    expect(r.seconds).toBeGreaterThanOrEqual(20)
    expect(r.seconds).toBeLessThanOrEqual(40)
  })

  it('reaches the whole grove at every wind speed', () => {
    const { terrain, forest } = world(1)
    for (const speed of [0, 4, 8, 12]) {
      expect(burn(terrain, forest, 1, speed).charredFraction).toBeGreaterThan(0.95)
    }
  })

  it('drives the front downwind, which is what the wind control has to show', () => {
    // Total burn time is a poor proxy: it is dominated by the slowest cell's
    // own burn duration. What a viewer actually sees is the front RUNNING
    // downwind, so measure the shape of the burn partway through instead.
    const { terrain, forest } = world(1)

    const frontBias = (speed: number) => {
      const sim = createFireSim(forest, terrain, mulberry32(1234), {
        wind: { speed, directionRad: 0 }, // blowing toward +x
      })
      const origin = centreCell(forest)
      sim.ignite(origin.id)
      for (let t = 0; t < 10; t += 0.05) sim.tick(0.05)

      let sum = 0
      let n = 0
      for (const c of forest.cells) {
        if (sim.states[c.id] !== 0) { sum += c.position[0] - origin.position[0]; n++ }
      }
      return n > 0 ? sum / n : 0
    }

    const calm = frontBias(0)
    const gale = frontBias(12)
    // Under a +x gale the burnt area's centroid must sit clearly downwind of
    // where it sits with no wind at all.
    expect(gale).toBeGreaterThan(calm + 2)
  })
})

describe('water is a firebreak end to end', () => {
  it('never spreads across a disconnected component', () => {
    const { terrain, forest } = world(2)
    const byId = new Map(forest.cells.map((c) => [c.id, c]))
    const start = centreCell(forest)

    const reachable = new Set<number>([start.id])
    const stack = [start.id]
    while (stack.length) {
      const id = stack.pop()!
      for (const nb of byId.get(id)!.neighbors) {
        if (!reachable.has(nb)) { reachable.add(nb); stack.push(nb) }
      }
    }

    const sim = createFireSim(forest, terrain, mulberry32(5))
    sim.ignite(start.id)
    let t = 0
    while (!sim.isSettled() && t < 2000) { sim.tick(0.05); t += 0.05 }

    for (const c of forest.cells) {
      if (!reachable.has(c.id)) expect(sim.states[c.id]).not.toBe(CHARRED)
    }
    // And nothing is left mid-burn once settled.
    expect(Array.from(sim.states).some((s) => s === BURNING)).toBe(false)
  })
})
