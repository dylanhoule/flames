import type { Landform, Wind } from '../types'

export interface ControlsProps {
  wind: Wind
  onWind: (w: Wind) => void
  speed: number
  onSpeed: (s: number) => void
  onRegenerate: () => void
  seed: number
  landform: Landform
  treeCount: number
  burning: number
  charred: number
  elapsed: number
}

/**
 * HTML overlay outside the canvas. Wind is the demo's main interactive lever,
 * so it gets both a numeric speed and a direction dial you can see pointing.
 */
export function Controls({
  wind, onWind, speed, onSpeed, onRegenerate, seed, landform, treeCount, burning, charred, elapsed,
}: ControlsProps) {
  const deg = Math.round((wind.directionRad * 180) / Math.PI)
  return (
    <div className="panel">
      <button className="panel-button" onClick={onRegenerate}>Regenerate</button>

      <label className="panel-field">
        <span>wind {wind.speed.toFixed(1)} m/s</span>
        <input
          type="range" min={0} max={14} step={0.5} value={wind.speed}
          onChange={(e) => onWind({ ...wind, speed: Number(e.target.value) })}
        />
      </label>

      <label className="panel-field">
        <span>direction {deg}&deg;</span>
        <input
          type="range" min={0} max={360} step={5} value={deg}
          onChange={(e) => onWind({ ...wind, directionRad: (Number(e.target.value) * Math.PI) / 180 })}
        />
      </label>

      <Compass directionRad={wind.directionRad} speed={wind.speed} />

      <label className="panel-field">
        <span>speed {speed.toFixed(2)}&times;</span>
        <input
          type="range" min={0.25} max={3} step={0.05} value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
        />
      </label>

      <span className="panel-stats">
        seed {seed} &middot; {landform}<br />
        {treeCount} trees &middot; {burning} burning &middot; {charred} charred &middot; {elapsed}s
      </span>
    </div>
  )
}

/** Arrow points the way the wind blows, matching Wind.directionRad. */
function Compass({ directionRad, speed }: { directionRad: number; speed: number }) {
  const size = 40
  const r = size / 2
  // +x is 0 and +z is 90 degrees in world space; screen y grows downward.
  const x = r + Math.cos(directionRad) * r * 0.66
  const y = r + Math.sin(directionRad) * r * 0.66
  const color = speed > 0 ? '#ff9a4a' : '#5d666f'
  return (
    <svg width={size} height={size} aria-label="wind direction">
      <circle cx={r} cy={r} r={r - 1} fill="#181b1f" stroke="#3a4048" />
      {/* shaft stops short so it does not poke through the head */}
      <line
        x1={r - (x - r)} y1={r - (y - r)}
        x2={r + (x - r) * 0.6} y2={r + (y - r) * 0.6}
        stroke={color} strokeWidth={2} strokeLinecap="round"
      />
      <polygon
        points="0,-4.5 8,0 0,4.5" fill={color}
        transform={`translate(${x} ${y}) rotate(${(directionRad * 180) / Math.PI}) translate(-8 0)`}
      />
    </svg>
  )
}
