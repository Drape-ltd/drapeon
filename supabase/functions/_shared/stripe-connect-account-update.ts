import {
  retrieveStripeConnectAccount,
  type StripeConnectAccount,
} from './stripe.ts'

export type StripeConnectAccountUpdateEvent = {
  account?: string | null
  data?: { object?: unknown }
}

type RetrieveStripeConnectAccount = (accountId: string) => Promise<StripeConnectAccount>

function eventAccountId(event: StripeConnectAccountUpdateEvent): string | null {
  const object = event.data?.object
  const objectId = object && typeof object === 'object' && 'id' in object
    && typeof object.id === 'string'
    ? object.id.trim()
    : ''
  return objectId || event.account?.trim() || null
}

/**
 * Account-update events are only a wake-up signal. Stripe can deliver them out
 * of order, so payout readiness must always be calculated from a fresh
 * Accounts API read instead of the event snapshot.
 */
export async function retrieveCurrentStripeConnectAccountForEvent(
  event: StripeConnectAccountUpdateEvent,
  retrieve: RetrieveStripeConnectAccount = retrieveStripeConnectAccount,
): Promise<StripeConnectAccount | null> {
  const accountId = eventAccountId(event)
  return accountId ? await retrieve(accountId) : null
}
