import assert from 'node:assert/strict'
import test from 'node:test'
import { deepLinkHasPkceCode, jwtSubject, shouldAcceptDeepLinkTokens } from './auth-deep-link.ts'

function token(sub: string) {
  const body = Buffer.from(JSON.stringify({ sub, aud: 'authenticated' })).toString('base64url')
  return `eyJhbGciOiJIUzI1NiJ9.${body}.signature`
}

test('reads the subject from a JWT payload without trusting it for anything else', () => {
  assert.equal(jwtSubject(token('user-a')), 'user-a')
  assert.equal(jwtSubject('not-a-jwt'), null)
  assert.equal(jwtSubject(null), null)
})

test('a link cannot sign a signed-out production device into any account', () => {
  assert.equal(shouldAcceptDeepLinkTokens({ accessToken: token('attacker'), currentUserId: null, appVariant: 'production' }), false)
})

test('a link cannot switch a signed-in device to another account', () => {
  assert.equal(shouldAcceptDeepLinkTokens({ accessToken: token('attacker'), currentUserId: 'victim', appVariant: 'production' }), false)
  assert.equal(shouldAcceptDeepLinkTokens({ accessToken: token('attacker'), currentUserId: 'victim', appVariant: 'preview' }), false)
})

test('tokens for the already signed-in account and Development QA links are accepted', () => {
  assert.equal(shouldAcceptDeepLinkTokens({ accessToken: token('victim'), currentUserId: 'victim', appVariant: 'production' }), true)
  assert.equal(shouldAcceptDeepLinkTokens({ accessToken: token('qa'), currentUserId: null, appVariant: 'development' }), true)
})

test('detects a PKCE code in the query string only', () => {
  assert.equal(deepLinkHasPkceCode('drape://callback?code=abc'), true)
  assert.equal(deepLinkHasPkceCode('drape://callback#access_token=x&refresh_token=y'), false)
})
