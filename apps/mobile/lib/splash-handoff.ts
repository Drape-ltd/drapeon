/**
 * One-way signal from the route guard (which owns when the native splash may go) to the
 * splash overlay (which owns what the user sees next). A module-level store rather than
 * React state so marking the handoff cannot re-render the provider tree during startup.
 */
let handedOff = false
const listeners = new Set<() => void>()

export function markNativeSplashHidden() {
  if (handedOff) return
  handedOff = true
  for (const listener of listeners) listener()
}

export function isNativeSplashHidden() {
  return handedOff
}

export function subscribeNativeSplashHidden(listener: () => void) {
  if (handedOff) {
    listener()
    return () => {}
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
