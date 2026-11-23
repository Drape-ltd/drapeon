import { refreshPinnedStripeDestinationForRelease } from '../../../packages/shared/src/stripe-release-readiness.ts'

/** The last provider gate before a new payout claim is reserved. */
export async function withStripeReleasePreflight<T>(input: {
  client: any
  provider: 'STRIPE' | 'BACHS'
  orderId: string
  destinationId: string | null
  supabaseUrl: string
  serviceRoleKey: string
  attemptId?: string
  fetchImpl?: typeof fetch
  now?: () => Date
  claim: () => Promise<T>
}): Promise<T> {
  if (input.provider === 'STRIPE') {
    if (!input.destinationId) throw new Error('PAYOUT_RELEASE_PINNED_DESTINATION_MISSING')
    const readiness = await refreshPinnedStripeDestinationForRelease({
      client: input.client,
      orderId: input.orderId,
      attemptId: input.attemptId,
      expectedDestinationId: input.destinationId,
      forceStripeRoute: true,
      supabaseUrl: input.supabaseUrl,
      serviceRoleKey: input.serviceRoleKey,
      fetchImpl: input.fetchImpl,
      now: input.now,
    })
    if (!readiness.checkedAt) throw new Error('PAYOUT_RELEASE_STRIPE_SNAPSHOT_MISSING')
  }
  return await input.claim()
}
