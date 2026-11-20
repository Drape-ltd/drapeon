import { bachsAmount, bachsAmountMinor, bachsBalanceAmountMinor, type createBachsClient } from './bachs.ts'

type BachsClient = ReturnType<typeof createBachsClient>
type BachsFeesCollector = 'PLATFORM' | 'CONNECTED_ACCOUNT'

export type BachsAccount = {
  id: string
  country: string
  capabilities?: {
    transfers?: { status?: string }
    payouts?: { status?: string }
  }
  responsibilities?: { fees?: { collector?: 'platform' | 'bachs' } }
  requirements?: {
    currently_due?: string[]
    past_due?: string[]
    pending_verification?: string[]
  }
}

export function bachsOnboardingProgress(account: BachsAccount) {
  if (!account.requirements ||
    !Array.isArray(account.requirements.currently_due) ||
    !Array.isArray(account.requirements.past_due) ||
    !Array.isArray(account.requirements.pending_verification) ||
    ![...account.requirements.currently_due, ...account.requirements.past_due,
      ...account.requirements.pending_verification].every((field) => typeof field === 'string' && field.trim().length > 0)) return null
  const due = new Set([
    ...(account.requirements.currently_due ?? []),
    ...(account.requirements.past_due ?? []),
  ].filter((field): field is string => typeof field === 'string' && field.length > 0))
  const pending = new Set(
    (account.requirements.pending_verification ?? []).filter(
      (field): field is string => typeof field === 'string' && field.length > 0,
    ),
  )
  return { dueCount: due.size, pendingCount: pending.size }
}

export type BachsCheckout = {
  checkout_id: string
  status: string
  amount?: string
  currency?: string
  reference?: string | null
  checkout_url?: string
  payment_status?: string | null
  charge_id?: string | null
}

export type BachsTransfer = {
  id: string
  source?: string
  destination: string
  amount: string
  currency: string
  status: 'pending' | 'paid'
  kind?: 'payout' | 'manual'
  transfer_group?: string | null
  metadata?: Record<string, unknown>
  created_at?: string
}

export type BachsTransfersPage = {
  items: BachsTransfer[]
  total: number
  limit: number
  offset: number
}

export type BachsBalance = {
  currency: string
  available_balance: string
  pending_balance: string
}

export type BachsBalances = {
  account_id: string
  balances: BachsBalance[]
}

export type BachsPayout = {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  amount: string
  currency: string
  destination?: string
  reference?: string
  source_currency: string | null
  fee: string | null
  total_debited: string | null
  created_at?: string | null
}

export class BachsPayoutFeeTopUpMismatchError extends Error {
  constructor(
    readonly payoutId: string,
    readonly expectedTopUpMinor: number,
    readonly actualFeeMinor: number | null,
  ) {
    super('Bachs payout fee does not match the reviewed platform top-up.')
    this.name = 'BachsPayoutFeeTopUpMismatchError'
  }
}

/** Check the actual provider fee; standard-rate documentation is not authority. */
export function assertBachsPayoutFeeMatchesTopUp(
  payout: BachsPayout,
  input: { platformTopUpMinor: number; currency: string },
): void {
  let actualFeeMinor: number | null = null
  try {
    if (payout.fee !== null) actualFeeMinor = bachsAmountMinor(payout.fee, input.currency)
    if (actualFeeMinor === input.platformTopUpMinor && payout.total_debited !== null &&
      payout.source_currency?.toUpperCase() === input.currency.toUpperCase() &&
      bachsAmountMinor(payout.total_debited, input.currency) ===
        bachsAmountMinor(payout.amount, input.currency) + actualFeeMinor) return
  } catch {
    // A malformed fee or total is not evidence that the expected fee applied.
  }
  throw new BachsPayoutFeeTopUpMismatchError(
    payout.id,
    input.platformTopUpMinor,
    actualFeeMinor,
  )
}

export type BachsPayoutDestination = {
  id: string
  type: 'bank_account' | 'mobile_money'
  currency: string
  status?: string
  is_usable: boolean
}

export type BachsPayoutDestinationsPage = {
  destinations: BachsPayoutDestination[]
  total: number
  limit: number
  offset: number
}

