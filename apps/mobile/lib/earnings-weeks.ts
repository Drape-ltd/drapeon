// Groups a tailor's order earnings into calendar weeks (Monday start, local
// time) so the Payments screen can show "this week" totals and a per-day bar
// chart, the way delivery apps present a driver's pay.

type EarningLike = {
  date: string
  netAmount: number
  netCurrency: string
  /** Only settled earnings count; unpaid, refunded or cancelled orders never add to a total. */
  settled?: boolean
  /** When the money was earned; preferred over `date` (which moves on every order update). */
  earnedAt?: string
}

export type EarningsWeek<T extends EarningLike> = {
  start: Date
  end: Date
  total: number
  /** Rows that were added into `total` (settled, in the summary currency). */
  countedRows: number
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
 * first. Unsettled rows (unpaid, refunded, cancelled) are left out entirely.
 * Only rows in `currency` count toward totals so amounts are never mixed
 * across currencies; settled rows in other currencies still appear in `rows`.
 * Rows are placed by `earnedAt` (falling back to `date`).
 */
export function groupEarningsByWeek<T extends EarningLike>(rows: readonly T[], currency: string, now = new Date()): EarningsWeek<T>[] {
  const current = startOfWeek(now)
  const dated = rows
    .filter((row) => row.settled !== false)
    .map((row) => ({ row, at: new Date(row.earnedAt ?? row.date) }))
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
    let countedRows = 0
    for (const { row, at } of inWeek) {
      if (row.netCurrency !== currency) continue
      dayTotals[(at.getDay() + 6) % 7] += row.netAmount
      total += row.netAmount
      countedRows += 1
    }
    weeks.push({ start, end: new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1), total, countedRows, dayTotals, rows: inWeek.map(({ row }) => row) })
    if (weeks.length > 104) break
  }
  return weeks
}
