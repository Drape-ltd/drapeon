import type { AccountCurrencyCode } from './currency-config.ts'

export type ReferenceFxRateRow = {
  date: string
  base: 'USD'
  quote: AccountCurrencyCode
  rate: number
}

/** Parse Frankfurter v2 rows and reject malformed, stale-shape, or mixed-date data. */
export function parseReferenceFxRates(
  payload: unknown,
  expectedQuotes: readonly AccountCurrencyCode[]
): { date: string; rates: Partial<Record<AccountCurrencyCode, number>> } | null {
  if (!Array.isArray(payload)) return null

  const rows = payload as Array<Record<string, unknown>>
  const neededQuotes = expectedQuotes.filter((code) => code !== 'USD')
  const rates: Partial<Record<AccountCurrencyCode, number>> = { USD: 1 }
  const dates = new Set<string>()

  for (const quote of neededQuotes) {
    const row = rows.find((candidate) => candidate.quote === quote && candidate.base === 'USD')
    if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null
    if (typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0) return null
    dates.add(row.date)
    rates[quote] = row.rate
  }

  // Never combine quote legs published on different dates and present them as one rate.
  if (dates.size !== 1) return null
  return { date: dates.values().next().value!, rates }
}

/** Convert minor units for display only; absent live legs return null, never a guessed rate. */
export function convertWithReferenceFxRates(
  amountMinor: number,
  from: AccountCurrencyCode,
  to: AccountCurrencyCode,
  rates: Partial<Record<AccountCurrencyCode, number>>
): number | null {
  if (!Number.isFinite(amountMinor)) return null
  const fromRate = rates[from]
  const toRate = rates[to]
  if (!fromRate || !toRate || !Number.isFinite(fromRate) || !Number.isFinite(toRate)) return null
  return Math.round((amountMinor / fromRate) * toRate)
}
