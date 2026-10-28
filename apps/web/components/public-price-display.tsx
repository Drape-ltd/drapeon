import { formatMoney, normalizeAccountCurrency } from '@drape/shared'
import { ReferenceCurrencyEstimate } from './reference-currency-estimate'

type PublicPriceDisplayProps = {
  amountMinor: number
  currency: string | null | undefined
  prefix?: string
  align?: 'start' | 'end'
  /**
   * Starting-price style for the tailor card: "NGN 120,000+" in place of
   * "From NGN 120,000.00". Naira drops its kobo, rounding down so the "+"
   * stays a true lower bound. Screen readers still hear "From …", since a
   * bare "+" is read as "plus". Display only: formatMoney is unchanged, so
   * checkout, receipts and payouts keep exact minor units.
   */
  startingPrice?: boolean
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
  const wholeNaira = startingPrice && nativeCurrency === 'NGN'
  const nativeAmount = wholeNaira
    ? formatMoney(Math.floor(amountMinor / 100) * 100, nativeCurrency).replace(/\.00$/, '')
    : formatMoney(amountMinor, nativeCurrency)
  const nativeLabel = startingPrice ? `${nativeAmount}+` : `${prefix}${nativeAmount}`
  const spokenLabel = startingPrice ? `From ${nativeAmount}` : nativeLabel
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
          className="mt-0.5 block text-[11px] font-semibold tracking-[0.01em] text-ink/68"
        />
      ) : null}
    </span>
  )
}
