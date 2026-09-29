export type ProductNameSuggestion = {
  id: string
  name: string
  sku: string | null
}

export type ProductNameSuggestionResult =
  | { status: 'loading' }
  | { status: 'matches'; matches: ProductNameSuggestion[] }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'cancelled' }

type ProductNameSuggestionQuery = (
  term: string,
  signal: AbortSignal,
) => Promise<{ data: ProductNameSuggestion[] | null; error: unknown | null }>

export function normalizeProductNameSuggestionTerm(value: string) {
  return value.trim().replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function requestProductNameSuggestions(
  query: ProductNameSuggestionQuery,
  value: string,
  signal: AbortSignal,
): Promise<ProductNameSuggestionResult> {
  const term = normalizeProductNameSuggestionTerm(value)
  if (!term) return { status: 'empty' }

  try {
    const { data, error } = await query(term, signal)
    if (signal.aborted) return { status: 'cancelled' }
    if (error) return { status: 'error' }

    const normalizedTerm = term.toLocaleLowerCase()
    const matches = (data || [])
      .filter((product) => product.name.toLocaleLowerCase().includes(normalizedTerm))
      .sort((first, second) => (
        first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }) ||
        first.id.localeCompare(second.id)
      ))
      .slice(0, 5)

    return matches.length ? { status: 'matches', matches } : { status: 'empty' }
  } catch {
    return signal.aborted ? { status: 'cancelled' } : { status: 'error' }
  }
}
