import { describe, it, expect } from 'vitest'
import { mulberry32, range, int, pick } from './rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const from = (r: () => number) => Array.from({ length: 20 }, r)
    expect(from(a)).toEqual(from(b))
  })

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1))
    const b = Array.from({ length: 20 }, mulberry32(2))
    expect(a).not.toEqual(b)
  })

  it('stays within [0, 1)', () => {
    const r = mulberry32(99)
    for (let i = 0; i < 10000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('helpers respect their bounds', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = range(r, -5, 5)
      expect(v).toBeGreaterThanOrEqual(-5)
      expect(v).toBeLessThan(5)
      const n = int(r, 4)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(4)
      expect(['a', 'b', 'c']).toContain(pick(r, ['a', 'b', 'c']))
    }
  })
})
