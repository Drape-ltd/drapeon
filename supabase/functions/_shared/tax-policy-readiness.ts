import {
  getTaxPolicyControl,
  TAX_POLICY_CONTROLS,
  type TaxPolicyControl,
} from '../../../packages/shared/src/tax.ts'
import { paymentDeliveryReadinessReasons } from './payment-routes.ts'

type PaymentRouteRow = {
  version: number
  status: string
  tailor_country_code: string
  charge_currency: string
  payout_currency: string
}

type DeliveryCountryRuleRow = {
  id: string
  version: number
  status: 'READY' | 'DISABLED'
  country_code: string
  domestic_only: boolean
  vat_registration_ready: boolean
  collect_vat_under_gbp_135: boolean
  duties_customer_pays: boolean
  ioss_reviewed: boolean
}

export type TaxPolicyReadiness = {
  enabledJurisdictions: string[]
  policies: TaxPolicyControl[]
  unsupportedJurisdictions: string[]
  ambiguousConfiguration: string[]
}

function currentRows<T extends { version: number }>(rows: readonly T[]): T[] {
  const latest = rows.reduce((version, row) => Math.max(version, row.version), 0)
  return rows.filter((row) => row.version === latest)
}

/**
 * Readiness is an operational summary, not a checkout authorizer. It reports
 * only markets that can currently be offered: current enabled payment routes
 * plus current delivery rules that are actually ready. Exact order checks stay
 * in the database and Edge resolver.
 */
export function readEnabledTaxPolicyJurisdictions(input: {
  routes: readonly PaymentRouteRow[]
  deliveryCountryRules: readonly DeliveryCountryRuleRow[]
}): TaxPolicyReadiness {
  const enabled = new Set<string>()
  const ambiguousConfiguration = new Set<string>()

  const routesByCorridor = new Map<string, PaymentRouteRow[]>()
  for (const route of input.routes) {
    const key = [route.tailor_country_code, route.charge_currency, route.payout_currency]
      .map((value) => value.trim().toUpperCase())
      .join(':')
    routesByCorridor.set(key, [...(routesByCorridor.get(key) ?? []), route])
  }
  for (const [corridor, routes] of routesByCorridor) {
    const current = currentRows(routes)
    if (current.length !== 1) {
      ambiguousConfiguration.add(`payment_route:${corridor}`)
      continue
    }
    if (current[0].status !== 'ENABLED') continue
    const country = current[0].tailor_country_code.trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(country)) enabled.add(country)
  }

  const rulesByCountry = new Map<string, DeliveryCountryRuleRow[]>()
  for (const rule of input.deliveryCountryRules) {
    const country = rule.country_code.trim().toUpperCase()
    rulesByCountry.set(country, [...(rulesByCountry.get(country) ?? []), rule])
  }
  for (const [country, rules] of rulesByCountry) {
    const current = currentRows(rules)
    if (current.length !== 1) {
      ambiguousConfiguration.add(`delivery_country_rule:${country}`)
      continue
    }
    if (!/^[A-Z]{2}$/.test(country) || paymentDeliveryReadinessReasons(current[0]).length > 0) continue
    enabled.add(country)
  }

  const enabledJurisdictions = [...enabled].sort()
  const policies = new Map<string, TaxPolicyControl>()
  const unsupportedJurisdictions: string[] = []
  for (const country of enabledJurisdictions) {
    const policy = getTaxPolicyControl(country)
    if (policy) policies.set(policy.countryCode, policy)
    else unsupportedJurisdictions.push(country)
  }

  return {
    enabledJurisdictions,
    policies: TAX_POLICY_CONTROLS.filter((policy) => policies.has(policy.countryCode)),
    unsupportedJurisdictions,
    ambiguousConfiguration: [...ambiguousConfiguration].sort(),
  }
}
