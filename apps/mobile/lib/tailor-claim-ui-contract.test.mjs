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
  assert.match(route, /claimPickupPostcodeRequired/)
  assert.match(route, /value\.replace\(\/\\D\/gu, ''\) === '' \? null/)
  assert.match(route, /textContentType="oneTimeCode"/)
  assert.match(route, /Resend code/)
  assert.match(
    route,
    /label="Claim and continue"\s+icon="arrow-right"\s+testID="claim-final-action-dock"/
  )
  assert.match(route, /Next: verify your phone to go live\./)
  assert.match(
    route,
    /provider === 'apple'\s*\?[\s\S]*Try Apple sign-in again[\s\S]*:\s*'The earlier sign-in was closed for safety\. Request a new six-digit email code to continue\.'/
  )
  assert.match(webFlow, /<StructuredAddressSearch/)
  assert.match(webFlow, /autoComplete="new-password"/)
  assert.match(webFlow, /Show password/)
  assert.match(webFlow, /Apartment \/ unit \(optional\)/)
  assert.match(webFlow, /claimPickupPostcodeRequired/)
  assert.match(webFlow, /event\.target\.value\.replace\(\/\\D\/gu, ''\) === ''/)
  assert.match(webFlow, /autoComplete="one-time-code"/)
  assert.match(webFlow, /Resend code/)
  assert.match(webFlow, /Claim and continue/)
  assert.match(webFlow, /<ArrowRight aria-hidden="true" size=\{16\} \/>/)
  assert.match(webFlow, /Next: verify your phone to go live\./)
  assert.match(
    webFlow,
    /SECURE_SESSION_SETUP_RETRY'[\s\S]*The earlier sign-in was closed for safety\. Request a new six-digit email code to continue\./
  )
})
