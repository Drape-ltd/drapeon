export const STRIPE_URL_SCHEME = 'drape'
export const STRIPE_RETURN_URL = `${STRIPE_URL_SCHEME}://stripe-redirect`

export function isStripeReturnUrl(url: string | null): url is string {
  return typeof url === 'string' && /^drape:\/\/stripe-redirect(?:[/?#]|$)/i.test(url)
}

type ReturnLinking = {
  getInitialURL: () => Promise<string | null>
  addEventListener: (event: 'url', listener: (event: { url: string }) => void) => { remove: () => void }
}

export function subscribeStripeReturnUrls(
  linking: ReturnLinking,
  handleURLCallback: (url: string) => Promise<boolean>,
  onError: (error: unknown) => void,
) {
  let active = true
  const handleReturn = async (url: string | null) => {
    if (!active || !isStripeReturnUrl(url)) return
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
