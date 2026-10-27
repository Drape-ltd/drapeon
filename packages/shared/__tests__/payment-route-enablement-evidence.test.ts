import { buildPaymentRouteEnablementEvidence } from '../src/payment-route-enablement-evidence'

const required = {
  collection: 'collection-run-1',
  settlement: 'settlement-run-1',
  transfer: 'transfer-run-1',
  tailorWithdrawal: 'withdrawal-run-1',
  customerFeeDisclosure: 'checkout-fee-disclosure-run-1',
  settlementFeeReconciliation: 'settled-net-reconciliation-run-1',
}

describe('payment route enablement evidence', () => {
  it('requires fee disclosure and settled-net proof for Stripe approvals', () => {
    expect(buildPaymentRouteEnablementEvidence('STRIPE', required)).toEqual({
      collection: required.collection,
      settlement: required.settlement,
      transfer: required.transfer,
      tailor_withdrawal: required.tailorWithdrawal,
      customer_fee_disclosure: required.customerFeeDisclosure,
      settlement_fee_reconciliation: required.settlementFeeReconciliation,
    })
    expect(buildPaymentRouteEnablementEvidence('STRIPE', {
      ...required,
      settlementFeeReconciliation: '  ',
    })).toBeNull()
  })

  it('requires written provider confirmation for Bachs and normalizes references', () => {
    expect(buildPaymentRouteEnablementEvidence('BACHS', {
      ...required,
      collection: '  collection-run-1  ',
      providerConfirmation: '  bachs-email-thread-42  ',
    })).toMatchObject({
      collection: 'collection-run-1',
      provider_confirmation: 'bachs-email-thread-42',
    })
    expect(buildPaymentRouteEnablementEvidence('BACHS', required)).toBeNull()
  })

  it('rejects empty, non-string, and oversized evidence references', () => {
    expect(buildPaymentRouteEnablementEvidence('STRIPE', {
      ...required,
      customerFeeDisclosure: 44,
    })).toBeNull()
    expect(buildPaymentRouteEnablementEvidence('STRIPE', {
      ...required,
      customerFeeDisclosure: 'x'.repeat(501),
    })).toBeNull()
  })
})
