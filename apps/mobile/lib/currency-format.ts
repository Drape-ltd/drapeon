import type { AccountCurrencyCode } from '@drape/shared'

export type CurrencyRates = Partial<Record<AccountCurrencyCode, number>>

export function formatConvertedMinorAmount(
  amountMinorUnits: number,
  fromCurrency: AccountCurrencyCode,
  toCurrency: AccountCurrencyCode,
  rates: CurrencyRates,
  symbol: string,
): string {
  const amount = amountMinorUnits / 100
  const fromRate = rates[fromCurrency] ?? 1
  const toRate = rates[toCurrency] ?? 1
  const converted = (amount / fromRate) * toRate

  return `${symbol}${converted.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
