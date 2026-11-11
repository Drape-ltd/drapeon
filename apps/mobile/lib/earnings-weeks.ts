// Groups a tailor's order earnings into calendar weeks (Monday start, local
// time) so the Payments screen can show "this week" totals and a per-day bar
// chart, the way delivery apps present a driver's pay.

type EarningLike = { date: string; netAmount: number; netCurrency: string }

export type EarningsWeek<T extends EarningLike> = {
  start: Date
  end: Date
  total: number
  dayTotals: number[]
  rows: T[]
}

export function startOfWeek(value: Date): Date {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const offset = (date.getDay() + 6) % 7 // Monday = 0
  date.setDate(date.getDate() - offset)
  return date
}

/**
 * Weeks from the week containing `now` back to the oldest earning, newest
 * first. Only rows in `currency` count toward totals so amounts are never
 * mixed across currencies; rows in other currencies still appear in `rows`.
 */
export function groupEarningsByWeek<T extends EarningLike>(rows: readonly T[], currency: string, now = new Date()): EarningsWeek<T>[] {
  const current = startOfWeek(now)
  const dated = rows
    .map((row) => ({ row, at: new Date(row.date) }))
    .filter(({ at }) => Number.isFinite(at.getTime()))
  const oldest = dated.reduce((min, { at }) => (at < min ? at : min), current)
  const weeks: EarningsWeek<T>[] = []
  for (let start = current; start >= startOfWeek(oldest); start = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7)) {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
    const inWeek = dated
      .filter(({ at }) => at >= start && at < end)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
    const dayTotals = [0, 0, 0, 0, 0, 0, 0]
    let total = 0
    for (const { row, at } of inWeek) {
      if (row.netCurrency !== currency) continue
      dayTotals[(at.getDay() + 6) % 7] += row.netAmount
      total += row.netAmount
    }
    weeks.push({ start, end: new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1), total, dayTotals, rows: inWeek.map(({ row }) => row) })
    if (weeks.length > 104) break
  }
  return weeks
}
