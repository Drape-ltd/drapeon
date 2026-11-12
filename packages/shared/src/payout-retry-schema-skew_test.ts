import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isPayoutRetrySchemaUnavailable, optionalPayoutRetryRows } from './payout-retry-schema-skew.ts'

Deno.test('payout retry reads tolerate only the exact absent optional table or selected column', () => {
  assertEquals(isPayoutRetrySchemaUnavailable(
    { code: '42P01', message: 'relation "public.payout_claim_retry_authorizations" does not exist' },
    { table: 'payout_claim_retry_authorizations', columns: ['prior_operation_id'] },
  ), true)
  assertEquals(isPayoutRetrySchemaUnavailable(
    { code: 'PGRST205', message: "Could not find the table 'public.payout_provider_operations' in the schema cache" },
    { table: 'payout_provider_operations', columns: ['provider_source_transaction_id'] },
  ), true)
  assertEquals(isPayoutRetrySchemaUnavailable(
    { code: '42703', message: 'column payout_claims.provider_transfer_id does not exist' },
    { table: 'payout_claims', columns: ['provider_transfer_id'] },
  ), true)
  assertEquals(isPayoutRetrySchemaUnavailable(
    { code: 'PGRST204', message: "Could not find the 'provider_source_transaction_id' column of 'payout_provider_operations' in the schema cache" },
    { table: 'payout_provider_operations', columns: ['provider_source_transaction_id'] },
  ), true)
})

Deno.test('payout retry fallback does not hide unrelated query failures', () => {
  assertEquals(isPayoutRetrySchemaUnavailable(
    { code: '42703', message: 'column payout_provider_operations.unrelated does not exist' },
    { table: 'payout_provider_operations', columns: ['provider_source_transaction_id'] },
  ), false)
  assertEquals(isPayoutRetrySchemaUnavailable(
    { code: 'PGRST204', message: "Could not find the 'provider_transfer_id' column of 'payout_claims' in the schema cache" },
    { table: 'payout_provider_operations', columns: ['provider_transfer_id'] },
  ), false)
  assertThrows(() => optionalPayoutRetryRows(
    { data: null, error: { code: 'FETCH_ERROR', message: 'network request failed' } },
    { table: 'payout_claims', columns: ['provider_transfer_id'] },
    'Claimed payout retry candidates',
  ), Error, 'Claimed payout retry candidates is unavailable: network request failed')
  assertThrows(() => optionalPayoutRetryRows(
    { data: null, error: { code: '42501', message: 'permission denied' } },
    { table: 'payout_claims', columns: ['provider_transfer_id'] },
    'Claimed payout retry candidates',
  ), Error, 'Claimed payout retry candidates is unavailable: permission denied')
})
