import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scene } from './Scene'
import { Controls } from './ui/Controls'
import { generateTerrain } from './terrain'
import { generateForest } from './forest'
import { createFireSim } from './fire'
import { mulberry32 } from './rng'
import { BACKDROP } from './visual'
import { BURNING, CHARRED } from './types'
import type { Wind } from './types'

export function App() {
  // Lazy initial state, so a page refresh is a fresh world rather than seed 1.
  const [seed, setSeed] = useState(() => (Math.random() * 0x7fffffff) >>> 0)
  const [wind, setWind] = useState<Wind>({ speed: 3, directionRad: 0 })
  const [tally, setTally] = useState({ burning: 0, charred: 0, elapsed: 0 })
  const clock = useRef({ elapsed: 0 })

  // One rng threaded through both generators, so a seed fully determines a
  // world. Regenerate is always enabled, including mid-burn: this rebuilds
  // terrain, forest and sim outright rather than resetting burn state.
  const world = useMemo(() => {
    const rng = mulberry32(seed)
    const terrain = generateTerrain(rng)
    const forest = generateForest(terrain, rng)
    const sim = createFireSim(forest, terrain, mulberry32(seed ^ 0x5bf0), { wind: { ...wind } })
    return { terrain, forest, sim }
    // wind is deliberately not a dependency: changing it must not rebuild the
    // world, it is pushed onto the live sim below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  // Wind is live-adjustable; push it straight at the running simulation.
  useEffect(() => {
    world.sim.wind = { ...wind }
  }, [wind, world])

  // Poll the sim for the HUD counts. Cheap, and keeps sim state out of React.
  useEffect(() => {
    clock.current.elapsed = 0
    const id = setInterval(() => {
      let burning = 0
      let charred = 0
      for (const s of world.sim.states) {
        if (s === BURNING) burning++
        else if (s === CHARRED) charred++
      }
      const elapsed = Math.round(clock.current.elapsed)
      setTally((prev) =>
        prev.burning === burning && prev.charred === charred && prev.elapsed === elapsed
          ? prev
          : { burning, charred, elapsed },
      )
    }, 120)
    return () => clearInterval(id)
  }, [world])

  const ignite = useCallback((cellId: number) => world.sim.ignite(cellId), [world])

  return (
    <div style={{ position: 'fixed', inset: 0, background: `linear-gradient(${BACKDROP.top}, ${BACKDROP.bottom})` }}>
      <Scene
        key={seed}
        terrain={world.terrain}
        forest={world.forest}
        sim={world.sim}
        wind={wind}
        seed={seed}
        onIgnite={ignite}
        clock={clock.current}
      />
      <Controls
        wind={wind}
        onWind={setWind}
        onRegenerate={() => setSeed((s) => s + 1)}
        seed={seed}
        landform={world.terrain.landform}
        treeCount={world.forest.cells.length}
        burning={tally.burning}
        charred={tally.charred}
        elapsed={tally.elapsed}
      />
    </div>
  )
}
