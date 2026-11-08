import assert from 'node:assert/strict'
import test from 'node:test'
import { recoveryMfaRequirement, updateRecoveredPassword, verifyRecoveryFactor } from './recovery-mfa.mjs'

test('AAL1 recovery with a verified factor requires MFA before a password update', async () => {
  let updates = 0
  const auth = {
    mfa: {
      async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null } },
      async listFactors() { return { data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null } },
    },
    async updateUser() { updates++; return { error: null } },
  }
  assert.deepEqual(await recoveryMfaRequirement(auth), { ready: false, factorId: 'factor-1' })
  assert.deepEqual(await updateRecoveredPassword(auth, 'new-password'), { error: { code: 'insufficient_aal', message: 'MFA verification is required.' } })
  assert.equal(updates, 0)
})

test('a verified TOTP challenge upgrades recovery before the password update', async () => {
  let level = 'aal1'
  let updates = 0
  const auth = {
    mfa: {
      async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: level, nextLevel: 'aal2' }, error: null } },
      async listFactors() { return { data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null } },
      async challengeAndVerify({ factorId, code }) {
        assert.equal(factorId, 'factor-1')
        assert.equal(code, '123456')
        level = 'aal2'
        return { error: null }
      },
    },
    async updateUser({ password }) { assert.equal(password, 'new-password'); updates++; return { error: null } },
  }
  assert.deepEqual(await verifyRecoveryFactor(auth, 'factor-1', '123456'), { ready: true })
  assert.deepEqual(await updateRecoveredPassword(auth, 'new-password'), { error: null })
  assert.equal(updates, 1)
})

test('accounts without MFA can still reset their password', async () => {
  const auth = {
    mfa: { async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null } } },
    async updateUser() { return { error: null } },
  }
  assert.deepEqual(await recoveryMfaRequirement(auth), { ready: true })
  assert.deepEqual(await updateRecoveredPassword(auth, 'new-password'), { error: null })
})

test('a rejected challenge cannot update the password', async () => {
  let updates = 0
  const auth = {
    mfa: {
      async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null } },
      async listFactors() { return { data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null } },
      async challengeAndVerify() { return { error: new Error('invalid code') } },
    },
    async updateUser() { updates++; return { error: null } },
  }
  assert.deepEqual(await verifyRecoveryFactor(auth, 'factor-1', '000000'), { error: 'code_rejected' })
  await updateRecoveredPassword(auth, 'new-password')
  assert.equal(updates, 0)
})

test('a challenge that does not upgrade the session cannot update the password', async () => {
  let updates = 0
  const auth = {
    mfa: {
      async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null } },
      async listFactors() { return { data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null } },
      async challengeAndVerify() { return { error: null } },
    },
    async updateUser() { updates++; return { error: null } },
  }
  assert.deepEqual(await verifyRecoveryFactor(auth, 'factor-1', '123456'), { error: 'assurance_not_upgraded' })
  await updateRecoveredPassword(auth, 'new-password')
  assert.equal(updates, 0)
})