export type BachsPayoutsPage = {
  items: BachsPayout[]
  total: number
  limit?: number
  offset?: number
}

export type BachsPayment = {
  payment_id: string
  checkout_id: string | null
  reference: string | null
  status: string
  amount: string
  amount_paid?: string | null
  currency: string
  fees?: { amount: string; currency: string } | null
  fee_paid_by?: string | null
  is_refundable?: boolean
  updated_at?: string | null
  completed_at?: string | null
}

export type BachsRefund = {
  refund_id: string
  charge_id: string
  reference: string
  status: 'processing' | 'success' | 'failed'
  requested_amount: string
  refunded_amount: string | null
  refund_fee_amount?: string
  fee_bearer?: 'org' | 'customer'
}

export type BachsBank = {
  code: string
  name: string
}

export type BachsBankAccountResolution = {
  resolved: boolean
  lookup_supported: boolean
  account_name?: string | null
  bank_id?: string | null
  bank_account_id?: string | null
}

/**
 * Bachs falls back to the platform account country when this query parameter is
 * absent. Drapeon's account currently defaults to US, so the NG scope is
 * deliberately fixed for the only Bachs corridor supported by this release.
 */
export async function listBachsNigerianBanks(
  client: BachsClient,
): Promise<{ country: string; banks: BachsBank[] }> {
  const result = await client.request<{ country: string; banks: BachsBank[] }>({
    method: 'GET',
    path: '/v1/reference/banks?country=NG',
  })
  if (result.country !== 'NG' || !Array.isArray(result.banks)) {
    throw new Error('Bachs returned a bank list for an unexpected country.')
  }
  return result
}

/** Never rely on the Bachs account-country fallback for bank resolution. */
export async function resolveBachsNigerianBankAccount(
  client: BachsClient,
  input: { accountNumber: string; bankCode: string },
): Promise<BachsBankAccountResolution> {
  const identity = new TextEncoder().encode(`NG:${input.bankCode}:${input.accountNumber}`)
  const digest = await crypto.subtle.digest('SHA-256', identity)
  const digestHex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  return await client.request<BachsBankAccountResolution>({
    method: 'POST',
    path: '/v1/misc/bank-accounts/resolve',
    // Provider logs must not receive the bank account number in an idempotency key.
    idempotencyKey: `bank-account-resolve:NG:${digestHex}`,
    body: {
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      country: 'NG',
    },
  })
}

function requireBachsRefundId(value: string): string {
  if (!value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) {
    throw new Error('Bachs returned an invalid refund identifier.')
  }
  return value
}

function requireProviderId(value: string, prefix: string): string {
  if (!value.startsWith(prefix) || value.length <= prefix.length) {
    throw new Error(`Bachs returned an invalid ${prefix.slice(0, -1)} identifier.`)
  }
  return value
}

function requireBachsCheckoutUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.bachs.io')) {
    throw new Error('Bachs returned an unexpected checkout URL.')
  }
  return value
}

/** The route's immutable collector value is set at account creation. */
export async function createBachsRecipientAccount(
  client: BachsClient,
  input: {
    email: string
    displayName: string
    country: string
    feesCollector: BachsFeesCollector
    idempotencyKey: string
  }
): Promise<BachsAccount> {
  const account = await client.request<BachsAccount>({
    method: 'POST',
    path: '/v1/accounts',
    idempotencyKey: input.idempotencyKey,
    body: {
      contact_email: input.email,
      display_name: input.displayName,
      country: input.country,
      configuration: {
        recipient: {
          capabilities: {
            transfers: { requested: true },
            payouts: { requested: true },
          },
        },
      },
      responsibilities: {
        fees: {
          collector: input.feesCollector === 'PLATFORM' ? 'platform' : 'bachs',
        },
      },
    },
  })
  requireProviderId(account.id, 'acct_')
  if (
    account.country !== input.country ||
    account.responsibilities?.fees?.collector !==
      (input.feesCollector === 'PLATFORM' ? 'platform' : 'bachs')
  ) {
    throw new Error('Bachs account does not match the route snapshot.')
  }
  return account
}

