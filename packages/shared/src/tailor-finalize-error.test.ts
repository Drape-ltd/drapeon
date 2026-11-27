import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { tailorFinalizeFailureCopy } from './tailor-finalize-error.ts'

test('every terminal and cleanup failure has safe, actionable copy', () => {
  for (const code of [
    'FINALIZE_READINESS_CHANGED',
    'PROMOTED_MANIFEST_STALE',
    'FINALIZE_MEDIA_CHANGED',
    'PROMOTED_ASSET_INVALID',
    'PROMOTED_MEDIA_INCOMPLETE',
    'SOURCE_MANIFEST_INVALID',
    'FINALIZE_CLEANUP_RETRY',
    'FINALIZE_RETRY_REQUIRED',
  ]) {
    const copy = tailorFinalizeFailureCopy(code)
    assert.ok(copy)
    assert.match(copy, /try|retry/i)
    assert.ok(!copy.includes(code))
  }
  assert.equal(tailorFinalizeFailureCopy('unrecognized'), null)
  assert.equal(tailorFinalizeFailureCopy(null), null)
})
