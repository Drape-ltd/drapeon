import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  parseBachsAccountRefreshEvent,
  parseBachsWithdrawalEvent,
  type BachsConnectEvent,
} from './bachs-connect-events.ts'

Deno.test('Bachs account.updated is progress only and requires one exact account identity', () => {
  const event: BachsConnectEvent = {
    id: 'evt_1234',
    type: 'account.updated',
    organization_id: 'acct_tailor1',
    account: 'acct_tailor1',
    data: { account: 'acct_tailor1' },
  }
  assertEquals(parseBachsAccountRefreshEvent(event), {
    accountId: 'acct_tailor1',
    kind: 'ONBOARDING',
  })
  assertEquals(
    parseBachsAccountRefreshEvent({
      id: 'evt_1237',
      type: 'account.updated',
      organization_id: 'acct_tailor1',
      data: { account: 'acct_tailor1', requirements_changed: true },
    }),
    { accountId: 'acct_tailor1', kind: 'ONBOARDING' },
  )
  assertThrows(
    () => parseBachsAccountRefreshEvent({ ...event, data: { account: 'acct_other', outstanding: [] } }),
    Error,
    'BACHS_CONNECT_ACCOUNT_EVENT_IDENTITY_MISMATCH',
  )
})

Deno.test('Bachs capability.updated accepts only authoritative active/restricted evidence', () => {
  const event: BachsConnectEvent = {
    id: 'evt_1235',
    type: 'capability.updated',
    organization_id: 'acct_tailor1',
    account: 'acct_tailor1',
    data: { account: 'acct_tailor1', capability: 'payouts', status: 'active', requested: true },
  }
  assertEquals(parseBachsAccountRefreshEvent(event), {
    accountId: 'acct_tailor1',
    kind: 'CAPABILITY',
  })
  assertThrows(
    () => parseBachsAccountRefreshEvent({ ...event, data: { ...event.data, status: 'pending' } }),
    Error,
    'BACHS_CONNECT_CAPABILITY_EVENT_INVALID',
  )
})

Deno.test('Bachs account withdrawal events map decimal money to minor units and status', () => {
  const base: BachsConnectEvent = {
    id: 'evt_1236',
    type: 'payout.created',
    organization_id: 'acct_tailor1',
    data: {
      withdrawal_id: 'pay_withdrawal1',
      status: 'pending',
      amount: '7000.00',
      currency: 'NGN',
    },
  }
  assertEquals(parseBachsWithdrawalEvent(base), {
    accountId: 'acct_tailor1',
    withdrawalId: 'pay_withdrawal1',
    amountMinor: 700000,
    currency: 'NGN',
    status: 'PENDING',
  })
  assertEquals(parseBachsWithdrawalEvent({ ...base, type: 'payout.paid', data: { ...base.data, status: 'completed' } })?.status, 'PAID')
  assertEquals(parseBachsWithdrawalEvent({ ...base, type: 'payout.failed', data: { ...base.data, status: 'failed' } })?.status, 'FAILED')
  assertThrows(
    () => parseBachsWithdrawalEvent({ ...base, data: { ...base.data, amount: '7000.001' } }),
    Error,
    'BACHS_PAYOUT_EVENT_AMOUNT_INVALID',
  )
  assertThrows(
    () => parseBachsWithdrawalEvent({ ...base, data: { ...base.data, status: 'completed' } }),
    Error,
    'BACHS_PAYOUT_EVENT_STATUS_MISMATCH',
  )
})
