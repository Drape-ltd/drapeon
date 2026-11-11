import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  HISTORICAL_MONEY_PUSH_SOURCE,
  reconcileDevHistoricalMoneyPushes,
  sha256SortedIds,
  type HistoricalCase,
  type HistoricalRecoveryPort,
} from './dev-historical-money-push-recovery.ts'

function fixture() {
  const ids = Array.from({ length: 7 }, (_, index) => `job-${index + 1}`)
  const cases: HistoricalCase[] = [{
    id: 'case-1', source: HISTORICAL_MONEY_PUSH_SOURCE,
    relatedEntityId: ids[0], issueNumber: 1, orderId: null,
  }]
  const accepted = new Set<string>()
  const sent: string[] = []
  let created = 0
  const port: HistoricalRecoveryPort = {
    targetIds: () => Promise.resolve(ids),
    cases: () => Promise.resolve([...cases]),
    async createMissingCases() {
      created += 1
      cases.push(...ids.slice(1).map((id, index) => ({
        id: `case-${index + 2}`, source: HISTORICAL_MONEY_PUSH_SOURCE,
        relatedEntityId: id, issueNumber: index + 2, orderId: null,
      })))
    },
    acceptedNotices: () => Promise.resolve([...accepted]),
    async sendNotice(issue) {
      sent.push(issue.id)
      return { ok: true, providerReference: `email-${issue.id}` }
    },
    async recordNotice(notice) { accepted.add(notice.caseId) },
  }
  return { ids, cases, accepted, sent, port, created: () => created }
}

Deno.test('partial one-of-seven case state creates six cases, sends seven notices, and replay sends none', async () => {
  const f = fixture()
  const hash = await sha256SortedIds(f.ids)
  assertEquals(await reconcileDevHistoricalMoneyPushes(f.port, hash), {
    targetCount: 7, casesCreated: 6, noticesAccepted: 7,
  })
  assertEquals(f.created(), 1)
  assertEquals(f.sent.length, 7)
  assertEquals(f.accepted.size, 7)
  assertEquals(await reconcileDevHistoricalMoneyPushes(f.port, hash), {
    targetCount: 7, casesCreated: 0, noticesAccepted: 0,
  })
  assertEquals(f.created(), 1)
  assertEquals(f.sent.length, 7)
})

Deno.test('changed job set stops before any case or notice write', async () => {
  const f = fixture()
  await assertRejects(
    () => reconcileDevHistoricalMoneyPushes(f.port, '0'.repeat(64)),
    Error, 'HISTORICAL_JOB_SET_CHANGED',
  )
  assertEquals(f.created(), 0)
  assertEquals(f.sent.length, 0)
})

Deno.test('unexpected existing case source stops before writes', async () => {
  const f = fixture()
  f.cases[0].source = 'other-source'
  const hash = await sha256SortedIds(f.ids)
  await assertRejects(
    () => reconcileDevHistoricalMoneyPushes(f.port, hash),
    Error, 'HISTORICAL_CASE_MISMATCH',
  )
  assertEquals(f.created(), 0)
  assertEquals(f.sent.length, 0)
})

Deno.test('failed Ops notice stops with the partial state visible for review', async () => {
  const f = fixture()
  f.port.sendNotice = async () => ({ ok: false, providerReference: null })
  const hash = await sha256SortedIds(f.ids)
  await assertRejects(
    () => reconcileDevHistoricalMoneyPushes(f.port, hash),
    Error, 'HISTORICAL_OPS_NOTICE_FAILED',
  )
  assertEquals(f.cases.length, 7)
  assertEquals(f.accepted.size, 0)
})

Deno.test('an interrupted notice run resumes only missing notices', async () => {
  const f = fixture()
  const hash = await sha256SortedIds(f.ids)
  f.accepted.add('case-1')
  assertEquals(await reconcileDevHistoricalMoneyPushes(f.port, hash), {
    targetCount: 7, casesCreated: 6, noticesAccepted: 6,
  })
  assertEquals(f.sent.length, 6)
  assertEquals(f.accepted.size, 7)
})

Deno.test('unexpected case count fails before any notification', async () => {
  const f = fixture()
  f.cases.push({
    id: 'case-extra', source: HISTORICAL_MONEY_PUSH_SOURCE,
    relatedEntityId: f.ids[1], issueNumber: 9, orderId: null,
  })
  const hash = await sha256SortedIds(f.ids)
  await assertRejects(
    () => reconcileDevHistoricalMoneyPushes(f.port, hash),
    Error, 'HISTORICAL_PARTIAL_STATE_CHANGED',
  )
  assertEquals(f.created(), 0)
  assertEquals(f.sent.length, 0)
})
