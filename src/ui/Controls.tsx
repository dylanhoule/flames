import type { Landform, Wind } from '../types'

const PANEL: React.CSSProperties = {
  position: 'absolute', left: 16, bottom: 16,
  display: 'flex', gap: 18, alignItems: 'center',
  padding: '12px 16px', borderRadius: 12,
  background: 'rgba(20,22,25,0.82)', border: '1px solid #333a42',
  backdropFilter: 'blur(8px)', color: '#e6e9ec', fontSize: 12,
}

const BUTTON: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #3a4048',
  background: '#22262c', color: '#e6e9ec', cursor: 'pointer', font: 'inherit',
}

export interface ControlsProps {
  wind: Wind
  onWind: (w: Wind) => void
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
  wind, onWind, onRegenerate, seed, landform, treeCount, burning, charred, elapsed,
}: ControlsProps) {
  const deg = Math.round((wind.directionRad * 180) / Math.PI)
  return (
    <div style={PANEL}>
      <button style={BUTTON} onClick={onRegenerate}>Regenerate</button>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ opacity: 0.7 }}>wind {wind.speed.toFixed(1)} m/s</span>
        <input
          type="range" min={0} max={14} step={0.5} value={wind.speed}
          onChange={(e) => onWind({ ...wind, speed: Number(e.target.value) })}
          style={{ width: 130 }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ opacity: 0.7 }}>direction {deg}&deg;</span>
        <input
          type="range" min={0} max={360} step={5} value={deg}
          onChange={(e) => onWind({ ...wind, directionRad: (Number(e.target.value) * Math.PI) / 180 })}
          style={{ width: 130 }}
        />
      </label>

      <Compass directionRad={wind.directionRad} speed={wind.speed} />

      <span style={{ opacity: 0.6, lineHeight: 1.5 }}>
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
  return (
    <svg width={size} height={size} aria-label="wind direction">
      <circle cx={r} cy={r} r={r - 1} fill="#181b1f" stroke="#3a4048" />
      <line
        x1={r - (x - r)} y1={r - (y - r)} x2={x} y2={y}
        stroke={speed > 0 ? '#ff9a4a' : '#5d666f'} strokeWidth={2} strokeLinecap="round"
      />
      <circle cx={x} cy={y} r={3} fill={speed > 0 ? '#ff9a4a' : '#5d666f'} />
    </svg>
  )
}