export async function getBachsAccount(
  client: BachsClient,
  accountId: string
): Promise<BachsAccount> {
  requireProviderId(accountId, 'acct_')
  const account = await client.request<BachsAccount>({
    method: 'GET',
    path: `/v1/accounts/${encodeURIComponent(accountId)}`,
  })
  if (account.id !== accountId) {
    throw new Error('Bachs returned a different account.')
  }
  return account
}

export async function createBachsOnboardingLink(
  client: BachsClient,
  input: {
    accountId: string
    refreshUrl: string
    returnUrl: string
    idempotencyKey: string
  }
): Promise<{ id: string; account: string; url: string; expires_at: string }> {
  requireProviderId(input.accountId, 'acct_')
  const link = await client.request<{
    id: string
    account: string
    url: string
    expires_at: string
  }>({
    method: 'POST',
    path: `/v1/accounts/${encodeURIComponent(input.accountId)}/account-links`,
    idempotencyKey: input.idempotencyKey,
    body: {
      type: 'onboarding',
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
    },
  })
  requireProviderId(link.id, 'alnk_')
  if (link.account !== input.accountId) {
    throw new Error('Bachs onboarding link returned for another account.')
  }
  const url = new URL(link.url)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.bachs.io')) {
    throw new Error('Bachs returned an unexpected onboarding URL.')
  }
  return link
}

/** A redirect never confirms payment; only signed provider evidence does. */
export async function createBachsCheckout(
  client: BachsClient,
  input: {
    amountMinor: number
    currency: string
    customerEmail: string
    reference: string
    successUrl: string
    cancelUrl: string
    expiresInMinutes: number
    paymentMethodTypes: readonly string[]
    idempotencyKey: string
    metadata?: Record<string, string>
  }
): Promise<BachsCheckout> {
  if (
    !Number.isInteger(input.expiresInMinutes) ||
    input.expiresInMinutes < 1 ||
    input.expiresInMinutes > 1440
  ) {
    throw new Error('Bachs checkout expiry must be between 1 and 1440 minutes.')
  }
  const amount = bachsAmount(input.amountMinor, input.currency)
  if (input.amountMinor <= 0) {
    throw new Error('Bachs checkout amount must be positive.')
  }
  const paymentMethodTypes = [...new Set(input.paymentMethodTypes.map((method) => method.trim().toUpperCase()))]
  if (paymentMethodTypes.length === 0 || paymentMethodTypes.length !== input.paymentMethodTypes.length ||
    paymentMethodTypes.some((method) => method !== 'NGN_CARD')) {
    throw new Error('This Bachs release accepts only the configured refundable card corridor.')
  }
  const checkout = await client.request<BachsCheckout>({
    method: 'POST',
    path: '/v1/checkout-sessions',
    idempotencyKey: input.idempotencyKey,
    body: {
      pricing: { amount, currency: input.currency },
      billing_currency: input.currency,
      customer: { email: input.customerEmail },
      customer_bears_fee: false,
      reference: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_in_minutes: input.expiresInMinutes,
      payment_method_types: paymentMethodTypes,
      metadata: input.metadata ?? {},
    },
  })
  requireProviderId(checkout.checkout_id, 'chk_')
  if (!checkout.checkout_url) {
    throw new Error('Bachs did not return a checkout URL.')
  }
  requireBachsCheckoutUrl(checkout.checkout_url)
  if (checkout.reference != null && checkout.reference !== input.reference) {
    throw new Error('Bachs checkout reference differs from the reserved attempt.')
  }
  if (
    checkout.currency != null &&
    checkout.amount != null &&
    (checkout.currency !== input.currency ||
      bachsAmountMinor(checkout.amount, checkout.currency) !== input.amountMinor)
  ) {
    throw new Error('Bachs checkout amount or currency differs from the accepted total.')
  }
  return checkout
}

export async function getBachsCheckout(
  client: BachsClient,
  checkoutId: string
): Promise<BachsCheckout> {
  requireProviderId(checkoutId, 'chk_')
  const checkout = await client.request<BachsCheckout>({
    method: 'GET',
    path: `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`,
  })
  if (checkout.checkout_id !== checkoutId) {
    throw new Error('Bachs returned a different checkout.')
  }
  return checkout
}

