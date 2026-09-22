export type ScreenOrientationPreference = 'any' | 'portrait' | 'landscape'

const SCREEN_ORIENTATION_KEY = 'screen-orientation-preference'

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'portrait' | 'landscape') => Promise<void>
}

export const screenOrientationOptions: Array<{
  value: ScreenOrientationPreference
  label: string
}> = [
  { value: 'any', label: 'Auto rotate' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
]

export function isScreenOrientationPreference(value: string): value is ScreenOrientationPreference {
  return screenOrientationOptions.some((option) => option.value === value)
}

export function getScreenOrientationPreference(): ScreenOrientationPreference {
  if (typeof window === 'undefined') return 'any'

  const stored = window.localStorage.getItem(SCREEN_ORIENTATION_KEY)
  return stored && isScreenOrientationPreference(stored) ? stored : 'any'
}

export function setScreenOrientationPreference(preference: ScreenOrientationPreference) {
  window.localStorage.setItem(SCREEN_ORIENTATION_KEY, preference)
}

export async function applyScreenOrientation(preference: ScreenOrientationPreference) {
  const orientation = typeof screen !== 'undefined' ? screen.orientation as ScreenOrientationWithLock : undefined
  if (!orientation) {
    throw new Error('Browser tablet tidak mendukung pengaturan orientasi layar')
  }

  if (preference === 'any') {
    if (typeof orientation.unlock === 'function') orientation.unlock()
    return
  }

  if (typeof orientation.lock !== 'function') {
    throw new Error('Penguncian orientasi tidak didukung oleh browser tablet ini')
  }

  if (!document.fullscreenElement) {
    throw new Error('Mode Portrait/Landscape membutuhkan aplikasi fullscreen. Gunakan Auto rotate untuk mengikuti putaran tablet.')
  }

  try {
    await orientation.lock(preference)
  } catch {
    throw new Error('Browser menolak penguncian orientasi. Gunakan Auto rotate atau buka aplikasi dalam mode fullscreen.')
  }
}
