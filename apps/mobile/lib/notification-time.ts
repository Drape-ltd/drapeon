/** Postgres timestamp columns may arrive without a timezone suffix, but are UTC. */
export function notificationTime(iso: string): number {
  const timestamp = iso.replace(' ', 'T')
  if (!/T\d{2}:\d{2}/.test(timestamp)) return new Date(timestamp).getTime()
  const withTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(timestamp)
    ? timestamp
    : `${timestamp}Z`
  return new Date(withTimezone).getTime()
}