export async function getBachsPayment(
  client: BachsClient,
  chargeId: string
): Promise<BachsPayment> {
  requireProviderId(chargeId, 'ch_')
  const payment = await client.request<BachsPayment>({
    method: 'GET',
    path: `/v1/payments/${encodeURIComponent(chargeId)}`,
  })
  if (payment.payment_id !== chargeId) {
    throw new Error('Bachs returned a different charge.')
  }
  return payment
}

/** Bachs allows one non-failed refund per charge; callers must reserve it first. */
export async function createBachsRefund(
  client: BachsClient,
  input: {
    chargeId: string
    amountMinor: number
    currency: string
    reference: string
    idempotencyKey: string
    reason?: string | null
  },
): Promise<BachsRefund> {
  requireProviderId(input.chargeId, 'ch_')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Bachs refund amount must be positive minor units.')
  }
  if (!input.reference.trim() || input.reference.length > 128) {
    throw new Error('Bachs refund reference must be 1–128 characters.')
  }
  const response = await client.request<BachsRefund>({
    method: 'POST',
    path: '/v1/refunds',
    idempotencyKey: input.idempotencyKey,
    body: {
      charge_id: input.chargeId,
      reference: input.reference,
      amount: bachsAmount(input.amountMinor, input.currency),
      fee_bearer: 'org',
      ...(input.reason?.trim() ? { reason: input.reason.trim().slice(0, 300) } : {}),
      idempotency_key: input.idempotencyKey,
    },
  })
  requireBachsRefundId(response.refund_id)
  if (
    response.charge_id !== input.chargeId ||
    response.reference !== input.reference ||
    bachsAmountMinor(response.requested_amount, input.currency) !== input.amountMinor ||
    !['processing', 'success', 'failed'].includes(response.status)
  ) {
    throw new Error('Bachs refund response does not match the reserved refund claim.')
  }
  return response
}

/** Recover an uncertain refund by its one-refund-per-charge provider lookup. */
export async function getBachsRefundByCharge(
  client: BachsClient,
  chargeId: string,
): Promise<BachsRefund> {
  requireProviderId(chargeId, 'ch_')
  const refund = await client.request<BachsRefund>({
    method: 'GET',
    path: `/v1/refunds/by-charge/${encodeURIComponent(chargeId)}`,
  })
  requireBachsRefundId(refund.refund_id)
  if (refund.charge_id !== chargeId) {
    throw new Error('Bachs refund lookup returned a different charge.')
  }
  if (!['processing', 'success', 'failed'].includes(refund.status)) {
    throw new Error('Bachs refund lookup returned an unknown status.')
  }
  return refund
}

export async function getBachsWebhookEvent(
  client: BachsClient,
  eventId: string
): Promise<{
  event_id: string
  event_type: string
  payload: Record<string, unknown>
}> {
  requireProviderId(eventId, 'evt_')
  const event = await client.request<{
    event_id: string
    event_type: string
    payload: Record<string, unknown>
  }>({
    method: 'GET',
    path: `/v1/webhooks/events/${encodeURIComponent(eventId)}`,
  })
  if (
    event.event_id !== eventId ||
    !event.payload ||
    typeof event.payload !== 'object' ||
    event.payload.id !== eventId ||
    event.payload.type !== event.event_type
  ) {
    throw new Error('Bachs returned a mismatched webhook event.')
  }
  return event
}

export async function createBachsTransfer(
  client: BachsClient,
  input: {
    destinationAccountId: string
    amountMinor: number
    currency: string
    transferGroup: string
    description: string
    metadata?: Record<string, string>
    idempotencyKey: string
  }
): Promise<BachsTransfer> {
  requireProviderId(input.destinationAccountId, 'acct_')
  if (input.amountMinor <= 0) {
    throw new Error('Bachs transfer amount must be positive.')
  }
  const transfer = await client.request<BachsTransfer>({
    method: 'POST',
    path: '/v1/transfers',
    idempotencyKey: input.idempotencyKey,
    body: {
      destination: input.destinationAccountId,
      amount: bachsAmount(input.amountMinor, input.currency),
      currency: input.currency,
      transfer_group: input.transferGroup,
      description: input.description,
      metadata: input.metadata ?? {},
    },
  })
  requireProviderId(transfer.id, 'tr_')
  if (
    transfer.destination !== input.destinationAccountId ||
    transfer.currency !== input.currency ||
    bachsAmountMinor(transfer.amount, transfer.currency) !== input.amountMinor ||
    transfer.transfer_group !== input.transferGroup
    || (input.metadata && Object.entries(input.metadata).some(([key, value]) => transfer.metadata?.[key] !== value))
  ) {
    throw new Error('Bachs transfer does not match the payout claim.')
  }
  if (transfer.status !== 'pending' && transfer.status !== 'paid') {
    throw new Error('Bachs transfer returned an unknown status.')
  }
  return transfer
}

