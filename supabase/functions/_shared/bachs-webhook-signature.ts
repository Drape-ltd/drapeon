/** Verify Bachs' HMAC over the untouched request bytes before parsing JSON. */
export async function verifyBachsWebhookSignature(input: {
  rawBody: Uint8Array
  headers: Headers
  secret: string | readonly string[]
  nowSeconds?: number
}): Promise<boolean> {
  const { rawBody, headers, secret } = input
  const secrets = (Array.isArray(secret) ? secret : [secret]).map((value) => value.trim()).filter(Boolean)
  if (secrets.length === 0 || rawBody.byteLength > 1_048_576) return false

  const v2 = headers.get('x-bachs-signature-v2')
  const parts = v2?.split(',').map((part) => part.trim()) ?? []
  const timestampParts = parts.filter((part) => /^t=\d+$/.test(part))
  const timestampText = v2
    ? timestampParts.length === 1 ? timestampParts[0].slice(2) : null
    : headers.get('x-bachs-timestamp')
  if (!timestampText || !/^\d+$/.test(timestampText)) return false
  const timestamp = Number(timestampText)
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(now) || Math.abs(now - timestamp) > 300) return false

  const signatures = v2
    ? parts.filter((part) => /^v1=[0-9a-fA-F]{64}$/.test(part)).map((part) => part.slice(3).toLowerCase())
    : [headers.get('x-bachs-signature') ?? ''].filter((part) => /^[0-9a-fA-F]{64}$/.test(part))
  if (signatures.length === 0) return false

  const prefix = new TextEncoder().encode(`${timestamp}.`)
  const message = new Uint8Array(prefix.byteLength + rawBody.byteLength)
  message.set(prefix)
  message.set(rawBody, prefix.byteLength)
  for (const secretValue of secrets) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretValue), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
    for (const hex of signatures) {
      const supplied = Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
      if (supplied.length !== expected.length) continue
      let difference = 0
      for (let i = 0; i < expected.length; i++) difference |= supplied[i] ^ expected[i]
      if (difference === 0) return true
    }
  }
  return false
}
