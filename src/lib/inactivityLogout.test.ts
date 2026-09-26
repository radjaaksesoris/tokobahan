import { afterEach, describe, expect, it, vi } from 'vitest'
import { startInactivityLogout } from './inactivityLogout'

describe('startInactivityLogout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('logs out after the full inactivity period', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const stop = startInactivityLogout(onTimeout, 10_000, new EventTarget())

    vi.advanceTimersByTime(9_999)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledOnce()
    stop()
  })

  it('restarts the timeout after user activity', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const onTimeout = vi.fn()
    const stop = startInactivityLogout(onTimeout, 10_000, target)

    vi.advanceTimersByTime(9_000)
    target.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(9_000)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(onTimeout).toHaveBeenCalledOnce()
    stop()
  })

  it('cleans up the timeout and activity listeners', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const onTimeout = vi.fn()
    const stop = startInactivityLogout(onTimeout, 10_000, target)
    stop()

    vi.advanceTimersByTime(10_000)
    target.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(10_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
