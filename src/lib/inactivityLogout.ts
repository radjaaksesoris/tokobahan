const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'focus'] as const

export function startInactivityLogout(
  onTimeout: () => void,
  timeoutMs: number,
  target: EventTarget = window,
) {
  let timeout = globalThis.setTimeout(onTimeout, timeoutMs)
  const resetTimeout = () => {
    globalThis.clearTimeout(timeout)
    timeout = globalThis.setTimeout(onTimeout, timeoutMs)
  }

  ACTIVITY_EVENTS.forEach((eventName) => target.addEventListener(eventName, resetTimeout))

  return () => {
    globalThis.clearTimeout(timeout)
    ACTIVITY_EVENTS.forEach((eventName) => target.removeEventListener(eventName, resetTimeout))
  }
}
