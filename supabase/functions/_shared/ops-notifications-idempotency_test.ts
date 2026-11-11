import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { sendCriticalOpsIssueNotification } from './ops-notifications.ts'

Deno.test('historical Ops email carries a stable Resend idempotency key and returns provider ID', async () => {
  const originalFetch = globalThis.fetch
  const previousKey = Deno.env.get('RESEND_API_KEY')
  const previousRecipients = Deno.env.get('OPS_NOTIFICATION_EMAILS')
  let header = ''
  try {
    Deno.env.set('RESEND_API_KEY', 'test-only-key')
    Deno.env.set('OPS_NOTIFICATION_EMAILS', 'ops-qa@example.test')
    globalThis.fetch = (_input, init) => {
      header = new Headers((init as { headers?: HeadersInit } | undefined)?.headers)
        .get('Idempotency-Key') ?? ''
      return Promise.resolve(new Response(JSON.stringify({ id: 'email-test-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    }
    const result = await sendCriticalOpsIssueNotification({
      issueNumber: 1,
      issueType: 'SYSTEM_ALERT',
      severity: 'HIGH',
      title: 'Synthetic test',
      description: 'Synthetic test',
      recommendedAction: 'Review',
      source: 'historical-money-push-reconciliation',
      idempotencyKey: 'historical-money-push:job-1',
    })
    assertEquals(header, 'historical-money-push:job-1')
    assertEquals(result, { ok: true, skipped: false, providerReference: 'email-test-1' })
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) Deno.env.delete('RESEND_API_KEY')
    else Deno.env.set('RESEND_API_KEY', previousKey)
    if (previousRecipients === undefined) Deno.env.delete('OPS_NOTIFICATION_EMAILS')
    else Deno.env.set('OPS_NOTIFICATION_EMAILS', previousRecipients)
  }
})

Deno.test('Ops email timeout returns a failure without throwing after issue creation', async () => {
  const originalFetch = globalThis.fetch
  const previousKey = Deno.env.get('RESEND_API_KEY')
  const previousRecipients = Deno.env.get('OPS_NOTIFICATION_EMAILS')
  try {
    Deno.env.set('RESEND_API_KEY', 'test-only-key')
    Deno.env.set('OPS_NOTIFICATION_EMAILS', 'ops-qa@example.test')
    globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const result = await sendCriticalOpsIssueNotification({
      issueNumber: 2,
      issueType: 'SYSTEM_ALERT',
      severity: 'CRITICAL',
      title: 'Synthetic test',
      description: 'Synthetic test',
      recommendedAction: 'Review',
      source: 'test',
    }, 20)
    assertEquals(result, { ok: false, skipped: false })
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) Deno.env.delete('RESEND_API_KEY')
    else Deno.env.set('RESEND_API_KEY', previousKey)
    if (previousRecipients === undefined) Deno.env.delete('OPS_NOTIFICATION_EMAILS')
    else Deno.env.set('OPS_NOTIFICATION_EMAILS', previousRecipients)
  }
})
