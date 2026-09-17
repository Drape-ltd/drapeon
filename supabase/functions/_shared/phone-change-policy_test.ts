import { isCurrentPhoneVerified, phoneChangeRequiresReauth } from './phone-change-policy.ts'

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

Deno.test('initial and unverified phone collection does not require reauthentication', () => {
  expect(
    !phoneChangeRequiresReauth({
      phoneChanged: true,
      currentPhone: '',
      phoneVerifiedAt: null,
      verifiedPhone: '',
    }),
    'the first onboarding phone should save without a code'
  )
  expect(
    !phoneChangeRequiresReauth({
      phoneChanged: true,
      currentPhone: '+12025550110',
      phoneVerifiedAt: null,
      verifiedPhone: '',
    }),
    'an unverified onboarding phone should remain editable without a code'
  )
})

Deno.test('changing the currently verified phone still requires reauthentication', () => {
  expect(
    phoneChangeRequiresReauth({
      phoneChanged: true,
      currentPhone: '+12025550110',
      phoneVerifiedAt: '2026-09-17T15:00:00.000Z',
      verifiedPhone: '+12025550110',
    }),
    'verified phone changes must remain protected'
  )
})

Deno.test('a stale verification marker cannot verify a replacement phone', () => {
  expect(
    !isCurrentPhoneVerified({
      currentPhone: '+12025550111',
      phoneVerifiedAt: '2026-09-17T15:00:00.000Z',
      verifiedPhone: '+12025550110',
    }),
    'verification must stay bound to the number that earned it'
  )
})

Deno.test('legacy timestamps protect the current phone when no binding was stored', () => {
  expect(
    isCurrentPhoneVerified({
      currentPhone: '+12025550110',
      phoneVerifiedAt: '2026-09-17T15:00:00.000Z',
      verifiedPhone: '',
    }),
    'legacy verified numbers should not lose reauthentication protection'
  )
})
