import { describe, expect, it } from 'vitest'
import { burnFront, burnIntensity } from './burnShading'
import { BURN, GUST } from './visual'

/**
 * The curve is the contract four subsystems share, so what is worth pinning is
 * its shape, not its values: starts cold, peaks once inside the flash window,
 * never rises again after it, and always stays in range. Retuning the tokens
 * in visual.ts should keep every one of these true.
 */
describe('burnIntensity', () => {
  const samples = Array.from({ length: 201 }, (_, i) => i / 200)

  it('is cold at ignition and still faintly warm at full char', () => {
    expect(burnIntensity(0)).toBe(0)
    expect(burnIntensity(1)).toBeCloseTo(BURN.smoulderLevel, 5)
  })

  it('stays within 0..1 across the whole range', () => {
    for (const p of samples) {
      const v = burnIntensity(p)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('peaks at full intensity inside the crown-flash window', () => {
    let bestP = 0
    let best = -1
    for (const p of samples) {
      const v = burnIntensity(p)
      if (v > best) { best = v; bestP = p }
    }
    expect(best).toBeCloseTo(1, 5)
    expect(bestP).toBeGreaterThanOrEqual(BURN.preheatEnd)
    expect(bestP).toBeLessThanOrEqual(BURN.flashEnd)
  })

  it('rises monotonically to the flash, then decays monotonically', () => {
    const rising = samples.filter((p) => p <= BURN.flashEnd)
    for (let i = 1; i < rising.length; i++) {
      expect(burnIntensity(rising[i]!)).toBeGreaterThanOrEqual(burnIntensity(rising[i - 1]!) - 1e-9)
    }
    const falling = samples.filter((p) => p >= BURN.flashEnd)
    for (let i = 1; i < falling.length; i++) {
      expect(burnIntensity(falling[i]!)).toBeLessThanOrEqual(burnIntensity(falling[i - 1]!) + 1e-9)
    }
  })
})

describe('burnFront', () => {
  it('sweeps from the base to the crown, arriving at the crown flash', () => {
    expect(burnFront(0)).toBe(0)
    expect(burnFront(BURN.frontStart)).toBe(0)
    expect(burnFront(BURN.flashEnd)).toBe(1)
    expect(burnFront(1)).toBe(1)
  })

  it('never retreats', () => {
    for (let i = 1; i <= 200; i++) {
      expect(burnFront(i / 200)).toBeGreaterThanOrEqual(burnFront((i - 1) / 200) - 1e-9)
    }
  })
})

describe('gust tokens', () => {
  it('keeps the surge multiplier positive at every wind speed', () => {
    // The gust multiplies intensity, so a depth that could drive it to or past
    // zero would blink the whole fire out at the bottom of a cycle.
    const worst = 1 - GUST.depth
    expect(worst).toBeGreaterThan(0)
  })
})
