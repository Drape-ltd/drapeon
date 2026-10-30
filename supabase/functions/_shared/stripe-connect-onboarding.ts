export type StripeConnectCallbackEnvironment = 'SANDBOX' | 'PRODUCTION' | 'UNKNOWN'

export type StripeConnectCallbackUrls = {
  returnUrl: string
  refreshUrl: string
}

type ResolveStripeConnectCallbackUrlsInput = {
  supabaseUrl: string
  environment: StripeConnectCallbackEnvironment
  appReturnUrl?: string
  returnUrl?: string
  refreshUrl?: string
}

function allowedMobileReturnUrl(
  value: string,
  environment: StripeConnectCallbackEnvironment
): string | null {
  const expectedProtocol =
    environment === 'SANDBOX' ? 'drape-dev:' : environment === 'PRODUCTION' ? 'drape:' : null
  if (!expectedProtocol) return null

  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== expectedProtocol ||
      parsed.hostname !== '' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

function isValidHostedCallbackUrl(
  value: string,
  environment: StripeConnectCallbackEnvironment
): boolean {
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.hostname === '' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== ''
    ) {
      return false
    }

    if (parsed.protocol === 'https:') return true
    return (
      environment === 'SANDBOX' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

export function buildStripeConnectCallbackUrl(input: {
  supabaseUrl: string
  environment: StripeConnectCallbackEnvironment
  appReturnUrl: string
}): string | null {
  const mobileReturnUrl = allowedMobileReturnUrl(input.appReturnUrl, input.environment)
  if (!mobileReturnUrl) return null

  const expectedHost =
    input.environment === 'SANDBOX'
      ? 'pqptfuqogvrajozfsqzi.supabase.co'
      : input.environment === 'PRODUCTION'
        ? 'wkfsrunetmgjdtcurmoj.supabase.co'
        : null
  if (!expectedHost) return null

  try {
    const supabase = new URL(input.supabaseUrl)
    if (
      supabase.protocol !== 'https:' ||
      supabase.hostname.toLowerCase() !== expectedHost ||
      supabase.username !== '' ||
      supabase.password !== ''
    ) {
      return null
    }

    const callback = new URL('/functions/v1/payout-account-action', supabase.origin)
    callback.searchParams.set('stripe_connect_return', '1')
    callback.searchParams.set('redirect_uri', mobileReturnUrl)
    return callback.toString()
  } catch {
    return null
  }
}

export function resolveStripeConnectCallbackUrls(
  input: ResolveStripeConnectCallbackUrlsInput
): StripeConnectCallbackUrls | null {
  if (input.appReturnUrl !== undefined) {
    const callback = buildStripeConnectCallbackUrl({
      supabaseUrl: input.supabaseUrl,
      environment: input.environment,
      appReturnUrl: input.appReturnUrl,
    })
    return callback ? { returnUrl: callback, refreshUrl: callback } : null
  }

  if (!input.returnUrl || !input.refreshUrl) return null
  if (
    !isValidHostedCallbackUrl(input.returnUrl, input.environment) ||
    !isValidHostedCallbackUrl(input.refreshUrl, input.environment)
  ) {
    return null
  }

  return { returnUrl: input.returnUrl, refreshUrl: input.refreshUrl }
}

export async function prepareStripeConnectAccount(
  input: ResolveStripeConnectCallbackUrlsInput & { accountId: string | null },
  createAccount: () => Promise<{ id: string }>
): Promise<
  | { ok: false; reason: 'INVALID_CALLBACK_URL' }
  | { ok: true; accountId: string; callbackUrls: StripeConnectCallbackUrls }
> {
  const callbackUrls = resolveStripeConnectCallbackUrls(input)
  if (!callbackUrls) return { ok: false, reason: 'INVALID_CALLBACK_URL' }

  const accountId = input.accountId?.trim() || (await createAccount()).id
  return { ok: true, accountId, callbackUrls }
}

export function stripeConnectReturnResponse(
  request: Request,
  environment: StripeConnectCallbackEnvironment
): Response {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
    })
  }

  const requestUrl = new URL(request.url)
  if (requestUrl.searchParams.get('stripe_connect_return') !== '1') {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const redirectUri = requestUrl.searchParams.get('redirect_uri')
  if (!redirectUri || !allowedMobileReturnUrl(redirectUri, environment)) {
    return new Response('Invalid Stripe Connect return URL', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUri,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
