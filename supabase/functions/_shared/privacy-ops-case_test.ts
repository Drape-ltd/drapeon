import assert from 'node:assert/strict'
import { ensurePrivacyOpsCase } from './privacy-ops-case.ts'

type Row = Record<string, unknown> | null

function fakeClient(initial: Row = null, lookupError: string | null = null) {
  let row = initial
  let lookups = 0
  return {
    client: {
      from(table: string) {
        assert.equal(table, 'ops_issues')
        return {
          select() {
            return {
              eq(column: string, value: string) {
                assert.equal(column, 'dedupe_key')
                assert.equal(value, 'account-deletion:qa-user')
                return { maybeSingle() {
                  lookups++
                  return Promise.resolve({ data: row, error: lookupError ? { message: lookupError } : null })
                } }
              },
            }
          },
        }
      },
    },
    setRow(next: Row) { row = next },
    get lookups() { return lookups },
  }
}

const expected = {
  dedupeKey: 'account-deletion:qa-user',
  issueType: 'ACCOUNT_DELETION_REQUEST' as const,
  environment: 'DEVELOPMENT',
  userId: 'qa-user',
  relatedEntityId: 'request-1',
}
const matching = {
  id: 'case-1', issue_type: 'ACCOUNT_DELETION_REQUEST', environment: 'DEVELOPMENT',
  user_id: 'qa-user', related_entity_type: 'account_deletion_request', related_entity_id: 'request-1',
}

Deno.test('existing matching privacy case is reused without another write', async () => {
  const state = fakeClient(matching)
  let repairs = 0
  await ensurePrivacyOpsCase(state.client, expected, () => { repairs++ })
  assert.equal(repairs, 0)
  assert.equal(state.lookups, 1)
})

Deno.test('missing case is created once, then an unchanged retry is read-only', async () => {
  const state = fakeClient()
  let repairs = 0
  const repair = () => { repairs++; state.setRow(matching) }
  await ensurePrivacyOpsCase(state.client, expected, repair)
  await ensurePrivacyOpsCase(state.client, expected, repair)
  assert.equal(repairs, 1)
  assert.equal(state.lookups, 3)
})

Deno.test('wrong canonical case binding is repaired before alreadyPending', async () => {
  const state = fakeClient({ ...matching, related_entity_id: 'old-request' })
  await ensurePrivacyOpsCase(state.client, expected, () => state.setRow(matching))
  assert.equal(state.lookups, 2)
})

Deno.test('failed repair and lookup fail closed', async () => {
  const missing = fakeClient()
  await assert.rejects(() => ensurePrivacyOpsCase(missing.client, expected, () => null), /Ops case is unavailable/u)
  const failedLookup = fakeClient(null, 'connection failed')
  await assert.rejects(() => ensurePrivacyOpsCase(failedLookup.client, expected, () => null), /lookup failed/u)
})

Deno.test('data-access case matches by user, type and environment', async () => {
  const state = fakeClient({ ...matching, issue_type: 'DATA_ACCESS_REQUEST', related_entity_type: null, related_entity_id: null })
  let repairs = 0
  await ensurePrivacyOpsCase(state.client, {
    ...expected, issueType: 'DATA_ACCESS_REQUEST', relatedEntityId: undefined,
  }, () => { repairs++ })
  assert.equal(repairs, 0)
})
