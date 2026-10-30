import assert from 'node:assert/strict'
import test from 'node:test'

import { requiredCaptchaToken } from './local-mfa-captcha.mjs'

test('local MFA auth requires a non-empty captcha token', () => {
  const whitespace = new FormData()
  whitespace.set('captchaToken', '   ')
  const valid = new FormData()
  valid.set('captchaToken', ' token-from-widget ')
  assert.equal(requiredCaptchaToken(new FormData()), null)
  assert.equal(requiredCaptchaToken(whitespace), null)
  assert.equal(requiredCaptchaToken(valid), 'token-from-widget')
})
