const REALTIME_FILTER_VALUE_PATTERN = /^[A-Za-z0-9_-]{6,120}$/

export function isRealtimeFilterValue(
  value: string | null | undefined
): value is string {
  return typeof value === 'string' && REALTIME_FILTER_VALUE_PATTERN.test(value)
}

export function uniqueRealtimeOrderIds(
  values: Array<string | null | undefined>,
  limit = 60
): string[] {
  const ids = new Set<string>()
  for (const value of values) {
    if (isRealtimeFilterValue(value)) ids.add(value)
  }
  return [...ids].slice(0, Math.max(0, limit))
}
