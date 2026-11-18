import { assertEquals } from 'jsr:@std/assert@1'
import { readEnabledTaxPolicyJurisdictions } from './tax-policy-readiness.ts'

const readyDelivery = {
  id: 'delivery-rule',
  version: 1,
  status: 'READY' as const,
  domestic_only: true,
  vat_registration_ready: false,
  collect_vat_under_gbp_135: false,
  duties_customer_pays: true,
  ioss_reviewed: false,
}

Deno.test('readiness ignores disabled and superseded market configuration', () => {
  const result = readEnabledTaxPolicyJurisdictions({
    routes: [
      { version: 1, status: 'ENABLED', tailor_country_code: 'GH', charge_currency: 'GHS', payout_currency: 'GHS' },
      { version: 2, status: 'DISABLED', tailor_country_code: 'GH', charge_currency: 'GHS', payout_currency: 'GHS' },
      { version: 1, status: 'ENABLED', tailor_country_code: 'NG', charge_currency: 'NGN', payout_currency: 'NGN' },
    ],
    deliveryCountryRules: [
      { ...readyDelivery, country_code: 'KE', status: 'DISABLED' },
      { ...readyDelivery, country_code: 'NG' },
    ],
  })

  assertEquals(result.enabledJurisdictions, ['NG'])
  assertEquals(result.policies.map((policy) => policy.countryCode), ['NG'])
  assertEquals(result.unsupportedJurisdictions, [])
})

Deno.test('readiness includes a ready delivery market and maps EU countries to the blocked EU control', () => {
  const result = readEnabledTaxPolicyJurisdictions({
    routes: [],
    deliveryCountryRules: [{ ...readyDelivery, country_code: 'DE', ioss_reviewed: true }],
  })

  assertEquals(result.enabledJurisdictions, ['DE'])
  assertEquals(result.policies.map((policy) => policy.countryCode), ['EU'])
})

Deno.test('readiness reports an enabled jurisdiction with no policy rather than treating it as reviewed', () => {
  const result = readEnabledTaxPolicyJurisdictions({
    routes: [{ version: 1, status: 'ENABLED', tailor_country_code: 'BR', charge_currency: 'BRL', payout_currency: 'BRL' }],
    deliveryCountryRules: [],
  })

  assertEquals(result.enabledJurisdictions, ['BR'])
  assertEquals(result.policies, [])
  assertEquals(result.unsupportedJurisdictions, ['BR'])
})
