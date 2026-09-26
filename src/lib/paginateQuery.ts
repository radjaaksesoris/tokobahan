interface PageResult<T, E> {
  data: T[] | null
  error: E | null
}

export async function fetchAllPages<T, E>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T, E>>,
  pageSize = 500,
): Promise<PageResult<T, E>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('Ukuran halaman harus berupa bilangan bulat positif')
  }

  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1)
    if (error) return { data: null, error }

    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) return { data: rows, error: null }
  }
}
