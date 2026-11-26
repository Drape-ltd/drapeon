# Phase 4 controlled proof allowlist — review worksheet

This branch is a **Dev-tested candidate**, not permission to run a live order.
Production payment routes remain disabled. Neither migration nor Edge action has
been deployed to Production. The service action defaults off even when deployed.

## Boundary

- One immutable tuple pins customer, tailor, order, NGN amount, route ID and
  version, and an expiry of at most one hour. One active proof is permitted.
- Only a trusted service-role caller may invoke the action. Its request has one
  field, the proof ID; it cannot supply an order, amount, route or account.
- The ordinary route resolver evaluates route, delivery and destination
  readiness after substituting the exact disabled route's status in memory.
  The persisted route stays disabled. The transactionally checked quote
  acceptance clones the current acceptance functions and changes only the
  disabled-route guard for the exact proof context. The source-body hashes
  cause migration apply to stop if the baseline changes.
- Acceptance snapshots the ordinary route, delivery and payout destination.
  Checkout uses the normal pricing reservation, initial-order payment attempt,
  fixed `DRAPE-PAY-…-Q…` idempotency key, Bachs checkout claim/bind, and the
  existing webhook, ledger, refund and transfer paths.
- Every authorization checks expiry synchronously. Opening a new proof first
  marks the previous expired row and records its audit event. Applied Dev-only
  scheduler version `20261126190341` was removed by forward repair
  `20261126193234`; **do not promote the scheduler version to Production**.
  The service-only kill RPC records actor and reason and prevents later
  authorization. Neither kill nor expiry closes an already-open hosted Bachs
  checkout. The operator keeps the order and attempt under review until Bachs
  confirms the checkout expired, or until the normal payment-expiry cleanup
  reconciles it. We have not found a documented provider cancellation endpoint;
  do not assume a checkout can be canceled by API. A late signed collection is
  still recorded as a successful payment and exactly one capture ledger entry,
  then held for Ops refund review without confirming the order or releasing a
  tranche. Bachs documents that even `checkout.expired` can precede a late
  successful payment ([checkout expiry](https://docs.bachs.io/guides/webhooks/events/checkout-expired)).
- `order_id` is unique across proof rows. Re-arming after expiry or kill
  requires a fresh quote and order, not a reset of the original row.
- The ordinary `payment-action` Bachs sandbox bypass is **Dev-host-locked**.
  It may reach a snapshotted Dev proof order with the same idempotency key; its
  behavior is not evidence that Production permits a client bypass.

## Dev evidence, 2026-11-26

| Check | Result |
| --- | --- |
| Schema `20261126185703` | Applied to Dev only; zero proof and audit rows |
| Expiry scheduler `20261126190341` | Applied to Dev only, then unscheduled by forward repair `20261126193234`; Production must exclude this version |
| RPC grants | 0 client-callable proof functions; table RLS on, service SELECT only |
| Rollback-only SQL | Second order and altered amount each refused with `PHASE4_PROOF_CHECKOUT_REFUSED`; audited kill, expiry, proof/event UPDATE and DELETE guards passed; transaction rolled back |
| Edge request parser | Extra order, amount, currency or route field rejected; one test passed |
| Dev routes | 0 enabled; Bachs route remains `DISABLED` |
| Provider action | None; no proof tuple opened and no Bachs request sent |

## Release units and hold points

1. Review schema `20261126185703` and forward repair `20261126193234`.
   Exclude the Dev-only scheduler `20261126190341`. Recheck
   acceptance function hashes, route status, ACLs, RLS, migration history and
   zero enabled routes at apply time. The schema migration is already applied
   in Dev; do not edit or replay it there.
2. Deploy `phase4-proof-payment` only after review. Set
   `PHASE4_PROOF_ACTION_ENABLED` only for the approved proof window. The function
   authenticates the service-role token itself; `verify_jwt=false` is explicit.
3. A later, separately approved Dev rehearsal needs a synthetic quote and
   checkout. This branch proves the refusal cases; it does not claim a positive
   customer payment or live provider result.
4. Production promotion requires its own exact-version approval, baseline
   recheck, two named human approvers for the controlled order, and a separate
   kill-switch rehearsal. No Production release is authorized by this PR.

## Rollback and forward fix

The schema rollback refuses to drop any proof or audit rows. Once used, keep
the evidence and repair forward. The scheduler rollback removes only its cron;
the synchronous expiry checks remain. The Edge action can be disabled without
changing a payment route.
