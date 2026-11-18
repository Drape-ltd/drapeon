import { supabaseProjectEnvironment } from './env.ts'

export type StripeWebhookLivemodeVerdict =
  | { accepted: true; expectedLivemode: boolean }
  | {
    accepted: false
    code: 'UNKNOWN_ENVIRONMENT' | 'MISSING_LIVEMODE' | 'LIVEMODE_MISMATCH'
    expectedLivemode: boolean | null
  }

/**
 * A signed Stripe event is still unsafe if it belongs to the other Stripe
 * environment. Unknown Supabase hosts fail closed rather than inheriting a
 * production or sandbox mode from a substring match.
 */
export function verifyStripeWebhookLivemode(input: {
  supabaseUrl: string
  livemode: unknown
}): StripeWebhookLivemodeVerdict {
  const environment = supabaseProjectEnvironment(input.supabaseUrl)
  if (environment === 'UNKNOWN') {
    return { accepted: false, code: 'UNKNOWN_ENVIRONMENT', expectedLivemode: null }
  }

  const expectedLivemode = environment === 'PRODUCTION'
  if (typeof input.livemode !== 'boolean') {
    return { accepted: false, code: 'MISSING_LIVEMODE', expectedLivemode }
  }

  if (input.livemode !== expectedLivemode) {
    return { accepted: false, code: 'LIVEMODE_MISMATCH', expectedLivemode }
  }

  return { accepted: true, expectedLivemode }
}
