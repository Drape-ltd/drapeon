import assert from 'node:assert/strict'
import test from 'node:test'
import { contentSecurityPolicy, PRODUCTION_MEDIA_ORIGINS } from '../lib/content-security-policy.mjs'

test('production CSP always permits the approved production Storage origins', () => {
  const policy = contentSecurityPolicy('test-nonce', {
    development: false,
    configuredSupabaseUrl: undefined,
  })

  for (const origin of PRODUCTION_MEDIA_ORIGINS) {
    assert.match(policy, new RegExp(`img-src[^;]*${origin.replaceAll('.', '\\.')}`))
    assert.match(policy, new RegExp(`media-src[^;]*${origin.replaceAll('.', '\\.')}`))
  }
  assert.doesNotMatch(policy, /undefined|http:\/\/localhost/)
})

test('development can additionally render a configured local Storage endpoint', () => {
  const policy = contentSecurityPolicy('test-nonce', {
    development: true,
    configuredSupabaseUrl: 'http://127.0.0.1:54321',
  })

  assert.match(policy, /img-src[^;]*http:\/\/127\.0\.0\.1:54321/)
  assert.match(policy, /media-src[^;]*http:\/\/127\.0\.0\.1:54321/)
})
