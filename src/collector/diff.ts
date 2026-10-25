import type { WriteEvent } from 'party-db'

// party-db has no upsert, and an update that hits no row fails the whole
// commit, so ops are chosen against the rows the table holds now. Rows
// missing from `next` are deleted.
export function diffOps<T extends Record<string, unknown>>(
  current: T[],
  next: T[],
  key: keyof T,
  changed: (prev: T, row: T) => boolean,
): WriteEvent<T>[] {
  const byKey = new Map(current.map((row) => [row[key], row]))
  const ops: WriteEvent<T>[] = []
  for (const row of next) {
    const prev = byKey.get(row[key])
    if (!prev) ops.push({ type: 'insert', value: row })
    else if (changed(prev, row)) ops.push({ type: 'update', value: row })
    byKey.delete(row[key])
  }
  for (const value of byKey.values()) ops.push({ type: 'delete', value })
  return ops
}

export function anyFieldChanged<T extends Record<string, unknown>>(prev: T, row: T) {
  return Object.keys(row).some((k) => prev[k] !== row[k])
}
