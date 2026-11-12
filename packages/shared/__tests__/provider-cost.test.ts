import {
  BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
  quoteBachsNgnCardProviderCost,
} from '../src/provider-cost'

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
})

