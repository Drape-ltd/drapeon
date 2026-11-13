# Phase 4 Production release plan — disabled Bachs NGN foundation

This plan promotes the Phase 4 runtime prerequisites, the customer-cost lock,
and a disabled NGN/Bachs route.
It does not authorize a live provider call, create a Production payout
destination, enable checkout, or satisfy the later controlled-live-proof and
two-approver enablement gates.

## Release boundary

Apply in this order, with a separate explicit Production approval for each
release unit:

1. **Database repair P4-0 — earlier payout-readiness dependencies**
   - `20261030154721_sync_stripe_payout_readiness.sql`
   - `20261030231747_stripe_first_release_review_readiness.sql`
   - `20261102054500_stripe_first_release_block_fail_safe.sql`
   These Phase 3 prerequisites were missing from Production. P4-1's first
   migration needs the destination evidence columns from the second migration;
   the first migration also restores an RPC called by the currently deployed
   payout-account and Stripe webhook functions. Apply in order, then repair
   generated migration markers to these source versions using the supported
   migration-repair workflow. Never rerun the schema SQL to repair history.
2. **Database batch P4-1 — runtime prerequisites (exact versions, in order)**
   - `20261112181838_phase4_bachs_destination_identity.sql`
   - `20261112185135_phase4_bachs_checkout_definite_rejection.sql`
   - `20261112185545_phase4_bachs_checkout_claim_service_auth.sql`
   - `20261112185931_phase4_bachs_checkout_rejection_status.sql`
   - `20261112193225_make_snapshot_tranche_claim_profile_neutral.sql`
3. **Database batch P4-2 — disabled route and cost lock (exact versions, in order)**
   - `20261112201000_phase4_lock_bachs_provider_cost.sql`
   - `20261112203000_phase4_lock_provider_cost_before_route_snapshot.sql`
   - `20261112204000_phase4_preserve_quote_when_locking_provider_cost.sql`
   - `20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.sql`
   The final version installs a narrow trigger exception for exactly one
   immutable, disabled seed and records the system migration identity in
   `audit_logs`; it does not create a human or Ops principal. Route audit actor
   columns remain null for this system action. It preserves Dev's existing
   `SANDBOX_ONLY` NGN Bachs versions. Production preflight still requires no
   existing Bachs route. Rollback restores the original guard and removes only
   the exact unused Production seed.
4. **Edge batch (exact functions only)**
   - `bachs-webhook`
   - `consultation-lifecycle-action`
   - `customer-order-action`
   - `drapeon-dispatch-action`
   - `expire-pending-payments`
   - `message-action`
   - `monitor-settlements`
   - `payment-action`
   - `payment-route-availability`
   - `payout-account-action`
   - `paystack-webhook`
   - `process-job-queue`
   - `ready-made-order-action`
   - `refund-order-payments`
   - `release-order-tip`
   - `release-settlement-tranche`
   - `release-tailor-adjustment`
   - `send-consultation-reminders`
   - `stripe-webhook`
   - `tailor-order-action`
5. **Web merge/deploy** from the reviewed Phase 4 PR only after both database
   batches and
   Edge postflights pass. Mobile ships later through its normal build process;
   no OTA or store build is part of this release.

The database goes first because the new Edge code calls the v2 acceptance
wrappers. The migrations are additive and compatible with the currently
deployed Edge functions. The web deploy goes last so no customer surface can
offer the new preview before its server contract exists.

## Database preflight

- Run the reviewed read-only query in
  `scripts/phase4-production-preflight.sql`; retain its output with the release
  evidence. Any nonzero/definition mismatch below stops the release.
- Confirm all three P4-0 and all five P4-1 versions appear exactly once before
  P4-2; confirm the four P4-2 versions are absent before their batch.
- Confirm the three P4-0 versions appear exactly once and the readiness RPC and
  Stripe destination evidence columns exist before P4-1. Generated timestamps
  left by the migration API must be reconciled with `supabase migration repair`
  before continuing.
- Confirm `payout_destinations` has no `provider_destination_ref` column and no
  Bachs destination. A partial prior application stops the release for
  reconciliation; never mark history without proving the exact schema.
