import { hasVerifiedProjectBroker } from './broker-policy.ts'
Deno.test('gateway-verified broker must match project, role, expiry and API key', () => {
  const request = (claims: object, matching = true) => {
    const token = `header.${btoa(JSON.stringify(claims))}.gateway-verified-signature`
    return new Request('https://example.invalid', { headers: { authorization: `Bearer ${token}`, apikey: matching ? token : 'other' } })
  }
  const valid = { ref: 'development', role: 'service_role', iat: 900, exp: 1100 }
  if (!hasVerifiedProjectBroker(request(valid), 'development', 1000)) throw Error('Valid gateway broker rejected')
  for (const value of [{ ...valid, ref: 'other' }, { ...valid, role: 'anon' }, { ...valid, exp: 1000 }, { ...valid, iat: 1040 }]) {
    if (hasVerifiedProjectBroker(request(value), 'development', 1000)) throw Error('Invalid broker accepted')
  }
  if (hasVerifiedProjectBroker(request(valid, false), 'development', 1000) || hasVerifiedProjectBroker(new Request('https://example.invalid'), 'development', 1000)) throw Error('Missing/mismatched credentials accepted')
})
