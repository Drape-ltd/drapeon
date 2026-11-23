import { formatBrowseMoney, formatMoney, normalizeAccountCurrency } from '@drape/shared'
import { ReferenceCurrencyEstimate } from './reference-currency-estimate'

type PublicPriceDisplayProps = {
  amountMinor: number
  currency: string | null | undefined
  prefix?: string
  align?: 'start' | 'end'
  /** Browse-only starting-price label. Transaction money continues using `formatMoney`. */
  startingPrice?: boolean
  compactWholeAmounts?: boolean
}

/**
 * Public discovery keeps the tailor's currency authoritative and adds an
 * explicitly-labelled USD estimate for international visitors. This helper
 * must never be used for checkout, order, payout, or ledger calculations.
 */
export function PublicPriceDisplay({
  amountMinor,
  currency,
  prefix = '',
  align = 'start',
  startingPrice = false,
  compactWholeAmounts = false,
}: PublicPriceDisplayProps): React.JSX.Element {
  const nativeCurrency = normalizeAccountCurrency(currency)
  if (!nativeCurrency) {
    return (
      <span
        className={align === 'end' ? 'text-right' : 'text-left'}
        aria-label="Price available in tailor currency"
      >
        <span className="block">Price available in tailor currency</span>
      </span>
    )
  }
  const nativeAmount = startingPrice || compactWholeAmounts
    ? formatBrowseMoney(amountMinor, nativeCurrency)
    : formatMoney(amountMinor, nativeCurrency)
  const nativeLabel = startingPrice ? `From ${nativeAmount}` : `${prefix}${nativeAmount}`
  const spokenLabel = nativeLabel
  const hasUsdEstimate = nativeCurrency !== 'USD'

  return (
    <span
      className={align === 'end' ? 'text-right' : 'text-left'}
      aria-label={
        hasUsdEstimate
          ? `${spokenLabel}; an approximate USD display conversion may appear with its rate source and date`
          : spokenLabel
      }
    >
      <span className="block">{nativeLabel}</span>
      {hasUsdEstimate ? (
        <ReferenceCurrencyEstimate
          amountMinor={amountMinor}
          from={nativeCurrency}
          to="USD"
          compactWholeAmounts={startingPrice || compactWholeAmounts}
          className="mt-0.5 block text-[11px] font-semibold tracking-[0.01em] text-ink/68"
        />
      ) : null}
    </span>
  )
}
