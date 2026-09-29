import { normalizeProductNameForDuplicate } from './productNameSuggestions'

export type ProductNameAvailabilityResult =
  | { status: 'available' }
  | { status: 'duplicate' }
  | { status: 'empty' }
  | { status: 'error'; error: unknown }
  | { status: 'cancelled' }

type ProductNameAvailabilityQuery = (
  normalizedName: string,
  signal: AbortSignal,
) => Promise<{ data: boolean | null; error: unknown | null }>

export async function requestProductNameAvailability(
  query: ProductNameAvailabilityQuery,
  value: string,
  signal: AbortSignal,
): Promise<ProductNameAvailabilityResult> {
  const normalizedName = normalizeProductNameForDuplicate(value)
  if (!normalizedName) return { status: 'empty' }
  if (signal.aborted) return { status: 'cancelled' }

  try {
    const { data, error } = await query(normalizedName, signal)
    if (signal.aborted) return { status: 'cancelled' }
    if (error) return { status: 'error', error }
    if (data === null) return { status: 'error', error: new Error('Availability check returned no result') }
    return data ? { status: 'duplicate' } : { status: 'available' }
  } catch (error) {
    return signal.aborted ? { status: 'cancelled' } : { status: 'error', error }
  }
}