/** Recover a pre-withdrawal refund share from a connected account to platform. */
export async function createBachsRefundRecoveryTransfer(
  client: BachsClient,
  input: {
    sourceAccountId: string
    amountMinor: number
    currency: string
    transferGroup: string
    description: string
    metadata: Record<string, string>
    idempotencyKey: string
  },
): Promise<BachsTransfer> {
  requireProviderId(input.sourceAccountId, 'acct_')
  const currency = input.currency.trim().toUpperCase()
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
    !/^[A-Z]{3}$/u.test(currency) || !input.transferGroup.trim() ||
    !input.description.trim() || input.description.length > 120 ||
    !input.idempotencyKey.trim() || input.idempotencyKey.length > 255) {
    throw new Error('Bachs refund-recovery transfer identity is invalid.')
  }

  // A recovery transfer is allowed only from the account's currently available
  // balance. Pending funds and balances already withdrawn cannot be recovered.
  const balances = await getBachsBalances(client, input.sourceAccountId)
  assertBachsTransferBalance(balances, { amountMinor: input.amountMinor, currency })

  const transfer = await client.request<BachsTransfer>({
    method: 'POST',
    path: '/v1/transfers',
    idempotencyKey: input.idempotencyKey,
    accountId: input.sourceAccountId,
    body: {
      destination: 'self',
      amount: bachsAmount(input.amountMinor, currency),
      currency,
      transfer_group: input.transferGroup,
      description: input.description,
      metadata: input.metadata,
    },
  })
  requireProviderId(transfer.id, 'tr_')
  if (transfer.destination !== 'self' || transfer.currency.toUpperCase() !== currency ||
    bachsAmountMinor(transfer.amount, currency) !== input.amountMinor ||
    transfer.transfer_group !== input.transferGroup ||
    Object.entries(input.metadata).some(([key, value]) => transfer.metadata?.[key] !== value) ||
    !['pending', 'paid'].includes(transfer.status)) {
    throw new Error('Bachs refund-recovery transfer does not match its reviewed request.')
  }
  return transfer
}

/** List one bounded Bachs transfer page for exact claim-identity recovery. */
export async function listBachsTransfers(
  client: BachsClient,
  input: { limit: number; offset: number; connectedAccountId: string },
): Promise<BachsTransfersPage> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100
    || !Number.isSafeInteger(input.offset) || input.offset < 0) {
    throw new Error('Bachs transfer list pagination is invalid.')
  }
  requireProviderId(input.connectedAccountId, 'acct_')
  const query = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
    connected_account_id: input.connectedAccountId,
  })
  const page = await client.request<BachsTransfersPage>({
    method: 'GET',
    path: `/v1/transfers?${query.toString()}`,
  })
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total)
    || !Number.isSafeInteger(page.limit) || !Number.isSafeInteger(page.offset)
    || page.total < 0 || page.limit !== input.limit || page.offset !== input.offset
    || page.items.length > input.limit) {
    throw new Error('Bachs returned an invalid transfer-list page.')
  }
  return page
}

/**
 * Find one refund-recovery transfer by its immutable claim, attempt and Money
 * Desk identity. A bounded or ambiguous list is never treated as permission to
 * create a second transfer.
 */
