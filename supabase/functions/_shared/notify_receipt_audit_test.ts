import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushToUser } from './notify.ts'

Deno.test('push receipt audit keeps job links when available and falls back when the column is missing', async () => {
  const jobId = '31a9ed49-4e66-42e9-b8fb-c9c42048e946'
  const writes: Array<Record<string, unknown>> = []
  const quarantineFilters: Array<[string, unknown]> = []
  const insertErrors: Array<{ code: string; message: string } | null> = [
    null,
    { code: 'PGRST204', message: "Could not find the 'notification_job_id' column of 'push_delivery_attempts' in the schema cache" },
    null,
    { code: '42703', message: 'column "notification_job_id" of relation "push_delivery_attempts" does not exist' },
    null,
    null,
    { code: '42501', message: 'permission denied for table push_delivery_attempts' },
  ]
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { status: 'ok', id: 'expo-ticket-for-receipt-test' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  const query = (data: unknown[]) => ({
    select() { return this },
    eq() { return this },
    is(column: string, value: unknown) { quarantineFilters.push([column, value]); return this },
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
          return Promise.resolve({ error: insertErrors.shift() ?? null })
        },
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient

  try {
    const send = (notificationJobId?: string) => sendPushToUser(client, 'qa-user', {
      title: 'Paid order',
      body: 'Your order is ready.',
      data: { requiredRole: 'CUSTOMER' },
    }, notificationJobId)

    assertEquals(await send(jobId), { status: 'SENT', provider: 'EXPO' })
    assertEquals(await send(jobId), { status: 'SENT', provider: 'EXPO' })
    assertEquals(await send(jobId), { status: 'SENT', provider: 'EXPO' })
    assertEquals(await send(), { status: 'SENT', provider: 'EXPO' })
    assertEquals(await send(jobId), { status: 'SENT', provider: 'EXPO' })

    assertEquals(writes.length, 7)
    assertEquals(quarantineFilters, Array.from({ length: 5 }, () => ['quarantined_at', null]))
    assertEquals(writes[0].notification_job_id, jobId)
    assertEquals(writes[0].status, 'TICKET_ACCEPTED')
    assertEquals(writes[1].notification_job_id, jobId)
    assertEquals(Object.hasOwn(writes[2], 'notification_job_id'), false)
    assertEquals(writes[3].notification_job_id, jobId)
    assertEquals(Object.hasOwn(writes[4], 'notification_job_id'), false)
    assertEquals(Object.hasOwn(writes[5], 'notification_job_id'), false)
    assertEquals(writes[6].notification_job_id, jobId)
  } finally {
    globalThis.fetch = originalFetch
  }
})
