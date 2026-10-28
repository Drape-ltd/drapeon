import { bachsAmountMinor } from './bachs.ts'

export type BachsConnectEvent = {
  id: string
  type: string
  created_at?: string
  organization_id?: string
  account?: string
  data?: Record<string, unknown>
}

export type BachsAccountRefreshEvent = {
  accountId: string
  kind: 'ONBOARDING' | 'CAPABILITY'
}

const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9_-]+$/u
const WITHDRAWAL_ID_PATTERN = /^pay_[A-Za-z0-9_-]+$/u

export function parseBachsAccountRefreshEvent(
  event: BachsConnectEvent,
): BachsAccountRefreshEvent | null {
  if (event.type !== 'account.updated' && event.type !== 'capability.updated') return null
  const dataAccount = event.data?.account
  const accountIds = [event.organization_id, event.account, dataAccount]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (
    accountIds.length < 2 ||
    accountIds.some((value) => value !== accountIds[0] || !ACCOUNT_ID_PATTERN.test(value))
  ) {
    throw new Error('BACHS_CONNECT_ACCOUNT_EVENT_IDENTITY_MISMATCH')
  }
  if (event.type === 'account.updated') {
    // This event only triggers a fresh GET /v1/accounts/{id}; requirement
    // payload shape is provider-owned and is never stored or trusted here.
    return { accountId: accountIds[0], kind: 'ONBOARDING' }
  }

  const capability = event.data?.capability
  const status = event.data?.status
  if (
    typeof capability !== 'string' || capability.length === 0 ||
    (status !== 'active' && status !== 'restricted') ||
    typeof event.data?.requested !== 'boolean'
  ) {
    throw new Error('BACHS_CONNECT_CAPABILITY_EVENT_INVALID')
  }
  return { accountId: accountIds[0], kind: 'CAPABILITY' }
}

export type BachsWithdrawalEvent = {
  accountId: string
  withdrawalId: string
  amountMinor: number
  currency: string
  status: 'PENDING' | 'PAID' | 'FAILED'
}

export type BachsWithdrawalHistoryEntry = {
  provider_destination_id: string | null
  provider_bank_payout_id: string | null
  amount: number | null
  currency: string | null
  status: string | null
  occurred_at: string | null
}

export type BachsWithdrawalOpsState =
  | 'OPEN_FAILURE'
  | 'RESOLVE_FAILURE'
  | 'UNCHANGED'
  | 'AMBIGUOUS'

/**
 * Bachs explicitly does not guarantee webhook ordering. Resolve an account-level
 * withdrawal failure only when the complete stored history has an unambiguous,
 * identity-matched latest PAID event. A delayed older FAILED event must not
 * reopen a resolved case.
 */
export function bachsWithdrawalOpsState(input: {
  withdrawal: BachsWithdrawalEvent
  history: BachsWithdrawalHistoryEntry[]
  maxEvents?: number
}): BachsWithdrawalOpsState {
  const maxEvents = input.maxEvents ?? 20
  if (input.history.length === 0 || input.history.length > maxEvents) {
    return 'AMBIGUOUS'
  }

  let latestAt = Number.NEGATIVE_INFINITY
  let latestStatuses = new Set<string>()
  for (const event of input.history) {
    const status = event.status?.toUpperCase()
    const occurredAt = event.occurred_at ? Date.parse(event.occurred_at) : Number.NaN
    if (
      event.provider_destination_id !== input.withdrawal.accountId ||
      event.provider_bank_payout_id !== input.withdrawal.withdrawalId ||
      event.amount !== input.withdrawal.amountMinor ||
      event.currency?.toUpperCase() !== input.withdrawal.currency ||
      !['PENDING', 'PAID', 'FAILED'].includes(status ?? '') ||
      !Number.isFinite(occurredAt)
    ) {
      return 'AMBIGUOUS'
    }
    if (occurredAt > latestAt) {
      latestAt = occurredAt
      latestStatuses = new Set([status!])
    } else if (occurredAt === latestAt) {
      latestStatuses.add(status!)
    }
  }

  if (latestStatuses.size !== 1) return 'AMBIGUOUS'
  const latestStatus = [...latestStatuses][0]
  if (latestStatus === 'FAILED') return 'OPEN_FAILURE'
  if (latestStatus === 'PAID') return 'RESOLVE_FAILURE'
  return 'UNCHANGED'
}

export function parseBachsWithdrawalEvent(
  event: BachsConnectEvent,
): BachsWithdrawalEvent | null {
  const status = event.type === 'payout.created'
    ? 'PENDING'
    : event.type === 'payout.paid'
      ? 'PAID'
      : event.type === 'payout.failed'
        ? 'FAILED'
        : null
  if (!status) return null

  const data = event.data ?? {}
  const accountId = event.organization_id
  const withdrawalId = data.withdrawal_id
  const currency = typeof data.currency === 'string' ? data.currency.toUpperCase() : ''
  if (
    typeof accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(accountId) ||
    (event.account !== undefined && event.account !== accountId) ||
    typeof withdrawalId !== 'string' || !WITHDRAWAL_ID_PATTERN.test(withdrawalId) ||
    !/^[A-Z]{3}$/u.test(currency) || typeof data.amount !== 'string'
  ) {
    throw new Error('BACHS_PAYOUT_EVENT_IDENTITY_INVALID')
  }
  const eventStatus = data.status
  if (
    (status === 'PENDING' && eventStatus !== 'pending') ||
    (status === 'PAID' && eventStatus !== 'completed') ||
    (status === 'FAILED' && eventStatus !== 'failed')
  ) {
    throw new Error('BACHS_PAYOUT_EVENT_STATUS_MISMATCH')
  }

  let amountMinor: number
  try {
    amountMinor = bachsAmountMinor(data.amount, currency)
  } catch {
    throw new Error('BACHS_PAYOUT_EVENT_AMOUNT_INVALID')
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('BACHS_PAYOUT_EVENT_AMOUNT_INVALID')
  }
  return { accountId, withdrawalId, amountMinor, currency, status }
}
