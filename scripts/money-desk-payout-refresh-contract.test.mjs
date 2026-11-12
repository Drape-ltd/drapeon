import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

for (const path of [
  'apps/web/lib/money-desk-execution.ts',
  'supabase/functions/_shared/ops-money-execution.ts',
]) {
  test(`${path} refreshes an approved tranche or adjustment before provider release`, () => {
    const source = readFileSync(path, 'utf8')
    const refresh = source.indexOf('await refreshPinnedStripeDestinationForRelease({')
    const tranche = source.indexOf("'release-settlement-tranche'", refresh)
    const adjustment = source.indexOf("'release-tailor-adjustment'", refresh)
    assert.ok(refresh > 0, 'the executor must call the tested readiness helper')
    assert.ok(tranche > refresh, 'the tranche provider call must follow refresh')
    assert.ok(adjustment > refresh, 'the adjustment provider call must follow refresh')
    assert.match(source, /runAdapter\(client, session, attemptId, \{/u)
  })
}
