import { isBachsPaymentPhaseAvailable } from '../src/bachs-payment-phase'

describe('Bachs payment phase availability', () => {
  it('allows only phases with complete collection, refund, and release paths', () => {
    expect(isBachsPaymentPhaseAvailable('INITIAL_ORDER')).toBe(true)
    expect(isBachsPaymentPhaseAvailable('FULFILLMENT')).toBe(true)
    for (const phase of ['CONSULTATION', 'MATERIAL_ADVANCE', 'TIP', 'ADJUSTMENT', 'UNKNOWN']) {
      expect(isBachsPaymentPhaseAvailable(phase)).toBe(false)
    }
  })
})
