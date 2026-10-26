import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { upsertPreparedPaymentAttempt, type PaymentAttempt } from './payment-ledger.ts'

const attempt: PaymentAttempt = {
  id: 'attempt-1',
  order_id: 'order-1',
  phase: 'INITIAL_ORDER',
  provider: 'STRIPE',
  currency: 'USD',
  amount: 5000,
  status: 'SUCCEEDED',
  idempotency_key: 'order-1:initial',
  provider_payment_id: 'pi_123',
  provider_checkout_url: 'https://checkout.example',
}

const input = {
  orderId: 'order-1',
  phase: 'INITIAL_ORDER' as const,
  provider: 'STRIPE' as const,
  currency: 'USD',
  amount: 5000,
  idempotencyKey: 'order-1:initial',
  providerPaymentId: 'pi_123',
  status: 'PENDING' as const,
}

function existingProviderReferenceClient(existing: PaymentAttempt, onWrite: () => void) {
  return {
    from(table: string) {
      if (table === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { commercial_policy_version: 'test' }, error: null }) }) }) }
      }
      if (table !== 'order_payments') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (column: string) => column === 'provider'
            ? { eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }
            : { maybeSingle: async () => ({ data: existing, error: null }) },
        }),
        update: () => { onWrite(); throw new Error('Terminal attempt must not be rewritten') },
        insert: () => { onWrite(); throw new Error('Retry must not insert a second attempt') },
      }
    },
  } as unknown as SupabaseClient
}

Deno.test('checkout retry preserves a confirmed attempt without writing', async () => {
  let writes = 0
  const result = await upsertPreparedPaymentAttempt(
    existingProviderReferenceClient(attempt, () => writes++),
    input,
  )
  assertEquals(result.id, attempt.id)
  assertEquals(result.status, 'SUCCEEDED')
  assertEquals(writes, 0)
})

Deno.test('provider reference cannot be reused for different payment terms', async () => {
  let writes = 0
  let opsReports = 0
  await assertRejects(
    () => upsertPreparedPaymentAttempt(
      existingProviderReferenceClient(attempt, () => writes++),
      { ...input, amount: 9000 },
      { reportConflict: async () => { opsReports++; return null } },
    ),
    Error,
    'Payment attempt identity conflict',
  )
  assertEquals(writes, 0)
  assertEquals(opsReports, 1)
})

Deno.test('idempotency-key retry cannot downgrade an already confirmed attempt', async () => {
  let writes = 0
  let insertCalls = 0
  const client = {
    from(table: string) {
      if (table === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { commercial_policy_version: 'test' }, error: null }) }) }) }
      }
      if (table !== 'order_payments') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (column: string) => column === 'provider'
            ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }
            : { maybeSingle: async () => ({ data: attempt, error: null }) },
        }),
        insert: () => ({ select: () => ({ single: async () => {
          insertCalls++
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        } }) }),
        update: () => { writes++; throw new Error('Confirmed attempt must not be rewritten') },
      }
    },
  } as unknown as SupabaseClient

  const result = await upsertPreparedPaymentAttempt(client, input)
  assertEquals(result.id, attempt.id)
  assertEquals(result.status, 'SUCCEEDED')
  assertEquals(insertCalls, 1)
  assertEquals(writes, 0)
})

Deno.test('idempotency-key retry does not replace a concurrently bound provider reference', async () => {
  const racedAttempt: PaymentAttempt = { ...attempt, status: 'PENDING', provider_payment_id: 'pi_other' }
  const unboundAttempt: PaymentAttempt = { ...attempt, status: 'PENDING', provider_payment_id: null }
  let boundOnlyWhenNull = false
  let opsReports = 0
  let identityReads = 0
  const client = {
    from(table: string) {
      if (table === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { commercial_policy_version: 'test' }, error: null }) }) }) }
      }
      if (table !== 'order_payments') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (column: string) => column === 'provider'
            ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }
            : { maybeSingle: async () => ({
              data: identityReads++ === 0 ? unboundAttempt : racedAttempt,
              error: null,
            }) },
        }),
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }),
        update: () => {
          const builder = {
            eq: () => builder,
            in: () => builder,
            is: (column: string, value: unknown) => {
              boundOnlyWhenNull = column === 'provider_payment_id' && value === null
              return builder
            },
            select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }
          return builder
        },
      }
    },
  } as unknown as SupabaseClient

  await assertRejects(
    () => upsertPreparedPaymentAttempt(
      client,
      input,
      { reportConflict: async () => { opsReports++; return null } },
    ),
    Error,
    'Payment attempt identity conflict',
  )
  assertEquals(boundOnlyWhenNull, true)
  assertEquals(opsReports, 1)
})
