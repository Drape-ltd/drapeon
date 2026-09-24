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
  const nativeLabel = `${prefix}${formatMoney(amountMinor, nativeCurrency)}`
  const usdEstimate = nativeCurrency === 'USD'
    ? null
    : formatMoney(convertAccountCurrencyEstimate(amountMinor, nativeCurrency, 'USD'), 'USD')

  return (
    <span
      className={align === 'end' ? 'text-right' : 'text-left'}
      aria-label={usdEstimate ? `${nativeLabel}; approximately ${usdEstimate} USD, display estimate` : nativeLabel}
    >
      <span className="block">{nativeLabel}</span>
      {usdEstimate ? (
        <span className="mt-0.5 block text-[11px] font-semibold tracking-[0.01em] text-ink/68">
          ≈ {usdEstimate} USD · estimate
        </span>
      ) : null}
    </span>
  )
}
