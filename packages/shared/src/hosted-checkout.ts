export type HostedCheckoutProvider = 'PAYSTACK' | 'BACHS'

function hostIs(hostname: string, root: string): boolean {
  const host = hostname.toLowerCase()
  return host === root || host.endsWith(`.${root}`)
}

/** Identify only the provider hosts Drapeon intentionally embeds. */
export function hostedCheckoutProviderFromUrl(value: string): HostedCheckoutProvider | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    if (hostIs(url.hostname, 'paystack.com') || hostIs(url.hostname, 'paystack.co')) {
      return 'PAYSTACK'
    }
    if (hostIs(url.hostname, 'bachs.io')) return 'BACHS'
    return null
  } catch {
    return null
  }
}

function isValidProviderReference(value: string | null): boolean {
  return !!value && /^[A-Za-z0-9_-]{1,200}$/u.test(value)
}

/**
 * Hosted checkout completion is a navigation hint only; server confirmation
 * still decides whether a payment was actually collected.
 */
export function isHostedCheckoutCompletion(
  value: string,
  returnUrl: string,
  provider: HostedCheckoutProvider,
): boolean {
  try {
    const candidate = new URL(value)
    const expected = new URL(returnUrl)
    if (
      candidate.protocol === expected.protocol &&
      candidate.host === expected.host &&
      candidate.pathname === expected.pathname
    ) return true

    if (candidate.protocol !== 'https:') return false
    if (
      provider === 'PAYSTACK' &&
      hostIs(candidate.hostname, 'drapeon.co') &&
      (candidate.pathname === '/payments/return' ||
        candidate.pathname === '/payments/paystack/callback')
    ) {
      return isValidProviderReference(
        candidate.searchParams.get('reference') ?? candidate.searchParams.get('trxref'),
      )
    }
    if (
      provider === 'BACHS' &&
      hostIs(candidate.hostname, 'drapeon.co') &&
      candidate.pathname === '/payments/return'
    ) {
      return /^chk_[A-Za-z0-9_-]{1,196}$/u.test(
        candidate.searchParams.get('checkout_id') ?? '',
      )
    }
    return false
  } catch {
    return false
  }
}
