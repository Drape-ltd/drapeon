import { bachsAmountMinor, BachsRequestError } from './bachs.ts'
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
  provider_checkout_url?: string | null
  status: string
}

export type BachsCheckoutStore = {
  claim(paymentId: string, key: string): Promise<boolean>
  load(paymentId: string): Promise<BachsCheckoutAttempt>
  bind(paymentId: string, key: string, checkout: BachsCheckout): Promise<void>
  reject(paymentId: string, key: string, evidence: {
    httpStatus: number
    providerCode: string | null
    validationFields: readonly string[]
  }): Promise<void>
}

export type BachsCheckoutGateway = {
  create(input: { attempt: BachsCheckoutAttempt; expiresInMinutes: number }): Promise<BachsCheckout>
  retrieve(checkoutId: string): Promise<BachsCheckout>
}

export type PreparedBachsCheckout =
  | { state: 'READY'; checkout: BachsCheckout; reused: boolean }
  | { state: 'UNCERTAIN' }
  | {
      state: 'REJECTED'
      httpStatus: number
      providerCode: string | null
      validationFields: readonly string[]
    }

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
        .select('id, idempotency_key, amount, currency, provider, provider_request_state, provider_payment_id, provider_checkout_url, status')
        .eq('id', paymentId).maybeSingle()
      if (error || !data) throw new Error('Could not load Bachs checkout attempt.')
      return data as BachsCheckoutAttempt
    },
    async bind(paymentId, key, checkout) {
      if (!checkout.checkout_url) throw new Error('Bachs checkout URL is missing.')
      const { error } = await supabase.rpc('bind_bachs_checkout_request', {
        p_payment_id: paymentId,
        p_idempotency_key: key,
        p_checkout_id: checkout.checkout_id,
        p_checkout_url: checkout.checkout_url,
      })
      if (error) throw new Error('Could not save Bachs checkout identity.')
    },
    async reject(paymentId, key, evidence) {
      const { error } = await supabase.rpc('reject_bachs_checkout_request', {
        p_payment_id: paymentId,
        p_idempotency_key: key,
        p_http_status: evidence.httpStatus,
        p_provider_code: evidence.providerCode,
        p_validation_fields: [...evidence.validationFields],
      })
      if (error) throw new Error('Could not save Bachs checkout rejection.')
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
      !checkout.amount || bachsAmountMinor(checkout.amount, checkout.currency) !== current.amount ||
      checkout.reference !== current.idempotency_key) {
      throw new Error('Bachs saved checkout does not match the attempt.')
    }
    return { state: 'READY', checkout: { ...checkout, checkout_url: current.provider_checkout_url ?? undefined }, reused: true }
  }

  // Only an unambiguous validation/client rejection is terminal. Timeouts and
  // conflict responses can represent a created checkout, so keep them SENT and
  // never submit a second create request for this attempt.
  let created: BachsCheckout
  try {
    created = await gateway.create({ attempt, expiresInMinutes: input.expiresInMinutes })
  } catch (error) {
    if (
      error instanceof BachsRequestError && !error.uncertainWrite &&
      error.status !== null && error.status >= 400 && error.status < 500 &&
      error.status !== 408 && error.status !== 409
    ) {
      await store.reject(attempt.id, attempt.idempotency_key, {
        httpStatus: error.status,
        providerCode: error.code,
        validationFields: error.validationFields,
      })
      return {
        state: 'REJECTED',
        httpStatus: error.status,
        providerCode: error.code,
        validationFields: error.validationFields,
      }
    }
    throw error
  }
  if (!created.checkout_url || (created.reference != null && created.reference !== attempt.idempotency_key)) {
    throw new Error('Bachs checkout response does not match the reserved attempt.')
  }
  // Save the provider ID immediately. The creation response omits amount and
  // currency in Bachs' documented shape, so retrieve and verify the session only
  // after the ID is durably bound.
  await store.bind(attempt.id, attempt.idempotency_key, created)
  const retrieved = await gateway.retrieve(created.checkout_id)
  if (retrieved.checkout_id !== created.checkout_id || retrieved.currency !== attempt.currency ||
    !retrieved.amount || bachsAmountMinor(retrieved.amount, retrieved.currency) !== attempt.amount ||
    retrieved.reference !== attempt.idempotency_key) {
    throw new Error('Bachs checkout differs from the accepted payment.')
  }
  return { state: 'READY', checkout: { ...created, ...retrieved, checkout_url: created.checkout_url }, reused: false }
}
