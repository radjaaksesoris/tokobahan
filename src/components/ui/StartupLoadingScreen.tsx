import { useEffect, useState } from 'react'

const MIN_STARTUP_LOADING_MS = 5000
const startupStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

export type StartupLoadingPhase = 'access' | 'data' | 'page'

const phases: { id: StartupLoadingPhase; label: string }[] = [
  { id: 'access', label: 'Akses admin' },
  { id: 'data', label: 'Data toko lokal' },
  { id: 'page', label: 'Ringkasan hari ini' },
]

export function useStartupMinimumTime(isReady: boolean) {
  const [minimumTimeElapsed, setMinimumTimeElapsed] = useState(
    () => performance.now() - startupStartedAt >= MIN_STARTUP_LOADING_MS,
  )

  useEffect(() => {
    if (!isReady || minimumTimeElapsed) return
    const remaining = Math.max(
      0,
      MIN_STARTUP_LOADING_MS - (performance.now() - startupStartedAt),
    )
    const timer = window.setTimeout(() => setMinimumTimeElapsed(true), remaining)
    return () => window.clearTimeout(timer)
  }, [isReady, minimumTimeElapsed])

  return minimumTimeElapsed
}

export function StartupLoadingScreen({ phase }: { phase: StartupLoadingPhase }) {
  const activeIndex = phases.findIndex((item) => item.id === phase)
  const status = phase === 'access'
    ? 'Memeriksa sesi dan akses admin'
    : phase === 'data'
      ? 'Membaca data toko dan transaksi lokal'
      : 'Menyiapkan ringkasan untuk hari ini'

  return (
    <section className="startup-screen" role="status" aria-label="Menyiapkan aplikasi">
      <div className="startup-screen__content">
        <div className="startup-screen__brand">
          <img src={`${import.meta.env.BASE_URL}icon-96.png`} alt="" />
          <span>RAJA AKSESORIS</span>
        </div>

        <div className="startup-screen__heading">
          <p className="startup-screen__eyebrow">RUANG KERJA TOKO</p>
          <h1>Menyiapkan semuanya</h1>
          <p className="startup-screen__status">{status}</p>
        </div>

        <ol className="startup-screen__steps" aria-label="Tahap persiapan">
          {phases.map((item, index) => {
            const complete = index < activeIndex
            const current = index === activeIndex
            return (
              <li
                key={item.id}
                className={complete ? 'is-complete' : current ? 'is-current' : ''}
                aria-current={current ? 'step' : undefined}
              >
                <div className="startup-screen__step-row">
                  <span className="startup-screen__step-mark" aria-hidden="true">
                    {complete ? '✓' : String(index + 1).padStart(2, '0')}
                  </span>
                  <span>{item.label}</span>
                </div>
                {index < phases.length - 1 && (
                  <span
                    className={`startup-screen__step-arrow${index === activeIndex ? ' is-active' : ''}`}
                    aria-hidden="true"
                  >
                    ↓
                  </span>
                )}
              </li>
            )
          })}
        </ol>

        <p className="startup-screen__footer">Data tetap tersimpan di perangkat ini</p>
      </div>
    </section>
  )
}