export async function findBachsRefundRecoveryTransfer(
  client: BachsClient,
  input: {
    connectedAccountId: string
    transferGroup: string
    metadata: Record<string, string>
    expectedAmountMinor: number
    currency: string
    expectedTransferId?: string | null
  },
): Promise<{ kind: 'FOUND'; transfer: BachsTransfer } | { kind: 'NOT_FOUND' | 'AMBIGUOUS' | 'INCOMPLETE' }> {
  if (!Number.isSafeInteger(input.expectedAmountMinor) || input.expectedAmountMinor <= 0 ||
    !/^[A-Z]{3}$/u.test(input.currency.trim().toUpperCase())) {
    throw new Error('Bachs refund-recovery lookup identity is invalid.')
  }
  const pageSize = 100
  const maxItems = 1_000
  const matches: BachsTransfer[] = []
  let identityConflict = false
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total && offset < maxItems) {
    const page = await listBachsTransfers(client, {
      limit: pageSize,
      offset,
      connectedAccountId: input.connectedAccountId,
    })
    total = page.total
    for (const transfer of page.items) {
      if (input.expectedTransferId && transfer.id !== input.expectedTransferId) continue
      const metadataMatches = Object.entries(input.metadata)
        .every(([key, value]) => transfer.metadata?.[key] === value)
      const identityMatches = transfer.destination === 'self' &&
        transfer.transfer_group === input.transferGroup && metadataMatches
      if (identityMatches) {
        try {
          if (transfer.currency.toUpperCase() === input.currency.trim().toUpperCase() &&
            bachsAmountMinor(transfer.amount, input.currency) === input.expectedAmountMinor &&
            ['pending', 'paid'].includes(transfer.status)) {
            matches.push(transfer)
          } else {
            identityConflict = true
          }
        } catch {
          identityConflict = true
        }
      } else if (input.expectedTransferId && transfer.id === input.expectedTransferId) {
        identityConflict = true
      }
    }
    if (page.items.length === 0) break
    offset += page.items.length
  }
  if (identityConflict || matches.length > 1) return { kind: 'AMBIGUOUS' }
  if (total > offset) return { kind: 'INCOMPLETE' }
  return matches.length === 1
    ? { kind: 'FOUND', transfer: matches[0] }
    : { kind: 'NOT_FOUND' }
}

/** List one account-scoped withdrawal page for balance reconciliation. */
export async function listBachsPayouts(
  client: BachsClient,
  input: { limit: number; offset: number; accountId: string; reference?: string },
): Promise<BachsPayoutsPage> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100
    || !Number.isSafeInteger(input.offset) || input.offset < 0) {
    throw new Error('Bachs payout list pagination is invalid.')
  }
  requireProviderId(input.accountId, 'acct_')
  const query = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
  })
  if (input.reference?.trim()) query.set('reference', input.reference.trim())
  const page = await client.request<BachsPayoutsPage>({
    method: 'GET',
    path: `/v1/payouts?${query.toString()}`,
    accountId: input.accountId,
  })
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total)
    || page.total < 0 ||
    (page.limit !== undefined && page.limit !== input.limit) ||
    (page.offset !== undefined && page.offset !== input.offset) ||
    page.items.length > input.limit) {
    throw new Error('Bachs returned an invalid payout-list page.')
  }
  // The documented payout-list response omits limit/offset even though they
  // are request parameters; use the request values when the API doesn't echo
  // them, and reject any conflicting echo.
  return { ...page, limit: page.limit ?? input.limit, offset: page.offset ?? input.offset }
}

function requireBachsPayoutId(value: string): string {
  if (!value.trim() || value.length > 200 || /[^A-Za-z0-9_-]/u.test(value)) {
    throw new Error('Bachs returned an invalid payout identifier.')
  }
  return value
}

/** Create a connected account's withdrawal destination using account-scoped access. */
export async function createBachsPayoutDestination(
  client: BachsClient,
  input: {
    accountId: string
    currency: string
    bankCode: string
    accountNumber: string
    idempotencyKey: string
  },
): Promise<BachsPayoutDestination> {
  requireProviderId(input.accountId, 'acct_')
  const currency = input.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency) || !input.bankCode.trim() || !input.accountNumber.trim()) {
    throw new Error('Bachs payout destination details are incomplete.')
  }
  const destination = await client.request<BachsPayoutDestination>({
    method: 'POST',
    path: '/v1/payouts/destinations',
    idempotencyKey: input.idempotencyKey,
    accountId: input.accountId,
    body: {
      type: 'bank_account',
      currency,
      bank_code: input.bankCode,
      account_number: input.accountNumber,
    },
  })
  requireProviderId(destination.id, 'pd_')
  if (destination.currency.toUpperCase() !== currency || destination.type !== 'bank_account' ||
    typeof destination.is_usable !== 'boolean') {
    throw new Error('Bachs payout destination response does not match the request.')
  }
  return destination
}

