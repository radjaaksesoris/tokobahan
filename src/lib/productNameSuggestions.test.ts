import { describe, expect, it } from 'vitest'
import {
  normalizeProductNameSuggestionTerm,
  requestProductNameSuggestions,
  type ProductNameSuggestion,
} from './productNameSuggestions'

const products: ProductNameSuggestion[] = [
  { id: '5', name: 'Kabel USB', sku: 'USB-5' },
  { id: '4', name: 'Kabel Data', sku: null },
  { id: '3', name: 'Kabel Type C', sku: 'TYPE-C' },
  { id: '2', name: 'Kabel Charger', sku: 'CHARGER' },
  { id: '1', name: 'Kabel Audio', sku: 'AUDIO' },
  { id: '6', name: 'Kabel Power', sku: 'POWER' },
  { id: '7', name: 'Adaptor USB', sku: 'ADAPTOR' },
]

describe('product name suggestions', () => {
  it('normalizes whitespace and prevents user wildcard characters from broadening searches', () => {
    expect(normalizeProductNameSuggestionTerm('  kabel   %_ data  ')).toBe('kabel data')
  })

  it('returns up to five active-name substring matches in name order, case-insensitively', async () => {
    const queriedTerms: string[] = []
    const controller = new AbortController()
    const result = await requestProductNameSuggestions(async (term) => {
      queriedTerms.push(term)
      return { data: products, error: null }
    }, 'KaBeL', controller.signal)

    expect(queriedTerms).toEqual(['KaBeL'])
    expect(result).toEqual({
      status: 'matches',
      matches: [
        { id: '1', name: 'Kabel Audio', sku: 'AUDIO' },
        { id: '2', name: 'Kabel Charger', sku: 'CHARGER' },
        { id: '4', name: 'Kabel Data', sku: null },
        { id: '6', name: 'Kabel Power', sku: 'POWER' },
        { id: '3', name: 'Kabel Type C', sku: 'TYPE-C' },
      ],
    })
  })

  it('returns empty without querying for a blank or wildcard-only name', async () => {
    let queried = false
    const query = async () => {
      queried = true
      return { data: products, error: null }
    }
    const controller = new AbortController()

    await expect(requestProductNameSuggestions(query, '   ', controller.signal))
      .resolves.toEqual({ status: 'empty' })
    await expect(requestProductNameSuggestions(query, '%_', controller.signal))
      .resolves.toEqual({ status: 'empty' })
    expect(queried).toBe(false)
  })

  it('distinguishes no matches from a failed request', async () => {
    const controller = new AbortController()
    await expect(requestProductNameSuggestions(async () => ({
      data: [{ id: '1', name: 'Charger', sku: null }],
      error: null,
    }), 'kabel', controller.signal)).resolves.toEqual({ status: 'empty' })

    await expect(requestProductNameSuggestions(async () => ({
      data: null,
      error: new Error('offline'),
    }), 'kabel', controller.signal)).resolves.toEqual({ status: 'error' })
  })

  it('discards responses from requests cancelled while awaiting results', async () => {
    const controller = new AbortController()
    let resolveQuery: ((value: { data: ProductNameSuggestion[]; error: null }) => void) | undefined
    const pending = requestProductNameSuggestions(
      () => new Promise((resolve) => { resolveQuery = resolve }),
      'kabel',
      controller.signal,
    )

    controller.abort()
    resolveQuery?.({ data: products, error: null })

    await expect(pending).resolves.toEqual({ status: 'cancelled' })
  })

  it('reports thrown query failures unless the request was cancelled', async () => {
    const controller = new AbortController()
    await expect(requestProductNameSuggestions(async () => {
      throw new Error('offline')
    }, 'kabel', controller.signal)).resolves.toEqual({ status: 'error' })
  })
})
