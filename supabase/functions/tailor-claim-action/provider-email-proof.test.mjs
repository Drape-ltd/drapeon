import assert from 'node:assert/strict'
import test from 'node:test'
import { verifiedProviderEmail } from './provider-email-proof.mjs'

test('Apple verified relay email remains eligible', () => {
  assert.equal(
    verifiedProviderEmail({ email: 'TAILOR@privaterelay.appleid.com', email_verified: 'true' }),
    'tailor@privaterelay.appleid.com'
  )
})

test('Google email without verified evidence must use the claim-owned code', () => {
  assert.equal(verifiedProviderEmail({ email: 'tailor@example.com', email_verified: false }), null)
  assert.equal(verifiedProviderEmail({ email: 'tailor@example.com' }), null)
  assert.equal(verifiedProviderEmail({ email: 'tailor@example.com', email_verified: true }), 'tailor@example.com')
})

test('verified flag without a usable email cannot hand over an account', () => {
  assert.equal(verifiedProviderEmail({ email: '', email_verified: true }), null)
  assert.equal(verifiedProviderEmail({ email: 'bad address', email_verified: 'true' }), null)
})
