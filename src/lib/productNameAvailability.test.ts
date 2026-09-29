import { describe, expect, it } from 'vitest'
import { requestProductNameAvailability } from './productNameAvailability'

describe('product name availability', () => {
  it('checks the trimmed, whitespace-collapsed, case-insensitive name', async () => {
    const queriedNames: string[] = []
    const controller = new AbortController()
    const result = await requestProductNameAvailability(async (name) => {
      queriedNames.push(name)
      return { data: true, error: null }
    }, '  Kabel\t  Type   C  ', controller.signal)

    expect(queriedNames).toEqual(['kabel type c'])
    expect(result).toEqual({ status: 'duplicate' })
  })

  it('returns available when the normalized name is unused', async () => {
    const controller = new AbortController()
    await expect(requestProductNameAvailability(async () => ({
      data: false,
      error: null,
    }), 'Kabel Baru', controller.signal)).resolves.toEqual({ status: 'available' })
  })

  it('does not query for a blank name', async () => {
    let queried = false
    const controller = new AbortController()
    await expect(requestProductNameAvailability(async () => {
      queried = true
      return { data: false, error: null }
    }, ' \t ', controller.signal)).resolves.toEqual({ status: 'empty' })
    expect(queried).toBe(false)
  })

  it('reports query errors and thrown failures', async () => {
    const controller = new AbortController()
    await expect(requestProductNameAvailability(async () => ({
      data: null,
      error: new Error('offline'),
    }), 'Kabel', controller.signal)).resolves.toMatchObject({ status: 'error' })
    await expect(requestProductNameAvailability(async () => {
      throw new Error('offline')
    }, 'Kabel', controller.signal)).resolves.toMatchObject({ status: 'error' })
  })

  it('discards a response after cancellation', async () => {
    const controller = new AbortController()
    let resolveQuery: ((value: { data: boolean; error: null }) => void) | undefined
    const pending = requestProductNameAvailability(
      () => new Promise((resolve) => { resolveQuery = resolve }),
      'Kabel',
      controller.signal,
    )

    controller.abort()
    resolveQuery?.({ data: true, error: null })

    await expect(pending).resolves.toEqual({ status: 'cancelled' })
  })

  it('does not start an already-cancelled request', async () => {
    let queried = false
    const controller = new AbortController()
    controller.abort()
    await expect(requestProductNameAvailability(async () => {
      queried = true
      return { data: false, error: null }
    }, 'Kabel', controller.signal)).resolves.toEqual({ status: 'cancelled' })
    expect(queried).toBe(false)
  })
})
