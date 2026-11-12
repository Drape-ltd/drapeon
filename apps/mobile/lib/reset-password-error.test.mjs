import assert from 'node:assert/strict'
import test from 'node:test'
import { mapResetPasswordError } from './reset-password-error.mjs'

test('MFA assurance failure directs mobile recovery to the web flow', () => {
  const copy = 'This account uses an authenticator. Finish the reset on drapeon.co.'
  assert.equal(mapResetPasswordError({ code: 'insufficient_aal', message: 'AAL2 session is required to update email or password when MFA is enabled.' }, 'password policy'), copy)
  assert.equal(mapResetPasswordError({ message: 'AAL2 session is required to update email or password when MFA is enabled.' }, 'password policy'), copy)
})

test('other mobile reset errors keep their existing guidance', () => {
  assert.equal(mapResetPasswordError({ message: 'Weak password' }, 'password policy'), 'password policy')
  assert.equal(mapResetPasswordError({ message: 'expired session' }, 'password policy'), 'This reset link is no longer valid. Request a new link and try again.')
})
