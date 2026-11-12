import {
  PAYOUT_BLOCKED_REASONS,
  type PayoutBlockedReason,
  payoutBlockReasonMessage,
  payoutBlockRecovery,
} from '../src/payout-gating'

describe('payout blocker recovery copy', () => {
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

  it('gives an unknown provider failure a safe Ops recovery instead of crashing', () => {
    const recovery = payoutBlockRecovery('SOME_NEW_PROVIDER_CODE' as PayoutBlockedReason)

    expect(recovery.destination).toBe('EARNINGS')
    expect(recovery.nextStep).toContain('Ops')
    expect(recovery.nextStep).not.toContain('SOME_NEW_PROVIDER_CODE')
    expect(recovery.userActionRequired).toBe(false)
  })

  it('explains a transfer-not-found record without asking the tailor to retry', () => {
    const recovery = payoutBlockRecovery('TRANSFER_NOT_FOUND' as PayoutBlockedReason)

    expect(recovery.reason).toContain('provider')
    expect(recovery.nextStep).toContain('reconcil')
    expect(recovery.userActionRequired).toBe(false)
  })

})
