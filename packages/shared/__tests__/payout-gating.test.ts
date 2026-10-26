import {
  PAYOUT_BLOCKED_REASONS,
  payoutBlockReasonMessage,
  payoutBlockRecovery,
  resolvePayoutMoney,
} from '../src/payout-gating'

describe('payout blocker recovery copy', () => {
  it('requires an explicitly stored payout provider instead of inferring from currency', () => {
    expect(resolvePayoutMoney(
      { currency: 'NGN', source_amount: 50_000 },
      { payout_currency: 'NGN' },
    )).toEqual({ blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_PROVIDER_UNAVAILABLE })
    expect(resolvePayoutMoney(
      { currency: 'NGN', source_amount: 50_000, tailor_payout_provider_locked: 'PAYSTACK' },
      { payout_currency: 'NGN', payout_provider: 'PAYSTACK' },
    )).toEqual({ amount: 50_000, currency: 'NGN', provider: 'PAYSTACK' })
  })

  it('does not tell a partially refunded order to repeat handoff', () => {
    const recovery = payoutBlockRecovery(PAYOUT_BLOCKED_REASONS.PAYMENT_ALREADY_REFUNDED)

    expect(recovery.headline).toBe('Order settlement decision needed')
    expect(recovery.reason).toContain('remaining protected balance')
    expect(recovery.nextStep).toContain('No handoff or payout-account change is required')
    expect(recovery.destination).toBe('OPS_REVIEW')
    expect(recovery.userActionRequired).toBe(false)
  })

  it('keeps an incomplete handoff actionable in the order', () => {
    const recovery = payoutBlockRecovery(PAYOUT_BLOCKED_REASONS.HANDOFF_NOT_COMPLETED)

    expect(recovery.headline).toBe('Handoff confirmation needed')
    expect(recovery.ctaLabel).toBe('Complete handoff')
    expect(recovery.destination).toBe('ORDER')
    expect(recovery.userActionRequired).toBe(true)
  })

  it('makes provider outages an automatic recovery rather than an account change', () => {
    const recovery = payoutBlockRecovery(PAYOUT_BLOCKED_REASONS.PAYOUT_PROVIDER_UNAVAILABLE)

    expect(recovery.nextStep).toContain('Do not change your bank details')
    expect(recovery.destination).toBe('EARNINGS')
    expect(recovery.userActionRequired).toBe(false)
  })

  it('keeps the legacy reason helper aligned with the recovery contract', () => {
    const reason = PAYOUT_BLOCKED_REASONS.CUSTOMER_CONFIRMATION_REQUIRED

    expect(payoutBlockReasonMessage(reason)).toBe(payoutBlockRecovery(reason).reason)
  })
})
