import {
  readOperationalSnapshot,
  updateOperationalSnapshot,
  type OperationalSnapshot,
  type OperationalSnapshotTable,
} from '@/lib/offlineOperationalSnapshot'

export type OperationalRow = Record<string, unknown>

function validateRows(rows: unknown[]): asserts rows is OperationalRow[] {
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Data operasional lokal tidak valid')
  }
}

function rowId(row: OperationalRow) {
  if (typeof row.id !== 'string' || !row.id) {
    throw new Error('Data operasional lokal tidak memiliki ID yang valid')
  }
  return row.id
}

export async function readOperationalTable<T = OperationalRow>(
  table: OperationalSnapshotTable,
): Promise<T[]> {
  const snapshot = await readOperationalSnapshot<OperationalSnapshot>()
  if (!snapshot) throw new Error('Snapshot lokal belum diinisialisasi')
  return snapshot.tables[table] as T[]
}

export async function replaceOperationalTable(
  table: OperationalSnapshotTable,
  rows: OperationalRow[],
) {
  validateRows(rows)
  await updateOperationalSnapshot((snapshot) => ({
    snapshot: {
      ...snapshot,
      tables: { ...snapshot.tables, [table]: rows },
    },
    result: undefined,
  }))
}

export async function upsertOperationalRows(
  table: OperationalSnapshotTable,
  rows: OperationalRow[],
) {
  validateRows(rows)
  const incoming = new Map(rows.map((row) => [rowId(row), row]))
  return updateOperationalSnapshot((snapshot) => {
    const existingRows = snapshot.tables[table]
    const existing = new Map(existingRows.map((row) => [rowId(row), row]))
    let inserted = 0
    let updated = 0

    for (const [id, row] of incoming) {
      if (existing.has(id)) updated += 1
      else inserted += 1
      existing.set(id, row)
    }

    return {
      snapshot: {
        ...snapshot,
        tables: { ...snapshot.tables, [table]: [...existing.values()] },
      },
      result: { inserted, updated },
    }
  })
}

export async function deleteOperationalRows(
  table: OperationalSnapshotTable,
  ids: string[],
) {
  const deletedIds = new Set(ids)
  return updateOperationalSnapshot((snapshot) => {
    const rows = snapshot.tables[table]
    const remaining = rows.filter((row) => !deletedIds.has(rowId(row)))
    return {
      snapshot: {
        ...snapshot,
        tables: { ...snapshot.tables, [table]: remaining },
      },
      result: rows.length - remaining.length,
    }
  })
}
