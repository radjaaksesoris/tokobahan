import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}))

import { rememberCurrentResetGeneration } from './offlineQueueReset'

const RESET_GENERATION_KEY = 'konveksi-pos:operational-reset-generation'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

describe('explicit reset generation tracking', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: 1, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the server reset generation after an explicit reset', async () => {
    await rememberCurrentResetGeneration()

    expect(rpc).toHaveBeenCalledWith('get_operational_reset_generation')
    expect(localStorage.getItem(RESET_GENERATION_KEY)).toBe('1')
  })

  it('does not store an invalid server reset generation', async () => {
    rpc.mockResolvedValue({ data: 'invalid', error: null })

    await expect(rememberCurrentResetGeneration()).rejects.toThrow(
      'Status reset data dari server tidak valid',
    )
    expect(localStorage.getItem(RESET_GENERATION_KEY)).toBeNull()
  })
})