- Confirm the Bachs checkout request-state constraint has no `REJECTED` state,
  and record the current definitions and grants for
  `claim_bachs_checkout_request` and `reject_bachs_checkout_request`.
- Confirm the current `reserve_settlement_tranche_payout_row` definition matches
  the expected pre-P4-1 profile guard. A definition mismatch stops the release.
- Confirm the canonical route-snapshot functions and required route, delivery
  rule, destination, audit and order snapshot columns match the reviewed
  definitions.
- Confirm route key `ng-ngn-ngn-bachs` does not exist. A conflicting row stops
  the batch; never edit it in place.
- Confirm there are zero Production `BACHS` routes in `ENABLED` state and zero
  active enablement requests for that route key.
- Confirm there are no accepted orders pointing to the to-be-created route ID.

## Database postflight

Run `scripts/phase4-production-postflight.sql` after P4-1 and again after P4-2;
retain both outputs in the release evidence.

- All twelve exact versions appear once in migration history.
- Bachs destinations have an immutable provider destination reference; an active
  Bachs destination requires both that reference and external-account evidence.
- A provider-confirmed checkout 4xx is represented only by `REJECTED` request
  state while the payment remains `INITIATED`; corrected retries reuse the same
  payment attempt and idempotency key. Network/5xx uncertainty remains `SENT`.
- The Bachs checkout claim/rejection RPCs are executable only by `service_role`.
- Accepted-route staged tranches trust the immutable snapshotted destination;
  legacy orders retain the legacy profile-verification guard.
- Route `ng-ngn-ngn-bachs`, version 1, is exactly `DISABLED`, NGN→NGN,
  `fees_collector=PLATFORM`, legal entity `Drape Marketplace Limited`, schedule
  `ngn-card-provider-cost-2pct-v1`, with no confirmed foreign issuer country.
- No route is newly `ENABLED`; no enablement request or approval row is created.
- Both v2 wrappers are `SECURITY DEFINER`, have fixed empty search paths, and
  are executable only by `service_role`.
- Quote acceptance does not update `order_quotes`; the customer amount lock on
  `orders` occurs before the canonical immutable route snapshot call.
- Security, performance and health Advisors introduce no new finding; public
  health remains green.

## Edge postflight

- The 20 deployed versions match the reviewed commit and retain their
  existing JWT/authentication settings.
- Unauthenticated calls are rejected.
- The Production disabled route returns unavailable and cannot prepare a Bachs
  checkout.
- Existing onboarding and non-Bachs behavior remain unchanged. No provider
  request is made during synthetic health checks.

## Web postflight

- The merged SHA matches the reviewed PR head and the active Cloudflare Worker
  reports that SHA.
- A disabled route shows the existing unavailable state before a customer
  writes a brief; it never exposes a hosted Bachs checkout.
- No Production Bachs payment, transfer, refund, payout destination or webhook
  is created by this release.

## Rollback

- First roll back the web deployment, then the 20 Edge functions to their
  recorded previous versions.
- Database rollback is last and only while the route is still disabled, has no
  snapshots/approval evidence, and no v2 caller remains deployed. Run rollback
  scripts in reverse version order, P4-2 before P4-1. Their guards must refuse
  if the route or any new provider identity/request state was used. The two
  authorization/status rollback steps intentionally revoke execution between
  definitions so rollback fails closed. The disabled-route rollback accepts
  only the exact `CREATED` receipt emitted by the system seed, removes that
  receipt and its matching system audit marker before the route, and refuses
  any additional route history.
- A later live-proof or enablement issue uses the audited route kill switch;
  it does not drop schema or erase provider evidence.

## Gates after this release

Production remains unable to take Bachs orders until the owner separately
approves: live secrets/webhooks, a real authorized Nigerian payout destination,
the minimal controlled live proof, two distinct fresh-MFA approvers, and the
audited `DISABLED` → `ENABLED` transition. The foreign-card issuer gate remains
off; bank transfer, Stripe, Paystack, non-NGN, UK, Ghana and Kenya are outside
this release.
