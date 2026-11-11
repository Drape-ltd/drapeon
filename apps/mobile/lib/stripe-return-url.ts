export type StripeReturnConfig = {
  scheme: string
  returnURL: string
}

const APP_SCHEMES = new Set(['drape-dev', 'drape-preview', 'drape'])

export function stripeReturnConfigForScheme(value: string | string[] | null | undefined): StripeReturnConfig | null {
  const scheme = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value
  if (!scheme || !APP_SCHEMES.has(scheme)) return null
  return { scheme, returnURL: `${scheme}://stripe-redirect` }
}

export function isStripeReturnUrl(url: string | null, config: StripeReturnConfig): url is string {
  if (!url) return false
  if (!url.startsWith(config.returnURL)) return false
  const suffix = url.slice(config.returnURL.length)
  return suffix === '' || suffix === '/' || suffix.startsWith('?') || suffix.startsWith('#')
}

type ReturnLinking = {
  getInitialURL: () => Promise<string | null>
  addEventListener: (event: 'url', listener: (event: { url: string }) => void) => { remove: () => void }
}

export function subscribeStripeReturnUrls(
  linking: ReturnLinking,
  config: StripeReturnConfig,
  handleURLCallback: (url: string) => Promise<boolean>,
  onError: (error: unknown) => void,
) {
  let active = true
  const handleReturn = async (url: string | null) => {
    if (!active || !isStripeReturnUrl(url, config)) return
    try {
      await handleURLCallback(url)
    } catch (error) {
      if (active) onError(error)
    }
  }

  const subscription = linking.addEventListener('url', ({ url }) => { void handleReturn(url) })
  void linking.getInitialURL().then(handleReturn).catch((error) => {
    if (active) onError(error)
  })
  return () => {
    active = false
    subscription.remove()
  }
}
