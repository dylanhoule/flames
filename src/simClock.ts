/**
 * Playback clock shared by every animation loop, so one speed slider rescales
 * the physics and the visuals together. `time` is scaled seconds since the
 * world was built (what the shader uTime uniforms read); `scale` converts wall
 * seconds to simulated seconds.
 *
 * ponytail: module singleton rather than a context. The app mounts exactly one
 * Scene; make it a context if a second one ever appears.
 */
export const simClock = { scale: 1, time: 0 }

/** Slider 1.0x is half the pace the sim was originally tuned for. */
export const REALTIME_SCALE = 0.5