export async function getBachsPayoutDestination(
  client: BachsClient,
  input: { accountId: string; destinationId: string },
): Promise<BachsPayoutDestination> {
  requireProviderId(input.accountId, 'acct_')
  requireProviderId(input.destinationId, 'pd_')
  const destination = await client.request<BachsPayoutDestination>({
    method: 'GET',
    path: `/v1/payouts/destinations/${encodeURIComponent(input.destinationId)}`,
    accountId: input.accountId,
  })
  if (destination.id !== input.destinationId || typeof destination.is_usable !== 'boolean') {
    throw new Error('Bachs returned a mismatched or incomplete payout destination.')
  }
  return destination
}

/** List withdrawal destinations for one connected account. The provider uses
 * `destinations` (not `items`) for this collection response. */
export async function listBachsPayoutDestinations(
  client: BachsClient,
  input: { accountId: string; limit?: number; offset?: number },
): Promise<BachsPayoutDestinationsPage> {
  requireProviderId(input.accountId, 'acct_')
  const limit = input.limit ?? 100
  const offset = input.offset ?? 0
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Bachs payout destination pagination is invalid.')
  }
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const page = await client.request<BachsPayoutDestinationsPage>({
    method: 'GET',
    path: `/v1/payouts/destinations?${query.toString()}`,
    accountId: input.accountId,
  })
  if (!Array.isArray(page.destinations) || !Number.isSafeInteger(page.total) || page.total < 0 ||
    !Number.isSafeInteger(page.limit) || page.limit !== limit ||
    !Number.isSafeInteger(page.offset) || page.offset !== offset ||
    page.destinations.length > limit) {
    throw new Error('Bachs returned an invalid payout-destination page.')
  }
  for (const destination of page.destinations) {
    requireProviderId(destination.id, 'pd_')
    if (!['bank_account', 'mobile_money'].includes(destination.type) ||
      !/^[A-Z]{3}$/u.test(destination.currency.toUpperCase()) ||
      typeof destination.is_usable !== 'boolean') {
      throw new Error('Bachs returned an invalid payout destination.')
    }
  }
  return page
}

/**
 * Create one connected-account withdrawal. Availability and destination usability
 * are checked immediately beforehand; callers must persist the returned ID before
 * relying on any later webhook or retry.
 */
export async function createBachsPayout(
  client: BachsClient,
  input: {
    accountId: string
    destinationId: string
    amountMinor: number
    currency: string
    reference: string
    narration?: string
    idempotencyKey: string
  },
): Promise<BachsPayout> {
  requireProviderId(input.accountId, 'acct_')
  requireProviderId(input.destinationId, 'pd_')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
    !/^[A-Za-z0-9._-]{1,100}$/u.test(input.reference) ||
    (input.narration !== undefined && (input.narration.length > 100 || /[\r\n]/u.test(input.narration)))) {
    throw new Error('Bachs payout request identity is invalid.')
  }
  const currency = input.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('Bachs payout currency is invalid.')
  const destination = await getBachsPayoutDestination(client, {
    accountId: input.accountId,
    destinationId: input.destinationId,
  })
  if (!destination.is_usable || destination.currency.toUpperCase() !== currency) {
    throw new Error('Bachs payout destination is not usable for this currency.')
  }
  const payout = await client.request<BachsPayout>({
    method: 'POST',
    path: '/v1/payouts',
    idempotencyKey: input.idempotencyKey,
    accountId: input.accountId,
    body: {
      destination: input.destinationId,
      amount: bachsAmount(input.amountMinor, currency),
      reference: input.reference,
      ...(input.narration ? { narration: input.narration } : {}),
    },
  })
  requireBachsPayoutId(payout.id)
  if (payout.currency.toUpperCase() !== currency ||
    bachsAmountMinor(payout.amount, payout.currency) !== input.amountMinor ||
    (payout.destination !== undefined && payout.destination !== input.destinationId) ||
    (payout.reference !== undefined && payout.reference !== input.reference) ||
    !['pending', 'processing', 'completed', 'failed'].includes(payout.status)) {
    throw new Error('Bachs payout response does not match the request.')
  }
  // A pending payout may not have final fee evidence yet. Return its provider
  // ID so the caller can persist it before any reconciliation or retry. A
  // completed payout must carry exact fee and debit evidence.
  if (payout.fee === null || payout.total_debited === null) {
    if (payout.status === 'completed' || payout.fee !== null ||
      payout.total_debited !== null) {
      throw new Error('Bachs payout returned incomplete fee evidence.')
    }
  } else {
    if (payout.source_currency?.toUpperCase() !== currency) {
      throw new Error('Bachs payout source currency does not match.')
    }
    const feeMinor = bachsAmountMinor(payout.fee, currency)
    const totalDebitedMinor = bachsAmountMinor(payout.total_debited, currency)
    if (totalDebitedMinor !== input.amountMinor + feeMinor) {
      throw new Error('Bachs payout fee and total debit do not reconcile.')
    }
  }
  return payout
}

