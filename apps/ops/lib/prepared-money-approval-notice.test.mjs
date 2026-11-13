import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordPreparedMoneyApprovalNotice } from './prepared-money-approval-notice.mjs'

function fixture({ priorSent = false, requestStatus = 'PENDING_APPROVAL', primary = { ok: true, skipped: false }, fallback = null, fallbackRecorded = false, eventError = null, lookupThrowAt = 0, insertThrow = false } = {}) {
  const calls = { primary: 0, fallback: 0, lookups: 0, events: [], edgeEvents: [] }
  const client = {
    from(table) {
      assert.equal(table, 'money_desk_events')
      return {
        select() {
          return { eq() { return this }, limit() { return this }, async maybeSingle() {
            calls.lookups++
            if (calls.lookups === lookupThrowAt) throw new Error('event lookup unavailable')
            return { data: priorSent || calls.edgeEvents.length ? { id: 'sent-event' } : null, error: null }
          } }
        },
        async insert(row) {
          calls.events.push(row)
          if (insertThrow) throw new Error('event insert unavailable')
          return { error: eventError }
        },
      }
    },
  }
  const args = {
    client, requestId: 'request-1', requestStatus, reference: 'MD-ONE',
    actorEmail: 'qa@example.test', actorRole: 'ops', correlationId: 'corr-1',
    reason: 'Reviewed existing test refund',
    async sendPrimary() { calls.primary++; return primary },
    async sendFallback() {
      calls.fallback++
      if (fallbackRecorded) calls.edgeEvents.push({ event_type: 'FOUNDER_APPROVAL_EMAIL_SENT' })
      return fallback
    },
  }
  return { args, calls }
}

test('records an accepted founder notice and does not send on an idempotent replay', async () => {
  const first = fixture()
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(first.args), { email: 'sent', warning: null })
  assert.equal(first.calls.primary, 1)
  assert.equal(first.calls.fallback, 0)
  assert.deepEqual(first.calls.events.map((row) => row.event_type), ['FOUNDER_APPROVAL_EMAIL_SENT'])
  const replay = fixture({ priorSent: true })
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(replay.args), { email: 'sent', warning: null })
  assert.equal(replay.calls.primary + replay.calls.fallback + replay.calls.events.length, 0)
})

test('does not send an approval notice for a completed duplicate request', async () => {
  const completed = fixture({ requestStatus: 'SUCCEEDED' })
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(completed.args), { email: 'skipped', warning: null })
  assert.equal(completed.calls.primary + completed.calls.fallback + completed.calls.events.length, 0)
})

test('records the fallback result, skipped result and provider failure', async () => {
  const recovered = fixture({ primary: { ok: false, skipped: false }, fallback: { ok: true, skipped: false } })
  assert.equal((await recordPreparedMoneyApprovalNotice(recovered.args)).email, 'sent')
  assert.equal(recovered.calls.fallback, 1)
  assert.deepEqual(recovered.calls.events.map((row) => row.event_type), ['FOUNDER_APPROVAL_EMAIL_SENT'])

  const edgeRecorded = fixture({ primary: { ok: false, skipped: true }, fallback: { ok: true, skipped: false }, fallbackRecorded: true })
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(edgeRecorded.args), { email: 'sent', warning: null })
  assert.equal(edgeRecorded.calls.edgeEvents.length, 1)
  assert.equal(edgeRecorded.calls.events.length, 0)

  const skipped = fixture({ primary: { ok: false, skipped: true }, fallback: { ok: false, skipped: true } })
  assert.equal((await recordPreparedMoneyApprovalNotice(skipped.args)).email, 'skipped')
  assert.equal(skipped.calls.fallback, 1)
  assert.deepEqual(skipped.calls.events.map((row) => row.event_type), ['FOUNDER_APPROVAL_EMAIL_SKIPPED'])

  const recoveredFromSkip = fixture({ primary: { ok: false, skipped: true }, fallback: { ok: true, skipped: false } })
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(recoveredFromSkip.args), { email: 'sent', warning: null })
  assert.equal(recoveredFromSkip.calls.fallback, 1)

  const failedAfterSkip = fixture({ primary: { ok: false, skipped: true }, fallback: { ok: false, skipped: false } })
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(failedAfterSkip.args), {
    email: 'failed', warning: 'The review is prepared, but its founder notification needs attention.',
  })

  const failed = fixture({ primary: { ok: false, skipped: false }, fallback: { ok: false, skipped: false } })
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(failed.args), {
    email: 'failed', warning: 'The review is prepared, but its founder notification needs attention.',
  })
  assert.deepEqual(failed.calls.events.map((row) => row.event_type), ['FOUNDER_APPROVAL_EMAIL_FAILED'])
})

test('a notification error never erases the prepared request and an event-save error is reported', async () => {
  const failed = fixture()
  failed.args.sendPrimary = async () => { throw new Error('provider unavailable') }
  failed.args.sendFallback = async () => { throw new Error('edge unavailable') }
  assert.equal((await recordPreparedMoneyApprovalNotice(failed.args)).email, 'failed')
  assert.deepEqual(failed.calls.events.map((row) => row.event_type), ['FOUNDER_APPROVAL_EMAIL_FAILED'])

  const eventUnavailable = fixture({ eventError: new Error('event unavailable') })
  assert.deepEqual(await recordPreparedMoneyApprovalNotice(eventUnavailable.args), {
    email: 'failed', warning: 'The review is prepared, but its founder notification needs attention.',
  })
  assert.deepEqual(eventUnavailable.calls.events.map((row) => row.event_type), ['FOUNDER_APPROVAL_EMAIL_SENT'])
})

test('a thrown audit lookup or insert reports a warning without failing the prepared review', async () => {
  const firstLookup = fixture({ lookupThrowAt: 1 })
  assert.equal((await recordPreparedMoneyApprovalNotice(firstLookup.args)).email, 'failed')
  assert.equal(firstLookup.calls.primary, 0)

  const fallbackLookup = fixture({ primary: { ok: false, skipped: false }, fallback: { ok: true, skipped: false }, lookupThrowAt: 2 })
  assert.equal((await recordPreparedMoneyApprovalNotice(fallbackLookup.args)).email, 'failed')
  assert.equal(fallbackLookup.calls.fallback, 1)

  const insert = fixture({ insertThrow: true })
  assert.equal((await recordPreparedMoneyApprovalNotice(insert.args)).email, 'failed')
  assert.equal(insert.calls.events.length, 1)
})
