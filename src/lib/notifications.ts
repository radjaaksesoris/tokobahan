const SOUND_ENABLED_KEY = 'tokobahan.low-stock-sound-enabled'

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

export function isStockSoundEnabled() {
  return window.localStorage.getItem(SOUND_ENABLED_KEY) === 'true'
}

export function setStockSoundEnabled(enabled: boolean) {
  window.localStorage.setItem(SOUND_ENABLED_KEY, String(enabled))
}

export function playLowStockSound() {
  if (!isStockSoundEnabled()) return

  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return

  const context = new AudioContextClass()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const now = context.currentTime

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(880, now)
  oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.22)
  oscillator.addEventListener('ended', () => {
    void context.close()
  }, { once: true })
}
