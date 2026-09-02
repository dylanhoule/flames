import { BACKDROP } from './visual'

/** Placeholder shell. The diorama Scene lands here in Phase 2. */
export function App() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: `linear-gradient(${BACKDROP.top}, ${BACKDROP.bottom})`,
      }}
    />
  )
}
