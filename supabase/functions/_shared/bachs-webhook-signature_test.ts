import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { verifyBachsWebhookSignature } from './bachs-webhook-signature.ts'

const rawBody = new TextEncoder().encode('{"id":"evt_test","type":"collection.succeeded"}')
const timestamp = 1_800_000_000
const secret = 'whsec_sandbox_only'

async function signature(): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const prefix = new TextEncoder().encode(`${timestamp}.`)
  const message = new Uint8Array(prefix.length + rawBody.length)
  message.set(prefix)
  message.set(rawBody, prefix.length)
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.test('Bachs V2 signature accepts any valid v1 during rotation', async () => {
  const valid = await signature()
  const headers = new Headers({ 'X-Bachs-Signature-V2': `t=${timestamp},v1=${'0'.repeat(64)},v1=${valid}` })
  assertEquals(await verifyBachsWebhookSignature({ rawBody, headers, secret, nowSeconds: timestamp }), true)
})

Deno.test('Bachs signature rejects a changed body and stale delivery', async () => {
  const headers = new Headers({ 'X-Bachs-Signature-V2': `t=${timestamp},v1=${await signature()}` })
  assertEquals(await verifyBachsWebhookSignature({ rawBody: new TextEncoder().encode('{}'), headers, secret, nowSeconds: timestamp }), false)
  assertEquals(await verifyBachsWebhookSignature({ rawBody, headers, secret, nowSeconds: timestamp + 301 }), false)
})

Deno.test('Bachs signature rejects malformed V2 instead of falling back to legacy', async () => {
  const headers = new Headers({
    'X-Bachs-Signature-V2': `t=${timestamp},t=${timestamp},v1=${await signature()}`,
    'X-Bachs-Timestamp': `${timestamp}`,
    'X-Bachs-Signature': await signature(),
  })
  assertEquals(await verifyBachsWebhookSignature({ rawBody, headers, secret, nowSeconds: timestamp }), false)
})

Deno.test('Bachs legacy signature remains accepted when V2 is absent', async () => {
  const headers = new Headers({ 'X-Bachs-Timestamp': `${timestamp}`, 'X-Bachs-Signature': await signature() })
  assertEquals(await verifyBachsWebhookSignature({ rawBody, headers, secret, nowSeconds: timestamp }), true)
})
