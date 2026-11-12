# Phase 4 Production release plan — disabled Bachs NGN foundation

This plan promotes only the customer-cost lock and a disabled NGN/Bachs route.
It does not authorize a live provider call, create a Production payout
destination, enable checkout, or satisfy the later controlled-live-proof and
two-approver enablement gates.

## Release boundary

Apply in this order, with a separate explicit Production approval for each
release unit:

1. **Database batch (exact versions, in order)**
   - `20261112200000_phase4_seed_disabled_bachs_ngn_route.sql`
   - `20261112201000_phase4_lock_bachs_provider_cost.sql`
   - `20261112203000_phase4_lock_provider_cost_before_route_snapshot.sql`
   - `20261112204000_phase4_preserve_quote_when_locking_provider_cost.sql`
2. **Edge batch (exact functions only)**
   - `customer-order-action`
   - `payment-action`
   - `payment-route-availability`
   - `ready-made-order-action`
3. **Web merge/deploy** from the reviewed Phase 4 PR only after the database and
   Edge postflights pass. Mobile ships later through its normal build process;
   no OTA or store build is part of this release.

The database goes first because the new Edge code calls the v2 acceptance
wrappers. The migrations are additive and compatible with the currently
deployed Edge functions. The web deploy goes last so no customer surface can
offer the new preview before its server contract exists.

## Database preflight

- Confirm all four versions are absent from Production migration history.
- Confirm the canonical route-snapshot functions and required route, delivery
  rule, destination, audit and order snapshot columns match the reviewed
  definitions.
- Confirm route key `ng-ngn-ngn-bachs` does not exist. A conflicting row stops
  the batch; never edit it in place.
- Confirm there are zero Production `BACHS` routes in `ENABLED` state and zero
  active enablement requests for that route key.
- Confirm there are no accepted orders pointing to the to-be-created route ID.

## Database postflight

- All four exact versions appear once in migration history.
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

- The four deployed versions match the reviewed commit and retain their
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

- First roll back the web deployment, then the four Edge functions to their
  recorded previous versions.
- Database rollback is last and only while the route is still disabled, has no
  snapshots/approval evidence, and no v2 caller remains deployed. Run rollback
  scripts in reverse version order. Their guards must refuse if the route was
  used.
- A later live-proof or enablement issue uses the audited route kill switch;
  it does not drop schema or erase provider evidence.

## Gates after this release

Production remains unable to take Bachs orders until the owner separately
approves: live secrets/webhooks, a real authorized Nigerian payout destination,
the minimal controlled live proof, two distinct fresh-MFA approvers, and the
audited `DISABLED` → `ENABLED` transition. The foreign-card issuer gate remains
off; bank transfer, Stripe, Paystack, non-NGN, UK, Ghana and Kenya are outside
this release.
