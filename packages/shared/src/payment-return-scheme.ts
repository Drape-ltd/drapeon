export const PAYMENT_RETURN_SCHEMES = ['drape-dev', 'drape-preview', 'drape'] as const

export type PaymentReturnScheme = (typeof PAYMENT_RETURN_SCHEMES)[number]

export function paymentReturnScheme(value: unknown): PaymentReturnScheme | null {
  return typeof value === 'string' && (PAYMENT_RETURN_SCHEMES as readonly string[]).includes(value)
    ? value as PaymentReturnScheme
    : null
}

export function paymentReturnDeepLink(value: unknown, query: string): string | null {
  const scheme = value == null ? 'drape' : paymentReturnScheme(value)
  if (!scheme) return null
  return `${scheme}:///payment-redirect${query ? `?${query}` : ''}`
}
