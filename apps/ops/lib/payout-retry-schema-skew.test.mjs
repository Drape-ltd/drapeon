import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('Ops and the Edge read gateway suppress only the optional payout retry projection on schema skew', async () => {
  const [opsSource, edgeSource] = await Promise.all([
    readFile(new URL('./money-data.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../supabase/functions/_shared/ops-read-projections.ts', import.meta.url), 'utf8'),
  ])

  for (const source of [opsSource, edgeSource]) {
    assert.match(source, /optionalPayoutRetryRows/)
    assert.match(source, /if \(!retrySchemaSupported\) retryClaimRows = \[\]/)
    assert.match(source, /retryCandidates/)
  }
})
