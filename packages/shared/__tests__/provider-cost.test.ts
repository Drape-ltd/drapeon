import {
  BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
  customerFeeLineLabel,
  initialOrderPromotionCustomerDue,
  quoteBachsNgnCardProviderCost,
} from '../src/provider-cost'
import { buildCaptureLedgerInstructions, buildRefundLedgerInstructions } from '../src/commercial-pricing'

describe('Bachs NGN card provider cost', () => {
  it('locks a separate 2% customer cost without calling it Drapeon revenue', () => {
    expect(quoteBachsNgnCardProviderCost({
      scheduleVersion: BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
      baseAmount: 50_000,
    })).toEqual({
      scheduleVersion: BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
      provider: 'BACHS',
      paymentMethod: 'CARD',
      currency: 'NGN',
      basisPoints: 200,
      baseAmount: 50_000,
      providerCostAmount: 1_000,
      customerTotalAmount: 51_000,
      disclosureLabel: 'Payment processing',
    })
  })

  it('rounds the disclosed cost half-up in minor units', () => {
    expect(quoteBachsNgnCardProviderCost({
      scheduleVersion: BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
      baseAmount: 25,
    }).providerCostAmount).toBe(1)
    expect(quoteBachsNgnCardProviderCost({
      scheduleVersion: BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
      baseAmount: 24,
    }).providerCostAmount).toBe(0)
  })

  it('rejects unknown schedules and unsafe money values', () => {
    expect(() => quoteBachsNgnCardProviderCost({ scheduleVersion: 'future', baseAmount: 50_000 })).toThrow(
      'schedule is unsupported',
    )
    expect(() => quoteBachsNgnCardProviderCost({
      scheduleVersion: BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
      baseAmount: -1,
    })).toThrow('non-negative safe integer')
    expect(() => quoteBachsNgnCardProviderCost({
      scheduleVersion: BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
      baseAmount: Number.MAX_SAFE_INTEGER,
    })).toThrow('exceeds safe minor-unit bounds')
  })

  it('never presents Bachs provider-cost recovery as Drapeon commission', () => {
    expect(customerFeeLineLabel('BACHS')).toBe('Payment processing')
    expect(customerFeeLineLabel('STRIPE')).toBe('Drapeon service fee')
  })

  it('keeps the locked provider cost on a custom promotional retry but not twice on ready-made', () => {
    expect(initialOrderPromotionCustomerDue({
      customerDueAmount: 9_000,
      orderKind: 'CUSTOM',
      acceptedRouteSnapshotAt: '2026-11-16T12:00:00.000Z',
      chargeProviderSnapshot: 'BACHS',
      lockedProviderCostAmount: 200,
    })).toBe(9_200)
    expect(initialOrderPromotionCustomerDue({
      customerDueAmount: 9_200,
      orderKind: 'READY_MADE',
      acceptedRouteSnapshotAt: '2026-11-16T12:00:00.000Z',
      chargeProviderSnapshot: 'BACHS',
      lockedProviderCostAmount: 200,
    })).toBe(9_200)
  })

  it('keeps the accepted tailor earning unchanged when a promotion and provider cost coexist', () => {
    const entries = buildCaptureLedgerInstructions({
      phase: 'INITIAL_ORDER',
      paymentAmount: 46_000,
      pricing: {
        currency: 'NGN',
        subtotalAmount: 50_000,
        platformFeeAmount: 1_000,
        taxAmount: 0,
        shippingAmount: 0,
        promotionAmount: 5_000,
        totalAmount: 46_000,
        taxJurisdiction: null,
        taxSource: 'NOT_APPLICABLE',
        taxFallback: false,
      },
    })

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAILOR_ENTITLEMENT', amount: 50_000, direction: 'CREDIT' }),
      expect.objectContaining({ accountCode: 'DRAPEON_REVENUE', amount: 1_000, direction: 'CREDIT' }),
      expect.objectContaining({ accountCode: 'DRAPEON_SUBSIDY_EXPENSE', amount: 5_000, direction: 'DEBIT' }),
    ]))
    expect(entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amount, 0))
      .toBe(entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0))
  })

  it('refunds the charged total while reversing the provider cost separately from the earning', () => {
    const captureEntries = buildCaptureLedgerInstructions({
      phase: 'INITIAL_ORDER',
      paymentAmount: 10_200,
      pricing: {
        currency: 'NGN',
        subtotalAmount: 10_000,
        platformFeeAmount: 200,
        taxAmount: 0,
        shippingAmount: 0,
        totalAmount: 10_200,
        taxJurisdiction: null,
        taxSource: 'NOT_APPLICABLE',
        taxFallback: false,
      },
    })
    const refundEntries = buildRefundLedgerInstructions({
      refundAmount: 10_200,
      captureEntries,
    })

    expect(refundEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAILOR_ENTITLEMENT', direction: 'DEBIT', amount: 10_000 }),
      expect.objectContaining({ accountCode: 'DRAPEON_REVENUE', direction: 'DEBIT', amount: 200 }),
      expect.objectContaining({ accountCode: 'PROVIDER_CLEARING', direction: 'CREDIT', amount: 10_200 }),
    ]))
  })
})

