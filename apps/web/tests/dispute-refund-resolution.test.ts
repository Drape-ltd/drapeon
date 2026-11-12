import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveRefundedDispute } from '../lib/dispute-refund-resolution.ts'

test('resolving a refunded dispute never writes an operator email into its user ID field', async () => {
  const calls: Array<{ kind: string; value: unknown }> = []
  const client = {
    from(table: string) {
      calls.push({ kind: 'from', value: table })
      return {
        update(patch: unknown) {
          calls.push({ kind: 'update', value: patch })
          return {
            eq(column: string, value: unknown) {
              calls.push({ kind: 'eq', value: { column, value } })
              return {
                async in(column: string, values: unknown[]) {
                  calls.push({ kind: 'in', value: { column, values } })
                  return { error: null }
                },
              }
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient

  const result = await resolveRefundedDispute(client, {
    disputeId: 'dispute-1', note: 'Approved Money Desk refund', at: '2026-11-07T12:00:00Z',
  })
  assert.equal(result.error, null)
  assert.deepEqual(calls, [
    { kind: 'from', value: 'disputes' },
    { kind: 'update', value: {
      status: 'RESOLVED_REFUNDED', resolution: 'Approved Money Desk refund',
      resolved_at: '2026-11-07T12:00:00Z', resolved_by: null,
      updated_at: '2026-11-07T12:00:00Z',
    } },
    { kind: 'eq', value: { column: 'id', value: 'dispute-1' } },
    { kind: 'in', value: { column: 'status', values: ['OPEN', 'UNDER_REVIEW'] } },
  ])
})
