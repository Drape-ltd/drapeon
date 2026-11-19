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
  assert.match(route, /POSTCODE_OPTIONAL_COUNTRIES = new Set\(\['GH', 'NG'\]\)/)
  assert.match(route, /value\.replace\(\/\\D\/gu, ''\) === '' \? null/)
  assert.match(route, /textContentType="oneTimeCode"/)
  assert.match(route, /Resend code/)
  assert.match(webFlow, /<StructuredAddressSearch/)
  assert.match(webFlow, /autoComplete="new-password"/)
  assert.match(webFlow, /Show password/)
  assert.match(webFlow, /Apartment \/ unit \(optional\)/)
  assert.match(webFlow, /POSTCODE_OPTIONAL_COUNTRIES = new Set\(\['GH', 'NG'\]\)/)
  assert.match(webFlow, /event\.target\.value\.replace\(\/\\D\/gu, ''\) === ''/)
  assert.match(webFlow, /autoComplete="one-time-code"/)
  assert.match(webFlow, /Resend code/)
})