export async function getBachsPayout(
  client: BachsClient,
  input: { accountId: string; payoutId: string },
): Promise<BachsPayout> {
  requireProviderId(input.accountId, 'acct_')
  requireBachsPayoutId(input.payoutId)
  const payout = await client.request<BachsPayout>({
    method: 'GET',
    path: `/v1/payouts/${encodeURIComponent(input.payoutId)}`,
    accountId: input.accountId,
  })
  if (payout.id !== input.payoutId ||
    !['pending', 'processing', 'completed', 'failed'].includes(payout.status)) {
    throw new Error('Bachs returned a mismatched payout.')
  }
  return payout
}

export async function getBachsTransfer(
  client: BachsClient,
  transferId: string
): Promise<BachsTransfer> {
  requireProviderId(transferId, 'tr_')
  const transfer = await client.request<BachsTransfer>({
    method: 'GET',
    path: `/v1/transfers/${encodeURIComponent(transferId)}`,
  })
  if (transfer.id !== transferId) {
    throw new Error('Bachs returned a different transfer.')
  }
  if (transfer.status !== 'pending' && transfer.status !== 'paid') {
    throw new Error('Bachs transfer returned an unknown status.')
  }
  return transfer
}

/** Read platform balances before creating a transfer; pending funds are not movable. */
export async function getBachsBalances(
  client: BachsClient,
  accountId?: string,
): Promise<BachsBalances> {
  if (accountId) requireProviderId(accountId, 'acct_')
  const result = await client.request<BachsBalances>({
    method: 'GET',
    path: '/v1/balances',
    ...(accountId ? { accountId } : {}),
  })
  if (!result.account_id || !Array.isArray(result.balances)
    || (accountId && result.account_id !== accountId)) {
    throw new Error('Bachs returned invalid platform balance data.')
  }
  for (const balance of result.balances) {
    if (
      typeof balance.currency !== 'string' ||
      typeof balance.available_balance !== 'string' ||
      typeof balance.pending_balance !== 'string'
    ) {
      throw new Error('Bachs returned an invalid currency balance.')
    }
    // Parse both values through the shared currency-aware money-unit conversion.
    bachsBalanceAmountMinor(balance.available_balance, balance.currency)
    bachsBalanceAmountMinor(balance.pending_balance, balance.currency)
  }
  return result
}

/**
 * Fail closed on a negative balance in any currency: Bachs blocks all outbound
 * transfers while the platform is in debt, even when this transfer's currency
 * itself has funds. Pending settlement is never eligible for transfer.
 */
export function assertBachsTransferBalance(
  balances: BachsBalances,
  input: { amountMinor: number; currency: string },
): void {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Bachs transfer amount must be positive minor units.')
  }
  const parsed = balances.balances.map((balance) => ({
    currency: balance.currency,
    available: bachsBalanceAmountMinor(balance.available_balance, balance.currency),
  }))
  if (parsed.some((balance) => balance.available < 0)) {
    throw new Error('Bachs platform has a negative balance; transfers are blocked.')
  }
  const currencyBalance = parsed.find((balance) => balance.currency === input.currency)
  if (!currencyBalance || currencyBalance.available < input.amountMinor) {
    throw new Error('Bachs available balance is insufficient for this transfer.')
  }
}
