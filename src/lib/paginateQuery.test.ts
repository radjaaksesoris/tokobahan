import { describe, expect, it, vi } from 'vitest'
import { fetchAllPages } from './paginateQuery'

describe('fetchAllPages', () => {
  it('fetches every page, including the final partial page', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => index + 1)
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }))

    const result = await fetchAllPages(fetchPage, 2)

    expect(result).toEqual({ data: rows, error: null })
    expect(fetchPage.mock.calls).toEqual([[0, 1], [2, 3], [4, 5]])
  })

  it('stops and returns the first page error', async () => {
    const error = new Error('Request failed')
    const fetchPage = vi.fn(async () => ({ data: null, error }))

    const result = await fetchAllPages(fetchPage, 2)

    expect(result).toEqual({ data: null, error })
    expect(fetchPage).toHaveBeenCalledOnce()
  })

  it('rejects an invalid page size', async () => {
    await expect(fetchAllPages(async () => ({ data: [], error: null }), 0))
      .rejects.toThrow('Ukuran halaman harus berupa bilangan bulat positif')
  })
})
