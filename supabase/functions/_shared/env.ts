export type SupabaseProjectEnvironment = 'DEVELOPMENT' | 'PRODUCTION' | 'UNKNOWN'

/**
 * Classifies only the exact configured Supabase endpoints. Unknown hosts must
 * never inherit Dev privileges from a matching project-ref substring.
 */
export function supabaseProjectEnvironment(supabaseUrl: string): SupabaseProjectEnvironment {
  try {
    const url = new URL(supabaseUrl)
    const host = url.hostname.toLowerCase()
    if (
      (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') &&
      (url.protocol === 'http:' || url.protocol === 'https:')
    ) return 'DEVELOPMENT'
    if (url.protocol !== 'https:') return 'UNKNOWN'
    if (host === 'pqptfuqogvrajozfsqzi.supabase.co') return 'DEVELOPMENT'
    if (host === 'wkfsrunetmgjdtcurmoj.supabase.co' || host === 'auth.drapeon.co') return 'PRODUCTION'
  } catch {
    // Invalid or missing project URL is not an environment signal.
  }
  return 'UNKNOWN'
}

export function getSupabaseUrl(): string {
  return Deno.env.get('SUPABASE_URL')!
}

function splitSecretList(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function getTrustedServiceRoleKeys(): string[] {
  return [
    Deno.env.get('DRAPE_SERVICE_ROLE_JWT'),
    Deno.env.get('DRAPE_SERVICE_ROLE_KEY'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    ...splitSecretList(Deno.env.get('SUPABASE_SECRET_KEYS')),
  ]
    .map((entry) => entry?.trim() ?? '')
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
}

export function getServiceRoleKey(): string {
  return getTrustedServiceRoleKeys()[0]!
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [hashLeft, hashRight] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])

  const leftBytes = new Uint8Array(hashLeft)
  const rightBytes = new Uint8Array(hashRight)
  let diff = 0

  for (let index = 0; index < 32; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index]
  }

  return diff === 0
}

export async function isTrustedServiceRoleToken(token: string | null | undefined): Promise<boolean> {
  const candidate = token?.trim()
  if (!candidate) return false

  const trustedKeys = getTrustedServiceRoleKeys()
  for (const key of trustedKeys) {
    if (await timingSafeEqual(candidate, key)) return true
  }

  return false
}

export function getSupabaseAnonKey(): string {
  const key =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    Deno.env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!key) throw new Error('Missing Supabase anon key environment variable.')
  return key
}

export function getStripeSecretKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('STRIPE_SECRET_KEY_SANDBOX')
  if (!key) throw new Error('Missing Stripe secret key environment variable.')
  return key
}

export function getStripeWebhookSecrets(): string[] {
  const secrets = [
    Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_WEBHOOK_SECRETS'),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)

  if (secrets.length === 0) throw new Error('Missing Stripe webhook secret environment variable.')
  return secrets
}

export function getStripeWebhookSecret(): string {
  return getStripeWebhookSecrets()[0]
}

export function getPaystackSecretKey(): string {
  const key = Deno.env.get('PAYSTACK_SECRET_KEY') ?? Deno.env.get('PAYSTACK_SECRET_KEY_TEST')
  if (!key) throw new Error('Missing Paystack secret key environment variable.')
  return key
}

export function getPaymentReturnUrl(): string {
  const configuredUrl = Deno.env.get('PAYMENT_RETURN_URL')
  if (configuredUrl) {
    if (configuredUrl.includes('/payments/return')) return configuredUrl
    return `${configuredUrl.replace(/\/+$/u, '')}/payments/return`
  }

  const legacyCallbackUrl = Deno.env.get('PAYSTACK_CALLBACK_URL')
  if (legacyCallbackUrl?.includes('/payments/paystack/callback')) {
    return legacyCallbackUrl.replace('/payments/paystack/callback', '/payments/return')
  }

  const siteUrl =
    Deno.env.get('SITE_URL') ??
    Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
    'https://drapeon.co'

  if (siteUrl.includes('/payments/paystack/callback')) {
    return siteUrl.replace('/payments/paystack/callback', '/payments/return')
  }

  return `${siteUrl.replace(/\/+$/u, '')}/payments/return`
}

/** @deprecated Use getPaymentReturnUrl; the redirect is shared across providers. */
export function getPaystackCallbackUrl(): string {
  return getPaymentReturnUrl()
}

export function getZiptaxApiKey(): string {
  const key = Deno.env.get('ZIPTAX_API_KEY')
  if (!key) throw new Error('Missing ZIPTAX_API_KEY environment variable.')
  return key
}

export function getOptionalSentryDsn(): string | null {
  return Deno.env.get('SENTRY_DSN') ?? Deno.env.get('SUPABASE_SENTRY_DSN') ?? null
}

export function getOptionalHealthcheckSecret(): string | null {
  return Deno.env.get('DRAPE_HEALTHCHECK_SECRET') ?? Deno.env.get('HEALTHCHECK_SECRET') ?? null
}

export function getDailyApiKey(): string {
  const key = Deno.env.get('DAILY_API_KEY')
  if (!key) throw new Error('Missing Daily API key environment variable.')
  return key
}
