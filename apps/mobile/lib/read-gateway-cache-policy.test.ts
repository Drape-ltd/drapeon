import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseCachedFallback } from './read-gateway-cache-policy.ts'

test('a failed refresh may use only an unexpired cached marketplace response', () => {
  assert.equal(canUseCachedFallback(1_001, 1_000), true)
  assert.equal(canUseCachedFallback(1_000, 1_000), false)
  assert.equal(canUseCachedFallback(999, 1_000), false)
  assert.equal(canUseCachedFallback(Number.POSITIVE_INFINITY, 1_000), false)
})
