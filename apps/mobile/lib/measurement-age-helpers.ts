export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function dateFromFields(record: Record<string, unknown> | null, fields: string[]) {
  for (const field of fields) {
    const raw = record?.[field]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const date = new Date(raw)
    if (Number.isFinite(date.getTime())) return date
  }
  return null
}
