import { useMemo, useState } from 'react'
import { Scene } from './Scene'
import { generateTerrain } from './terrain'
import { generateForest } from './forest'
import { mulberry32 } from './rng'
import { BACKDROP } from './visual'

export function App() {
  const [seed, setSeed] = useState(1)

  // One rng threaded through both generators, so a seed fully determines a world.
  const world = useMemo(() => {
    const rng = mulberry32(seed)
    const terrain = generateTerrain(rng)
    const forest = generateForest(terrain, rng)
    return { terrain, forest }
  }, [seed])

  return (
    <div style={{ position: 'fixed', inset: 0, background: `linear-gradient(${BACKDROP.top}, ${BACKDROP.bottom})` }}>
      <Scene terrain={world.terrain} forest={world.forest} sim={null} seed={seed} />
      <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={() => setSeed((s) => s + 1)}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #3a4048',
            background: '#1c1f24', color: '#e6e9ec', cursor: 'pointer', font: 'inherit',
          }}
        >
          Regenerate
        </button>
        <span style={{ opacity: 0.65, fontSize: 12 }}>
          seed {seed} · {world.terrain.landform} · {world.forest.cells.length} trees
        </span>
      </div>
    </div>
  )
}
