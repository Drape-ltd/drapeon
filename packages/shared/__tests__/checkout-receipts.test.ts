import {
  initialOrderReceiptLines,
  receiptFulfillmentLine,
  receiptStatusForRefund,
  validateInitialOrderReceipt,
  type InitialOrderReceipt,
} from '../src/checkout-receipts'

const receipt: InitialOrderReceipt = {
  receiptNumber: 'DRP-2026-000001',
  orderId: 'order-1',
  orderReference: 'DRP2BBQUE',
  paymentId: 'payment-1',
  provider: 'STRIPE',
  providerReference: 'pi_123',
  status: 'PAID',
  paidAt: '2026-07-31T12:00:00.000Z',
  pricingVersion: 1,
  policyVersion: 'commercial-2026-07-31-v1',
  correlationId: 'correlation-1',
  breakdown: {
    currency: 'USD',
    subtotalAmount: 10_000,
    platformFeeAmount: 500,
    taxAmount: 800,
    shippingAmount: 1_200,
    promotionAmount: 0,
    totalAmount: 12_500,
    taxJurisdiction: 'Illinois',
    taxSource: 'ZIPTAX',
    taxFallback: false,
  },
  consultationCreditAmount: 0,
  promotionAmount: 0,
  refundedAmount: 0,
}

describe('initial-order receipts', () => {
  it('validates an immutable exact-money receipt', () => {
    expect(validateInitialOrderReceipt(receipt)).toEqual(receipt)
  })

  it('rejects reconstructed or over-refunded receipts', () => {
    expect(() => validateInitialOrderReceipt({ ...receipt, receiptNumber: '123' })).toThrow(/Drapeon receipt/u)
    expect(() => validateInitialOrderReceipt({ ...receipt, refundedAmount: 12_501 })).toThrow(/captured total/u)
  })

  it('derives refund status from captured and refunded values', () => {
    expect(receiptStatusForRefund({ totalAmount: 12_500, refundedAmount: 0 })).toBe('PAID')
    expect(receiptStatusForRefund({ totalAmount: 12_500, refundedAmount: 500 })).toBe('PARTIALLY_REFUNDED')
    expect(receiptStatusForRefund({ totalAmount: 12_500, refundedAmount: 12_500 })).toBe('REFUNDED')
  })

  it('renders the authoritative customer-facing allocation', () => {
    expect(initialOrderReceiptLines(receipt)).toEqual(expect.arrayContaining([
      { key: 'subtotal', label: 'Tailor work and included materials', amount: 10_000 },
      { key: 'tax', label: 'Illinois', amount: 800 },
      { key: 'total', label: 'Total paid', amount: 12_500 },
    ]))
  })

  it('labels a ready-made purchase as an item subtotal across receipt surfaces', () => {
    const lines = initialOrderReceiptLines({ ...receipt, orderKind: 'READY_MADE' })
    expect(lines).toContainEqual({ key: 'subtotal', label: 'Item subtotal', amount: 10_000 })
    expect(lines).toContainEqual({ key: 'fulfillment', label: 'Fulfillment', amount: 1_200 })
    expect(lines).not.toContainEqual({ key: 'subtotal', label: 'Tailor work and included materials', amount: 10_000 })
  })

  it('keeps free fulfillment visible on a Nigerian ready-made receipt', () => {
    const lines = initialOrderReceiptLines({
      ...receipt,
      orderKind: 'READY_MADE',
      breakdown: {
        ...receipt.breakdown,
        currency: 'NGN',
        subtotalAmount: 10_000,
        platformFeeAmount: 215,
        shippingAmount: 0,
        taxAmount: 750,
        taxJurisdiction: 'Nigeria VAT',
        totalAmount: 10_965,
      },
    })
    expect(receiptFulfillmentLine(0)).toEqual({ label: 'Fulfillment', amount: 0, free: true })
    expect(lines.filter((line) => line.key === 'fulfillment')).toEqual([
      { key: 'fulfillment', label: 'Fulfillment', amount: 0 },
    ])
    expect(lines).toEqual(expect.arrayContaining([
      { key: 'fulfillment', label: 'Fulfillment', amount: 0 },
      { key: 'tax', label: 'Nigeria VAT', amount: 750 },
      { key: 'total', label: 'Total paid', amount: 10_965 },
    ]))
  })

  it('uses the locked charge provider for the processing-fee label', () => {
    const lines = initialOrderReceiptLines({
      breakdown: { ...receipt.breakdown, platformFeeAmount: 200 },
      consultationCreditAmount: 0,
      promotionAmount: 0,
      provider: 'COVERAGE',
      chargeProviderSnapshot: 'BACHS',
    })
    expect(lines).toContainEqual({ key: 'platform-fee', label: 'Payment processing', amount: 200 })
  })

  it('keeps a benefit-backed Bachs receipt at the captured ₦51,200 total', () => {
    const lines = initialOrderReceiptLines({
      ...receipt,
      provider: 'BACHS',
      chargeProviderSnapshot: 'BACHS',
      breakdown: {
        ...receipt.breakdown,
        currency: 'NGN',
        subtotalAmount: 60_000,
        platformFeeAmount: 1_200,
        promotionAmount: 10_000,
        totalAmount: 51_200,
      },
      promotionAmount: 10_000,
    })

    expect(lines).toEqual(
      expect.arrayContaining([
        { key: 'promotion', label: 'Drapeon-funded benefit', amount: -10_000 },
        { key: 'platform-fee', label: 'Payment processing', amount: 1_200 },
        { key: 'total', label: 'Total paid', amount: 51_200 },
      ])
    )
  })

  it('shows gross work value before subtracting a credited consultation', () => {
    const lines = initialOrderReceiptLines({
      breakdown: receipt.breakdown,
      consultationCreditAmount: 1_500,
      promotionAmount: 500,
    })
    expect(lines).toEqual(expect.arrayContaining([
      { key: 'subtotal', label: 'Tailor work and included materials', amount: 11_500 },
      { key: 'consultation-credit', label: 'Consultation fee credit', amount: -1_500 },
      { key: 'promotion', label: 'Drapeon-funded benefit', amount: -500 },
    ]))
  })

  it('keeps tailoring and protected fabric separate on funded-policy receipts', () => {
    const lines = initialOrderReceiptLines({
      breakdown: {
        ...receipt.breakdown,
        fabricFundingPolicyVersion: 'fabric-funding-2026-08-01-v1',
        fabricSource: 'TAILOR_SOURCES',
        tailoringAmount: 7_500,
        fabricAllowanceAmount: 2_500,
        fabricAllowanceCoverage: ['FABRIC', 'LINING'],
        fabricSourcingAssumptions: 'Six yards of cotton and a matching lining.',
      },
      consultationCreditAmount: 1_500,
      promotionAmount: 0,
    })
    expect(lines).toEqual(expect.arrayContaining([
      { key: 'tailoring', label: 'Tailoring and construction', amount: 9_000 },
      { key: 'fabric-allowance', label: 'Protected fabric allowance', amount: 2_500 },
      { key: 'consultation-credit', label: 'Consultation fee credit', amount: -1_500 },
    ]))
  })
})
