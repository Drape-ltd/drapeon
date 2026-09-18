import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  emailAddressHash,
} from './email-hash.ts'
import {
  redactResendEvent,
  resendOutcome,
  resendSuppressionReason,
  verifyResendWebhookSignature,
} from './resend-webhook.ts'

const SECRET = 'whsec_dGVzdC1yZXNlbmQtd2ViaG9vaw=='

async function sign(payload: string, webhookId: string, timestamp: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(SECRET.replace('whsec_', '')), (character) => character.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${webhookId}.${timestamp}.${payload}`))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

Deno.test('accepts a current Resend/Svix signature and rejects stale replays', async () => {
  const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email_1' } })
  const webhookId = 'msg_1'
  const timestamp = '1700000000'
  const signature = await sign(payload, webhookId, timestamp)
  const nowMs = Number(timestamp) * 1000

  assert(await verifyResendWebhookSignature({ payload, webhookId, timestamp, signature: `v1,${signature}`, secret: SECRET, nowMs }))
  assertFalse(await verifyResendWebhookSignature({ payload, webhookId, timestamp: ` ${Number(timestamp) - 301}`, signature: `v1,${signature}`, secret: SECRET, nowMs }))
  assertFalse(await verifyResendWebhookSignature({ payload: `${payload} `, webhookId, timestamp, signature: `v1,${signature}`, secret: SECRET, nowMs }))
})

Deno.test('redacts email recipients while preserving delivery measurement fields', async () => {
  const event = {
    type: 'email.bounced',
    created_at: '2026-09-18T17:00:00.000Z',
    data: {
      email_id: 'email_1',
      to: ['Person@Example.com'],
      subject: 'Private subject',
      bounce: { type: 'Permanent', subType: 'Suppressed', message: 'private provider text' },
    },
  }
  const redacted = await redactResendEvent(event)
  assertEquals(redacted.email_id, 'email_1')
  assertEquals(redacted.recipient_hashes, [await emailAddressHash('person@example.com')])
  assertFalse('subject' in redacted)
  assertFalse('message' in (redacted.bounce as Record<string, unknown>))
  assertEquals(resendOutcome(event.type), 'DEAD')
  assertEquals(resendSuppressionReason(event.type, event.data), 'HARD_BOUNCE')
})
