import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushToUser } from './notify.ts'

Deno.test('Expo ticket is provider acceptance and keeps its durable job id for receipt audit', async () => {
  const jobId = '31a9ed49-4e66-42e9-b8fb-c9c42048e946'
  const writes: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { status: 'ok', id: 'expo-ticket-for-receipt-test' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  const query = (data: unknown[]) => ({
    select() { return this },
    eq() { return this },
    order() { return this },
    limit() { return Promise.resolve({ data, error: null }) },
    then(resolve: (value: unknown) => void) { return Promise.resolve({ data, error: null }).then(resolve) },
  })
  const client = {
    from(table: string) {
      if (table === 'web_push_subscriptions') return query([])
      if (table === 'push_tokens') return query([{ id: 'token-row', token: 'ExponentPushToken[test]' }])
      if (table === 'push_delivery_attempts') return {
        insert(row: Record<string, unknown>) {
          writes.push(row)
          return Promise.resolve({ error: null })
        },
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient

  try {
    const result = await sendPushToUser(client, 'qa-user', {
      title: 'Paid order',
      body: 'Your order is ready.',
      data: { requiredRole: 'CUSTOMER' },
    }, jobId)
    assertEquals(result, { status: 'SENT', provider: 'EXPO' })
    assertEquals(writes.length, 1)
    assertEquals(writes[0].notification_job_id, jobId)
    assertEquals(writes[0].status, 'TICKET_ACCEPTED')
  } finally {
    globalThis.fetch = originalFetch
  }
})
