import assert from 'node:assert/strict'
import { evaluateIdentityUnlink } from './identity-unlink-policy.ts'

const email = { identity_id: 'e', provider: 'email', identity_data: { email: 'Owner@Example.com' } }
const ownerGoogle = { identity_id: 'g1', provider: 'google', identity_data: { email: 'owner@example.com' } }
const otherGoogle = { identity_id: 'g2', provider: 'google', identity_data: { email: 'attacker@example.net' } }

Deno.test('removes a second Google sign-in while the account email stays on another method', () => {
  const result = evaluateIdentityUnlink({ identities: [ownerGoogle, otherGoogle], identityId: 'g2', accountEmail: 'owner@example.com', accountEmailConfirmed: true })
  assert.deepEqual([result.belongsToAccount, result.providerRemovable, result.anotherMethodRemains, result.accountEmailKept], [true, true, true, true])
})

Deno.test('refuses to remove the only method carrying the account email', () => {
  const result = evaluateIdentityUnlink({ identities: [ownerGoogle, otherGoogle], identityId: 'g1', accountEmail: 'owner@example.com', accountEmailConfirmed: true })
  assert.deepEqual(result.accountEmailKept, false)
})

Deno.test('refuses the last sign-in method, the email identity, foreign IDs and unconfirmed emails', () => {
  assert.deepEqual(evaluateIdentityUnlink({ identities: [ownerGoogle], identityId: 'g1', accountEmail: 'owner@example.com', accountEmailConfirmed: true }).anotherMethodRemains, false)
  assert.deepEqual(evaluateIdentityUnlink({ identities: [email, ownerGoogle], identityId: 'e', accountEmail: 'owner@example.com', accountEmailConfirmed: true }).providerRemovable, false)
  const foreign = evaluateIdentityUnlink({ identities: [email, ownerGoogle], identityId: 'not-mine', accountEmail: 'owner@example.com', accountEmailConfirmed: true })
  assert.deepEqual([foreign.belongsToAccount, foreign.anotherMethodRemains], [false, false])
  assert.deepEqual(evaluateIdentityUnlink({ identities: [email, ownerGoogle], identityId: 'g1', accountEmail: 'owner@example.com', accountEmailConfirmed: false }).accountEmailKept, false)
})

Deno.test('the email identity keeps the account email (case-insensitive)', () => {
  assert.deepEqual(evaluateIdentityUnlink({ identities: [email, ownerGoogle], identityId: 'g1', accountEmail: 'owner@example.com', accountEmailConfirmed: true }).accountEmailKept, true)
})
