import {
  convertAccountCurrencyEstimate,
  formatMoney,
  normalizeAccountCurrency,
} from '@drape/shared'

type PublicPriceDisplayProps = {
  amountMinor: number
  currency: string | null | undefined
  prefix?: string
  align?: 'start' | 'end'
  /**
   * Drops the trailing "· estimate" word for compact surfaces like the tailor
   * card. The "≈" and the screen-reader "approximately" still mark the USD
   * figure as approximate.
   */
  hideEstimateLabel?: boolean
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
  hideEstimateLabel = false,
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
  const usdEstimate = nativeCurrency === 'USD'
    ? null
    : formatMoney(convertAccountCurrencyEstimate(amountMinor, nativeCurrency, 'USD'), 'USD')

  return (
    <span
      className={align === 'end' ? 'text-right' : 'text-left'}
      aria-label={
        usdEstimate
          ? `${spokenLabel}; approximately ${usdEstimate} USD${hideEstimateLabel ? '' : ', display estimate'}`
          : spokenLabel
      }
    >
      <span className="block">{nativeLabel}</span>
      {usdEstimate ? (
        <span className="mt-0.5 block text-[11px] font-semibold tracking-[0.01em] text-ink/68">
          ≈ {usdEstimate} USD{hideEstimateLabel ? null : ' · estimate'}
        </span>
      ) : null}
    </span>
  )
}
