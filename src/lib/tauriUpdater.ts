export interface TauriUpdateInfo {
  version: string
  notes?: string
  date?: string
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function checkTauriUpdate(): Promise<TauriUpdateInfo | null> {
  if (!isTauriRuntime()) return null

  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null

  return {
    version: update.version,
    notes: update.body ?? undefined,
    date: update.date ?? undefined,
  }
}

export async function installTauriUpdate(onProgress?: (percent: number | null) => void) {
  if (!isTauriRuntime()) return false

  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return false

  let downloaded = 0
  let contentLength: number | undefined
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      contentLength = event.data.contentLength
      onProgress?.(0)
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      onProgress?.(contentLength ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : null)
    } else if (event.event === 'Finished') {
      onProgress?.(100)
    }
  })

  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
  return true
}
