import assert from 'node:assert/strict'
import { requireAsciiEmailApiKey, resendIdempotencyHeader } from './email-request-headers.ts'

Deno.test('normal idempotency keys keep the same provider value', async () => {
  assert.equal(await resendIdempotencyHeader(' order:123:SEND_ORDER_EVENT_EMAIL '), 'order:123:SEND_ORDER_EVENT_EMAIL')
})

Deno.test('non-ByteString keys become stable safe Request headers', async () => {
  const original = 'order:123:Tailor review ✨:SEND_ORDER_EVENT_EMAIL'
  const safe = await resendIdempotencyHeader(original)
  assert.equal(safe, await resendIdempotencyHeader(original))
  assert.match(safe ?? '', /^drapeon-[0-9a-f]{64}$/u)
  const request = new Request('https://api.resend.com/emails', { headers: { 'Idempotency-Key': safe ?? '' } })
  assert.equal(request.headers.get('Idempotency-Key'), safe)
})

Deno.test('unsafe API keys fail before constructing an outbound Request', () => {
  assert.throws(() => requireAsciiEmailApiKey('secret\nheader'), /invalid HTTP header/u)
  assert.throws(() => requireAsciiEmailApiKey('secret✨'), /invalid HTTP header/u)
})
