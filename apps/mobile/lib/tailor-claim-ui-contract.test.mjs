import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mobileRoot = new URL('../', import.meta.url)
const route = readFileSync(new URL('app/claim/[token].tsx', mobileRoot), 'utf8')
const webFlow = readFileSync(
  new URL('../../web/components/claim-web-flow.tsx', import.meta.url),
  'utf8'
)

test('claim sign-in and pickup reuse the shared Drapeon form primitives', () => {
  assert.match(route, /accountStep === 'password'/)
  assert.match(route, /textContentType="newPassword"/)
  assert.match(route, /autoComplete="new-password"/)
  assert.match(route, /<PhoneNumberInput/)
  assert.match(route, /<AddressAutocompleteInput/)
  assert.match(route, /<ChoiceSheet/)
  assert.match(route, /Apartment \/ unit \(optional\)/)
  assert.match(route, /Confirm your address/)
  assert.match(route, /Enter manually/)
  assert.match(webFlow, /<StructuredAddressSearch/)
  assert.match(webFlow, /autoComplete="new-password"/)
  assert.match(webFlow, /Show password/)
  assert.match(webFlow, /Apartment \/ unit \(optional\)/)
})
