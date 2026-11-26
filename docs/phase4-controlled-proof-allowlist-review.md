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
  `20261126193234`. Its byte-identical applied source is archived under
  `supabase/dev-only-migrations`, outside the Production migration directory;
  **do not promote or mark the scheduler version in Production**.
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
| Schema `20261126185703` | Applied to Dev only; one bounded synthetic proof opened after the refusal tests |
| Expiry scheduler `20261126190341` | Applied to Dev only, then unscheduled by forward repair `20261126193234`; source retained in `supabase/dev-only-migrations`, excluded from Production promotion |
| Forward trigger repairs `20261126194045`, `20261126194152` | Applied to Dev only. The first retains the existing accepted-snapshot trigger checks while allowing the exact proof context; the second allows the ACTIVE→ACCEPTED quote transition within that context. Both fail closed on an unexpected source hash. |
| RPC grants | 0 client-callable proof functions; table RLS on, service SELECT only |
| Rollback-only SQL | Second order and altered amount each refused with `PHASE4_PROOF_CHECKOUT_REFUSED`; audited kill, expiry, proof/event UPDATE and DELETE guards passed; transaction rolled back |
| Positive acceptance SQL | Fresh synthetic quote accepted at the exact NGN 102000 minor amount with the route still DISABLED; order reached PAYMENT_PENDING and proof CHECKOUT_RESERVED in a rolled-back transaction |
| Edge request parser | Extra order, amount, currency or route field rejected; one test passed. `payment-routes_test.ts` also proves the separate `payment-action` sandbox bypass is Dev-host-locked. |
| Dev routes | 0 enabled; Bachs route remains `DISABLED` |
| Provider action | Dev proof `8cef49d5-3fa8-4e62-8bb3-f2601d416ab4`, order `f4260000-0000-4000-8000-000000000001`, attempt `aeb432b2-536c-45bd-96ee-5ce28a740e3b`, checkout `chk_3eD9wkhtLIAfChoM`. Sandbox card collection succeeded; signed webhook `evt_62ede824983bd3d03014d9ec969a5a98` reached inbox `504b4570-4339-4b0b-9747-389168759e38` with `signature_valid=true`, `PROCESSED/confirmed`, and marked attempt SUCCEEDED and order CONFIRMED. Exactly one capture ledger transaction `3bf932f0-ba78-4d17-82b0-7e83da590d98`. Tranche release still needs a normal eligible milestone and approved Money Desk request; do not count the transfer as proven. |
| Dev Edge auth | Tokenless `phase4-proof-payment` POST returned 401; internal service request returned 200 |

## Release units and hold points

1. Review schema `20261126185703` and forward repairs `20261126193234`,
   `20261126194045`, and `20261126194152`.
   Exclude the Dev-only scheduler `20261126190341`. Recheck
   acceptance function hashes, route status, ACLs, RLS, migration history and
   zero enabled routes at apply time. The schema migration is already applied
   in Dev; do not edit or replay it there.
2. Deploy `phase4-proof-payment` only after review. Set
   `PHASE4_PROOF_ACTION_ENABLED` only for the approved proof window. The function
   authenticates the service-role token itself; `verify_jwt=false` is explicit.
3. The Dev sandbox checkout and signed collection succeeded. The late-collection
   and tranche-transfer proofs remain open and must not be inferred from that
   capture. The tranche needs a normal local handoff milestone and a reviewed
   Money Desk request before any provider transfer.
4. Production promotion requires its own exact-version approval, baseline
   recheck, two named human approvers for the controlled order, and a separate
   kill-switch rehearsal. No Production release is authorized by this PR.

## Rollback and forward fix

The schema rollback refuses to drop any proof or audit rows. Once used, keep
the evidence and repair forward. The scheduler rollback removes only its cron;
the synchronous expiry checks remain. The Edge action can be disabled without
changing a payment route.
