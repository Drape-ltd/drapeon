import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreLocalMfaSession } from './local-mfa-session-refresh.mjs'

test('expired access cookie is refreshed from the long-lived refresh cookie', async () => {
  const calls = []
  const session = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }
  const result = await restoreLocalMfaSession({
    async setSession(tokens) {
      calls.push(['set', tokens])
      return { data: { session: null }, error: new Error('expired') }
    },
    async refreshSession(tokens) {
      calls.push(['refresh', tokens])
      return { data: { session }, error: null }
    },
  }, { accessToken: 'expired-access', refreshToken: 'valid-refresh' })

  assert.deepEqual(result, { session, refreshed: true })
  assert.deepEqual(calls[1], ['refresh', { refresh_token: 'valid-refresh' }])
})

test('valid session does not rotate its refresh token unnecessarily', async () => {
  let refreshCalls = 0
  const session = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }
  const result = await restoreLocalMfaSession({
    async setSession() {
      return { data: { session }, error: null }
    },
    async refreshSession() {
      refreshCalls += 1
      return { data: { session: null }, error: new Error('unexpected') }
    },
  }, { accessToken: 'access', refreshToken: 'refresh' })

  assert.deepEqual(result, { session, refreshed: false })
  assert.equal(refreshCalls, 0)
})

test('refresh cookie alone can restore a session without password or captcha', async () => {
  let setCalls = 0
  const session = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }
  const result = await restoreLocalMfaSession({
    async setSession() {
      setCalls += 1
      return { data: { session: null }, error: null }
    },
    async refreshSession(tokens) {
      assert.deepEqual(tokens, { refresh_token: 'valid-refresh' })
      return { data: { session }, error: null }
    },
  }, { accessToken: null, refreshToken: 'valid-refresh' })

  assert.deepEqual(result, { session, refreshed: true })
  assert.equal(setCalls, 0)
})
