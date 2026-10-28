import { bachsAmountMinor } from './bachs.ts'
import type { BachsCheckout } from './bachs-operations.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type BachsCheckoutAttempt = {
  id: string
  idempotency_key: string
  amount: number
  currency: string
  provider: string
  provider_request_state: string | null
  provider_payment_id: string | null
  status: string
}

export type BachsCheckoutStore = {
  claim(paymentId: string, key: string): Promise<boolean>
  load(paymentId: string): Promise<BachsCheckoutAttempt>
  bind(paymentId: string, key: string, checkout: BachsCheckout): Promise<void>
}

export type BachsCheckoutGateway = {
  create(input: { attempt: BachsCheckoutAttempt; expiresInMinutes: number }): Promise<BachsCheckout>
  retrieve(checkoutId: string): Promise<BachsCheckout>
}

export type PreparedBachsCheckout =
  | { state: 'READY'; checkout: BachsCheckout; reused: boolean }
  | { state: 'UNCERTAIN' }

export function createSupabaseBachsCheckoutStore(supabase: SupabaseClient): BachsCheckoutStore {
  return {
    async claim(paymentId, key) {
      const { data, error } = await supabase.rpc('claim_bachs_checkout_request', {
        p_payment_id: paymentId, p_idempotency_key: key,
      })
      if (error || typeof data !== 'boolean') throw new Error('Could not claim Bachs checkout request.')
      return data
    },
    async load(paymentId) {
      const { data, error } = await supabase.from('order_payments')
        .select('id, idempotency_key, amount, currency, provider, provider_request_state, provider_payment_id, status')
        .eq('id', paymentId).maybeSingle()
      if (error || !data) throw new Error('Could not load Bachs checkout attempt.')
      return data as BachsCheckoutAttempt
    },
    async bind(paymentId, key, checkout) {
      const { error } = await supabase.rpc('bind_bachs_checkout_request', {
        p_payment_id: paymentId,
        p_idempotency_key: key,
        p_checkout_id: checkout.checkout_id,
        p_checkout_url: checkout.checkout_url,
      })
      if (error) throw new Error('Could not save Bachs checkout identity.')
    },
  }
}

/**
 * The DB claim is committed before the network call. A timeout, crash, or
 * failed bind never sends a second POST with a fresh key. Recovery retrieves a
 * saved checkout or sends the unresolved request to Money Desk.
 */
export async function prepareBachsCheckoutAttempt(input: {
  attempt: BachsCheckoutAttempt
  expiresInMinutes: number
  store: BachsCheckoutStore
  gateway: BachsCheckoutGateway
}): Promise<PreparedBachsCheckout> {
  const { attempt, store, gateway } = input
  if (attempt.provider !== 'BACHS' || !attempt.id || !attempt.idempotency_key ||
    !Number.isSafeInteger(attempt.amount) || attempt.amount <= 0 ||
    !Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 1 || input.expiresInMinutes > 1440) {
    throw new Error('Bachs attempt is not valid for checkout.')
  }

  const claimed = await store.claim(attempt.id, attempt.idempotency_key)
  if (!claimed) {
    const current = await store.load(attempt.id)
    if (current.provider !== 'BACHS' || current.idempotency_key !== attempt.idempotency_key ||
      current.currency !== attempt.currency || current.amount !== attempt.amount) {
      throw new Error('Bachs attempt changed while preparing checkout.')
    }
    if (current.provider_request_state !== 'BOUND' || !current.provider_payment_id) {
      return { state: 'UNCERTAIN' }
    }
    const checkout = await gateway.retrieve(current.provider_payment_id)
    if (checkout.checkout_id !== current.provider_payment_id || checkout.currency !== current.currency ||
      bachsAmountMinor(checkout.amount, checkout.currency) !== current.amount) {
      throw new Error('Bachs saved checkout does not match the attempt.')
    }
    return { state: 'READY', checkout, reused: true }
  }

  // Once claimed, any exception is an uncertain provider operation. The caller
  // must never retry create; the SENT reservation remains until reconciliation.
  const checkout = await gateway.create({ attempt, expiresInMinutes: input.expiresInMinutes })
  if (checkout.currency !== attempt.currency || bachsAmountMinor(checkout.amount, checkout.currency) !== attempt.amount) {
    throw new Error('Bachs checkout differs from the accepted payment.')
  }
  await store.bind(attempt.id, attempt.idempotency_key, checkout)
  return { state: 'READY', checkout, reused: false }
}
