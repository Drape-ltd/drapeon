import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const plan = readFileSync(
  new URL('../docs/payments-phase4-production-release-plan.md', import.meta.url),
  'utf8',
)
const preflight = readFileSync(
  new URL('./phase4-production-preflight.sql', import.meta.url),
  'utf8',
)

const orderedMigrations = [
  '20261112181838_phase4_bachs_destination_identity.sql',
  '20261112185135_phase4_bachs_checkout_definite_rejection.sql',
  '20261112185545_phase4_bachs_checkout_claim_service_auth.sql',
  '20261112185931_phase4_bachs_checkout_rejection_status.sql',
  '20261112193225_make_snapshot_tranche_claim_profile_neutral.sql',
  '20261112200000_phase4_seed_disabled_bachs_ngn_route.sql',
  '20261112201000_phase4_lock_bachs_provider_cost.sql',
  '20261112203000_phase4_lock_provider_cost_before_route_snapshot.sql',
  '20261112204000_phase4_preserve_quote_when_locking_provider_cost.sql',
]

test('Phase 4 Production plan contains every migration in dependency order', () => {
  let previous = -1
  for (const migration of orderedMigrations) {
    const position = plan.indexOf(`\`${migration}\``)
    assert.ok(position > previous, `${migration} must appear once in release order`)
    assert.equal(
      plan.indexOf(`\`${migration}\``, position + 1),
      -1,
      `${migration} must appear only once`,
    )
    previous = position
  }
})

test('read-only preflight checks every planned migration version', () => {
  assert.doesNotMatch(preflight, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i)
  for (const migration of orderedMigrations) {
    assert.match(preflight, new RegExp(migration.slice(0, 14)))
  }
})

test('Phase 4 Production plan keeps the route disabled and separates release units', () => {
  assert.match(plan, /Database batch P4-1/)
  assert.match(plan, /Database batch P4-2/)
  assert.match(plan, /separate explicit Production approval for each\s+release unit/)
  assert.match(plan, /zero Production `BACHS` routes in `ENABLED` state/)
})
