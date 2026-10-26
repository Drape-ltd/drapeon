import {
  isLegacyPayoutSetupCurrency,
  LEGACY_PAYOUT_SETUP_COMING_SOON_COPY,
  MANUAL_BANK_ENTRY_NOTE,
  MANUAL_BANK_VALIDATION,
  normalizeSwiftBic,
  payoutProviderLabelFromSavedIdentity,
  payoutBankLogoUrl,
  tailorPayoutSetupCopy,
  validateManualBankEntry,
} from '../src/payout-setup'

describe('manual bank entry validation', () => {
  it('keeps the customer-facing manual verification note exact', () => {
    expect(MANUAL_BANK_ENTRY_NOTE).toBe(
      'Manual bank details require verification before your first payout. This usually takes 1-2 business days.',
    )
  })

  it('normalizes SWIFT / BIC codes before validation', () => {
    expect(normalizeSwiftBic('  deut de ff 500 ')).toBe('DEUTDEFF500')
  })

  it('returns bank logo URLs for known payout banks and null otherwise', () => {
    expect(payoutBankLogoUrl('Guaranty Trust Bank')).toBe('https://logo.clearbit.com/gtbank.com')
    expect(payoutBankLogoUrl('A small regional bank')).toBeNull()
  })

  it('accepts valid 8 and 11 character SWIFT / BIC codes', () => {
    expect(validateManualBankEntry({
      payoutCurrency: 'NGN',
      bankName: 'Regional Trust Bank',
      bankCountryCode: 'NG',
      swiftBic: 'FBNINGLA',
      accountNumber: '1234567890',
      accountName: 'Amara Atelier',
    }).ok).toBe(true)

    expect(validateManualBankEntry({
      payoutCurrency: 'GBP',
      bankName: 'International Tailor Bank',
      bankCountryCode: 'GB',
      swiftBic: 'BARCGB22XXX',
      accountNumber: 'GB82WEST12345698765432',
      accountName: 'Amara Atelier',
    }).ok).toBe(true)
  })

  it('rejects incomplete manual bank submissions with field-specific errors', () => {
    const result = validateManualBankEntry({
      payoutCurrency: 'KES',
      bankName: '',
      bankCountryCode: '',
      swiftBic: 'BAD',
      accountNumber: '',
      accountName: '',
    })

    expect(result.ok).toBe(false)
    if (!('fieldErrors' in result)) {
      throw new Error('Expected manual bank validation to fail.')
    }

    expect(result.fieldErrors.bankName).toBe(MANUAL_BANK_VALIDATION.BANK_NAME_REQUIRED_MESSAGE)
    expect(result.fieldErrors.bankCountryCode).toBe(MANUAL_BANK_VALIDATION.BANK_COUNTRY_REQUIRED_MESSAGE)
    expect(result.fieldErrors.swiftBic).toBe(MANUAL_BANK_VALIDATION.SWIFT_BIC_INVALID_MESSAGE)
    expect(result.fieldErrors.accountNumber).toBe(MANUAL_BANK_VALIDATION.ACCOUNT_NUMBER_REQUIRED_MESSAGE)
    expect(result.fieldErrors.accountName).toBe(MANUAL_BANK_VALIDATION.ACCOUNT_NAME_REQUIRED_MESSAGE)
  })
})

describe('legacy payout setup availability', () => {
  it.each(['NGN', 'GHS', 'KES', ' ngn '])('marks %s as unavailable for new setup', (currency) => {
    expect(isLegacyPayoutSetupCurrency(currency)).toBe(true)
  })

  it.each(['USD', 'GBP', 'EUR', 'CAD', null])('keeps %s out of the legacy setup block', (currency) => {
    expect(isLegacyPayoutSetupCurrency(currency)).toBe(false)
  })

  it('uses clear copy that reassures existing orders and earnings are unaffected', () => {
    expect(LEGACY_PAYOUT_SETUP_COMING_SOON_COPY).toContain('Payout setup is coming soon')
    expect(LEGACY_PAYOUT_SETUP_COMING_SOON_COPY).toContain('Existing orders and earnings are not affected')
  })

  it.each(['NGN', 'GHS', 'KES'])('does not infer a new provider from %s and shows coming-soon guidance', (currency) => {
    const copy = tailorPayoutSetupCopy(currency)
    expect(copy.provider).toBeNull()
    expect(copy.title).toBe('Payout setup is coming soon')
    expect(copy.body).toBe(LEGACY_PAYOUT_SETUP_COMING_SOON_COPY)
    expect(copy.body).not.toContain('Paystack')
  })

  it('keeps international payout copy route-neutral instead of assuming Stripe from currency', () => {
    const copy = tailorPayoutSetupCopy('GBP')
    expect(copy.provider).toBeNull()
    expect(copy.body).toContain('payout country')
    expect(copy.body).not.toContain('Stripe')
  })

  it('labels only one explicit saved provider and rejects conflicting legacy identity fields', () => {
    expect(payoutProviderLabelFromSavedIdentity({})).toBeNull()
    expect(payoutProviderLabelFromSavedIdentity({ payoutProvider: 'STRIPE_CONNECT' })).toBe('Stripe')
    expect(payoutProviderLabelFromSavedIdentity({ paystackRecipientCode: 'RCP_OLD' })).toBe('Paystack')
    expect(payoutProviderLabelFromSavedIdentity({ payoutProvider: 'STRIPE', paystackAccountId: 'old-id' })).toBeNull()
  })
})
