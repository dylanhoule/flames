import { test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { generateTerrain } from './terrain'
import { mulberry32 } from './rng'
const out: string[] = []
const log = (...a: unknown[]) => out.push(a.join(' '))

test('water', () => {
  const t = generateTerrain(mulberry32(1790720414))
  const { heightmap: h, waterLevel: w, size } = t
  let max = -Infinity
  for (const v of h) if (v > max) max = v
  const near = (e: number) => h.filter((v) => Math.abs(v - w) < e).length
  log('waterLevel', w.toFixed(3), 'maxHeight', max.toFixed(2), 'relief fraction', (w/max).toFixed(3))
  log('vertices within 0.01 of water level:', near(0.01), `(${(near(0.01)*100/h.length).toFixed(1)}%)`)
  log('vertices within 0.10 of water level:', near(0.10), `(${(near(0.10)*100/h.length).toFixed(1)}%)`)
  log('vertices within 0.50 of water level:', near(0.50), `(${(near(0.50)*100/h.length).toFixed(1)}%)`)
  log('vertices exactly == water level:', h.filter((v) => v === w).length)
  log('area within 0.1 of water:', (near(0.10) * (size/128) ** 2).toFixed(0), 'of', size*size, 'world units^2')
  // sand band top
  log('sand band spans 0 ..', (max*0.05).toFixed(2), '-- water sits at', w.toFixed(2), w < max*0.05 ? '(INSIDE the sand band)' : '(above sand)')
  writeFileSync('/tmp/peak.txt', out.join('\n'))
})
