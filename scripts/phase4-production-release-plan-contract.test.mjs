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
const postflight = readFileSync(
  new URL('./phase4-production-postflight.sql', import.meta.url),
  'utf8',
)
const destinationRollback = readFileSync(
  new URL(
    '../supabase/migrations/rollback/20261112181838_phase4_bachs_destination_identity.rollback.sql',
    import.meta.url,
  ),
  'utf8',
)
const routeSeedRollback = readFileSync(
  new URL(
    '../supabase/migrations/rollback/20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.rollback.sql',
    import.meta.url,
  ),
  'utf8',
)
const systemRouteSeed = readFileSync(
  new URL(
    '../supabase/migrations/20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.sql',
    import.meta.url,
  ),
  'utf8',
)
const orderedMigrations = [
  '20261030154721_sync_stripe_payout_readiness.sql',
  '20261030231747_stripe_first_release_review_readiness.sql',
  '20261102054500_stripe_first_release_block_fail_safe.sql',
  '20261112181838_phase4_bachs_destination_identity.sql',
  '20261112185135_phase4_bachs_checkout_definite_rejection.sql',
  '20261112185545_phase4_bachs_checkout_claim_service_auth.sql',
  '20261112185931_phase4_bachs_checkout_rejection_status.sql',
  '20261112193225_make_snapshot_tranche_claim_profile_neutral.sql',
  '20261112201000_phase4_lock_bachs_provider_cost.sql',
  '20261112203000_phase4_lock_provider_cost_before_route_snapshot.sql',
  '20261112204000_phase4_preserve_quote_when_locking_provider_cost.sql',
  '20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.sql',
]

const edgeFunctions = [
  'bachs-webhook',
  'consultation-lifecycle-action',
  'customer-order-action',
  'drapeon-dispatch-action',
  'expire-pending-payments',
  'message-action',
  'monitor-settlements',
  'payment-action',
  'payment-route-availability',
  'payout-account-action',
  'paystack-webhook',
  'process-job-queue',
  'ready-made-order-action',
  'refund-order-payments',
  'release-order-tip',
  'release-settlement-tranche',
  'release-tailor-adjustment',
  'send-consultation-reminders',
  'stripe-webhook',
  'tailor-order-action',
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
  assert.match(preflight, /bachs_destinations/)
  assert.match(preflight, /provider_destination_references/)
  assert.match(preflight, /provider_external_account_present_exists/)
  assert.match(preflight, /stripe_payout_readiness_rpc_exists/)
})

test('read-only postflight proves every version and the disabled route invariant', () => {
  assert.doesNotMatch(postflight, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i)
  for (const migration of orderedMigrations) {
    assert.match(postflight, new RegExp(migration.slice(0, 14)))
  }
  assert.match(postflight, /status = 'ENABLED'/)
  assert.match(postflight, /ng-ngn-ngn-bachs/)
  assert.match(postflight, /b4c80000-0000-4000-8000-000000000001/)
  assert.match(postflight, /bachs_destinations/)
  assert.match(postflight, /provider_destination_references/)
  assert.match(postflight, /stripe_payout_readiness_rpc_exists/)
})

test('Phase 4 Production plan keeps the route disabled and separates release units', () => {
  assert.match(plan, /Database batch P4-1/)
  assert.match(plan, /Database batch P4-2/)
  assert.match(plan, /separate explicit Production approval for each\s+release unit/)
  assert.match(plan, /zero Production `BACHS` routes in `ENABLED` state/)
})

test('Production Edge unit contains the complete changed shared-module closure', () => {
  const edgeSection = plan.slice(
    plan.indexOf('4. **Edge batch'),
    plan.indexOf('5. **Web merge/deploy'),
  )
  for (const functionName of edgeFunctions) {
    assert.match(edgeSection, new RegExp('- `' + functionName + '`'))
  }
  assert.equal(
    (edgeSection.match(/^   - `/gm) ?? []).length,
    edgeFunctions.length,
    'Edge release unit must contain exactly the reviewed dependency closure',
  )
})

test('destination identity rollback refuses after provider identity is used', () => {
  const guard = destinationRollback.indexOf("provider = 'BACHS'")
  const dropColumn = destinationRollback.indexOf('drop column if exists provider_destination_ref')
  assert.ok(guard >= 0 && dropColumn > guard, 'usage guard must run before dropping provider identity')
  assert.match(destinationRollback, /provider_destination_ref is not null/)
  assert.match(destinationRollback, /raise exception/)
})

test('disabled-route rollback accepts only the exact unused seed receipt', () => {
  const receiptGuard = routeSeedRollback.indexOf('non-seed audit history')
  const deleteReceipt = routeSeedRollback.indexOf(
    'delete from public.payment_route_audit_events',
  )
  const deleteRoute = routeSeedRollback.indexOf('delete from public.payment_routes')

  assert.ok(receiptGuard >= 0, 'rollback must refuse non-seed route history')
  assert.ok(
    deleteReceipt > receiptGuard && deleteRoute > deleteReceipt,
    'exact seed receipt must be removed before the unused route',
  )
  assert.match(routeSeedRollback, /count\(\*\).*<> 1/s)
  assert.match(routeSeedRollback, /actor_workforce_principal_id is null/)
  assert.match(routeSeedRollback, /actor_id is null/)
  assert.match(routeSeedRollback, /payments\.phase4_bachs_ngn_route_seeded/)
  assert.match(systemRouteSeed, /app\.payment_route_system_seed_id', v_route_id::text, true/)
  assert.match(systemRouteSeed, /new\.id = 'b4c80000-0000-4000-8000-000000000001'::uuid/)
  assert.match(systemRouteSeed, /new\.status = 'DISABLED'/)
  assert.match(systemRouteSeed, /new\.provider = 'BACHS'/)
  assert.match(systemRouteSeed, /payments\.phase4_bachs_ngn_route_seeded/)
  assert.match(systemRouteSeed, /v_existing\.status = 'SANDBOX_ONLY'/)
  assert.match(systemRouteSeed, /Preserve that project-local route/)
  assert.match(routeSeedRollback, /Route creation requires a named actor and reason/)
  assert.doesNotMatch(routeSeedRollback, /payment_route_system_seed_id/)
  assert.doesNotMatch(systemRouteSeed, /00000000-0000-4000-8000-000000000004/)
})
