import { derivePayoutDeliveryState, payoutDeliveryLabel } from '../src/provider-settlement'

describe('provider settlement state', () => {
  it('does not call a Stripe transfer bank-paid', () => {
    const state = derivePayoutDeliveryState({
      provider: 'STRIPE',
      status: 'PROCESSING',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: 'PENDING',
    })
    expect(state).toBe('IN_PROVIDER_BALANCE')
    expect(payoutDeliveryLabel(state, 'STRIPE')).toBe('In Stripe balance')
  })

  it('keeps Stripe bank withdrawal movement separate from individual earning status', () => {
    expect(derivePayoutDeliveryState({
      provider: 'STRIPE',
      status: 'PROCESSING',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: 'IN_TRANSIT',
    })).toBe('IN_PROVIDER_BALANCE')
  })

  it('does not mark an individual Stripe earning paid to bank from account withdrawal evidence', () => {
    expect(derivePayoutDeliveryState({
      provider: 'STRIPE',
      status: 'PAID',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: 'PAID',
    })).toBe('IN_PROVIDER_BALANCE')
  })

  it('shows a failed account withdrawal as returned to the provider balance, not a failed earning transfer', () => {
    expect(derivePayoutDeliveryState({
      provider: 'STRIPE',
      status: 'FAILED',
      providerTransferStatus: 'PAID_TO_BANK',
      bankSettlementStatus: 'FAILED',
    })).toBe('IN_PROVIDER_BALANCE')
  })

  it('preserves Paystack terminal transfer semantics', () => {
    expect(derivePayoutDeliveryState({ provider: 'PAYSTACK', status: 'PAID' })).toBe('PAID_TO_BANK')
  })

  it('treats a paid Bachs transfer as available in the connected balance', () => {
    const state = derivePayoutDeliveryState({ provider: 'BACHS', status: 'PAID' })
    expect(state).toBe('IN_PROVIDER_BALANCE')
    expect(payoutDeliveryLabel(state, 'BACHS')).toBe('In Bachs balance')
  })

  it('does not attribute a Bachs account withdrawal to one earning', () => {
    expect(derivePayoutDeliveryState({
      provider: 'BACHS',
      status: 'PAID',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: 'PAID',
    })).toBe('IN_PROVIDER_BALANCE')
  })

  it('keeps failures and reversals terminal', () => {
    expect(derivePayoutDeliveryState({ provider: 'STRIPE', status: 'PROCESSING', providerTransferStatus: 'FAILED', bankSettlementStatus: 'FAILED' })).toBe('FAILED')
    expect(derivePayoutDeliveryState({ provider: 'STRIPE', status: 'PAID', providerTransferStatus: 'REVERSED' })).toBe('REVERSED')
  })
})
