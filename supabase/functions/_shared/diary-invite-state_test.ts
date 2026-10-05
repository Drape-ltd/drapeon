import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { planDiaryInviteTransition } from './diary-invite-state.ts'

const nowMs = Date.parse('2026-10-01T18:00:00.000Z')
const future = '2026-10-31T18:00:00.000Z'
const past = '2026-09-30T18:00:00.000Z'

Deno.test('copied links create a 30-day lifecycle state when no invite exists', () => {
  assertEquals(planDiaryInviteTransition({
    action: 'mark-invite-copied', currentStatus: 'NOT_INVITED', inviteExpiresAt: null, nowMs,
  }), { outcome: 'update', status: 'LINK_COPIED' })
})

Deno.test('a shared link is not downgraded by a duplicate copied-link retry', () => {
  assertEquals(planDiaryInviteTransition({
    action: 'mark-invite-copied', currentStatus: 'LINK_SHARED', inviteExpiresAt: future, nowMs,
  }), { outcome: 'unchanged', status: 'LINK_SHARED' })
})

Deno.test('legacy sent state is recognized as a successful shared outcome', () => {
  assertEquals(planDiaryInviteTransition({
    action: 'mark-invite-shared', currentStatus: 'INVITE_SENT', inviteExpiresAt: future, nowMs,
  }), { outcome: 'unchanged', status: 'INVITE_SENT' })
})

Deno.test('expired links refresh their expiry while preserving the latest requested outcome', () => {
  assertEquals(planDiaryInviteTransition({
    action: 'mark-invite-shared', currentStatus: 'LINK_SHARED', inviteExpiresAt: past, nowMs,
  }), { outcome: 'update', status: 'LINK_SHARED' })
})

Deno.test('claimed passports reject every invite-state update', () => {
  for (const action of ['mark-invite-copied', 'mark-invite-shared', 'mark-invite-sent'] as const) {
    assertEquals(planDiaryInviteTransition({ action, currentStatus: 'CLAIMED', inviteExpiresAt: past, nowMs }), { outcome: 'claimed' })
  }
})
