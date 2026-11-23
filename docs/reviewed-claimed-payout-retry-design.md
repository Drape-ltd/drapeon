# Reviewed retry for a definitely rejected claimed payout

Status: local implementation and isolated Postgres proof in progress. Nothing
has been applied to Dev or Production and no provider call has run.

## Failure being repaired

`reconcile_definite_payout_rejection` closes a Stripe operation only after an exact lookup finds no transfer. It records `FAILED_RETURNED` with a request ID and `NOT_SENT:<code>`, and closes the claim as `FAILED_RECONCILED`. The live `start_payout_attempt` then returns `BLOCKED`. The existing destination correction requires a different destination, so it cannot retry after a capability issue is fixed on the same account. The original provider key must never be reused.

## Required authorization and identity

- Use a new `POST_RELEASE_RECOVERY` Money Desk target for a claimed payout retry. Require an `EXECUTING` request, a processing execution attempt, two distinct APPROVE decisions from principals other than the preparer, and exact claim order, amount, and currency.
- Freeze a retry authorization linked to the request, claim, prior operation, next operation number, unchanged provider and destination, and the provider rejection evidence. Replays of the same request must return the same authorization and operation.
- Permit this path only for a `FAILED_RECONCILED` claim whose latest operation is `FAILED_RETURNED` with `NOT_SENT:<code>`, a final failure reference, and no transfer ID. Refuse if any operation on the claim is transferred, withdrawn, late succeeded, pending, or unknown.
- Create operation N+1 with `${businessKey}:op:${N+1}` and the original amount, currency, provider, destination, source charge, route, and earning identity. Never change operation N or the original payout receipt.
- Keep this retry distinct from `payout_destination_corrections`. The existing correction path and its requirement for a different destination must remain intact.

## Guards that need a coordinated change

Read-only Dev catalog inspection confirmed the exact database choke points:

| Guard | Existing rule that blocks a same-destination reviewed retry |
| --- | --- |
| `payout_provider_operations_check` | Every operation above 1 requires `reviewed_correction_id` and `money_desk_request_id`; the operation number is capped at 3. |
| `require_matching_payout_correction_operation` | Every operation above 1 must have a destination correction for the same operation number. |
| `validate_payout_provider_operation_reservation` | Requires the replacement destination to differ from the previous one and a terminal two-person `PAYOUT_DESTINATION_CHANGE` request. |
| `verify_provider_operation_destination_fingerprints` | Requires the correction's old and new destination fingerprints. |
| `guard_claimed_replacement_against_refund` | Applies to every operation above 1; requires a `BLOCKED` claim and an unreimbursed order payment. It needs a separately reviewed rule for a definite `NOT_SENT` retry rather than a silent bypass. |
| `guard_payout_forward_status` | Joins operations above 1 through `reviewed_correction_id` before forward payout transitions. |
| `start_payout_attempt` | Rejects `FAILED_RECONCILED` claims and treats a missing correction ID on operation 2 as an identity conflict. |
| `verify_replacement_attempt_identity` | Rejects an attempt linked to operation 2 without a correction ID. |
| `prepare_replacement_attempt_on_start` | Creates the attempt when an operation 2 or 3 starts; its numbering and replay behavior must be retained. |

## Live Dev finding: tranche correction is also blocked

On 2026-11-10, read-only Dev catalog queries confirmed that
`a0_claimed_replacement_refund_race_guard` fires before **every** provider
operation insert, with no `WHEN` exception. Its live function requires
`source_kind = 'ORDER_EARNING'` and claim status `BLOCKED` for operation 2 or 3.
The reviewed destination-correction RPC targets a `SETTLEMENT_TRANCHE` claim
in `FAILED_RECONCILED`. Thus that existing correction RPC cannot insert its
replacement operation for a tranche. This is a distinct stuck-money defect;
the same-destination retry must not silently weaken the correction branch.
Record a separate reviewed fix for the correction path before calling it
available in Production.

The same-destination retry needs the complete tranche state transition, not
only an operation row. Before reserving operation N+1 it must lock and match
the failed payout, order, tranche, source payment and claim; prove the exact
source remains available with
`payment_internal.tranche_source_payment_available(payment, plan, tranche)`;
block live refund or dispute operations; and require fresh readiness of the
accepted Stripe destination. It must then reset the failed payout to
`PROCESSING` and the tranche to `RELEASE_REQUESTED` in the same transaction.
The current local RPC draft reopens the failed payout and blocked tranche in
the same transaction as operation N+1. Its isolated Postgres fixture checks
the state change and replay. The fixture does not yet run the full funding,
refund/dispute, Money Desk executor, or provider release path, so this draft
remains undeployable. The payout status guard now requires the exact immutable
retry authorization and reserved operation for `FAILED` to `PROCESSING`; the
isolated fixture runs that trigger. The tranche correction guard in draft #138
must be merged first, and this migration must then be rebased and re-dated.

On 2026-11-10, the isolated Postgres guard check was red with the captured
pre-change `guard_payout_forward_status` (`ILLEGAL_PAYOUT_STATUS_TRANSITION:
FAILED->PROCESSING`) and green with the local forward function. The green run
also verified operation 2 replay and rollback. This is a guard-level proof,
not a full provider or Money Desk execution proof.

The Edge action validator and claimed release adapter also assume a correction ID for operation 2. The forward migration and Edge change must update these paths together, while preserving the different-destination correction branch and its fingerprints. The rollback must restore the exact live function definitions, captured before migration. The catalog query also found `record_payout_attempt_outcome` and late-success guards, which must be included in the behavioral proof even if their bodies need no edit.

## Release execution path found on current main

`release-settlement-tranche` admits an executing `PAYOUT_RELEASE` request or a
snapshot `PAYOUT_DESTINATION_CHANGE` request. It rejects a
`POST_RELEASE_RECOVERY` / `PAYOUT_CLAIM_RETRY` request before loading the
tranche. Its reservation helper accepts only the operation-1 key
`tranche:<id>:op:1`, so passing an operation-2 retry through the ordinary
reservation would also fail identity validation. The three Money Desk
executors (`apps/ops` Edge shared executor, `apps/web/lib`, and the older
`apps/web/app/ops/action` route) recognize only fabric jobs and Stripe
transfer reversals for `POST_RELEASE_RECOVERY`. A completed database reset
therefore still cannot send operation 2. The reviewed retry needs one
service-only execution path that returns the exact operation-2 identity and
source charge to `executeReservedPayout`, uses the immutable operation-2
provider key, and finalizes the existing payout/tranche. All three Money Desk
callers must delegate to it or the legacy executor must be retired before
this feature can be marked ready.

The local draft now includes a service-role-only loader that verifies the
reserved operation, failed payout reset, tranche, request, destination and
source charge. `release-settlement-tranche` has a draft branch that uses this
loader and then the existing claimed payout engine. An isolated Postgres test
proves the loader and its rollback; a Deno helper test checks the exact RPC
arguments and operation-1 claim key. No end-to-end Edge or provider call has
been made.

There is a critical execution gap to close before connecting Money Desk: if
the Ops executor calls `apply_reviewed_claimed_payout_retry`, then its Edge
request times out, marking the Money Desk attempt FAILED would strand a
reserved operation 2. The adapter needs a durable pending/reconciliation
outcome and a supported replay of the same reviewed request. It must not
mark a provider send as definitely failed merely because the HTTP response
was lost. The three executor surfaces need the same rule, or a single shared
executor must replace them.

The current shared executor confirms this gap: `begin_money_desk_execution`
returns the existing `PROCESSING` attempt on a duplicate click without
calling its adapter again. A lost Edge response therefore cannot be repaired
by repeating the same Execute click. The adapter also converts an exception
to `FAILED`, although the provider call may have succeeded. Before this
branch is deployable, a reviewed retry must leave the attempt `PROCESSING`
on ambiguous network outcomes, reconcile operation N against Stripe by its
immutable key and transfer group, and complete the **same** attempt only
after that lookup reaches a definite result. A duplicate Execute may report
the pending state, but a supported worker or command must perform the
reconciliation; it must never reserve operation N+1 for that ambiguity.
Test the lost-response window both before and after Stripe accepts the
transfer, including process restart and replay. The local branch now has the
lookup and monitor paths; the integrated provider-to-ledger proof remains.

The existing `monitor-settlements` loop can reconcile a started tranche
operation and complete its `PROCESSING` Money Desk attempt, using the
tranche's request ID. For a claim still `RESERVED`, however, it treats every
operation above 1 as a destination correction and calls the ordinary
reservation RPC. That is not a valid recovery for a same-destination retry.
The retry must make the monitor invoke the reviewed release Edge function
using the operation's exact request ID, or add another durable worker that
does so. Once that invocation confirms a transfer, the worker must complete
the same attempt and preserve the existing idempotent notification path.
This also covers a crash between database reservation and the first Edge
request. A test must begin in that crash state and prove one provider
transfer, one ledger release, and one terminal Money Desk attempt after the
worker resumes.

The local draft now places the idempotent reservation inside
`release-settlement-tranche` and adds a bounded monitor sweep of `EXECUTING`
reviewed retries with a `PROCESSING` attempt. The sweep invokes that Edge
function with the saved request and tranche; the route-claim loop never
mistakes a reserved reviewed retry for a destination correction. The Edge
loader accepts the same operation in `RESERVED`, `PROVIDER_UNKNOWN` or
`PROVIDER_PENDING`, so a lost response leads to lookup rather than a new
operation. The standalone Ops and web adapters leave these retries pending
even if the Edge HTTP response is lost. The Postgres fixture proves the
unknown-operation reload and one operation-2 row; Deno typechecks pass.
This is still only a draft: an integrated test must prove the
reservation-to-Edge crash, successful provider transfer, terminal attempt,
notification replay, and no second transfer on a lost Edge response. The
three Ops executors now call one shared adapter contract that preserves a
`PROCESSING` attempt on an ambiguous Edge response. The shared adapter's
four Deno tests pass. A complete behavioral test of all three callers and
the monitor remains required; no Dev or Production deploy is permitted yet.

The pending-attempt sweep is now in a separate tested module. Its tests prove
that a crash before the first provider call resumes the exact approved Edge
request, a lost Edge response reuses that request, a transferred claim is left
for terminal reconciliation, and malformed request identity requires a durable
Ops case. Claimed-payout engine tests separately prove operation 2 uses its
reviewed key for the first send and uses lookup rather than a second send after
a lost response. These tests run in `launch:contracts`; the isolated Postgres
forward and rollback fixture passes. The draft migration is ordered after the
open #138 migration (`20261110120000`).

The SQL apply step now locks order and source payment in refund-reservation
order before the claim, then rechecks the live tranche source-availability
function, active plan, reserved work-funding position, pending refund claims
and open disputes before reopening the failed payout. An isolated Postgres 17
fixture executes that real source-availability function and proves pending
refund, unjournaled partial refund, open dispute and consumed funding position
all fail before operation 2 is inserted. A frozen plan and provider dispute
also fail. Replacing the SQL body with the earlier draft makes this fixture
fail; the guarded body passes. The safe case and replay still pass;
the rollback restores the prior operation rule.

The wider Dev-shaped Postgres fixture also runs the reviewed migration with
the real #131 tranche finalizer. It caught an `orders.id` text versus
`disputes.order_id` UUID comparison that the smaller fixture missed. With the
cast fixed, it reserves reviewed operation 2, starts it under the new key,
applies one synthetic provider transfer reference, posts exactly one $84
`TAILOR_RELEASED` credit, completes the original Money Desk attempt, and
replays finalization and completion without duplicate ledger or event rows.
This is a local database proof with a synthetic provider result, not a live
Stripe TEST transfer or a notification-delivery proof.

The isolated combined run also applies open PR #138 at head
`24d43471a723bc84d8b41c60a9dc71a9d7447292` first and attaches its
replacement-refund guard. The reviewed operation still finalizes once. The
rollback originally restored two functions it did not change, including
#138's guard. Those unrelated restores are removed; the combined run now
checks that rolling back this migration leaves #138's guard hash unchanged.
Re-run this compatibility proof from merged main if #138 changes or merges.

**Still required before Dev acceptance:** the merged-main Dev rollout must show
one real Stripe TEST transfer, one ledger release, one terminal Money Desk
attempt and idempotent notification replay. A structured pre-provider Edge
rejection is closed by a service-only RPC that locks the Money Desk request.
With no operation, it fails the attempt atomically; a concurrent apply then
cannot reserve operation 2. If operation 2 is still `RESERVED` with no provider
attempt, it closes the operation with `NOT_SENT:LOCAL_PRE_PROVIDER_ABORT`,
blocks the tranche, fails the Money Desk attempt, and records a specific Ops
case. The Postgres fixture proves this close and replay, then rolls it back to
prove provider start. Once a provider attempt exists, the RPC returns
`PROVIDER_OPERATION_POSSIBLE` and the monitor retains `PROCESSING` for exact-key
reconciliation. The local Dev-shaped Postgres test covers the returned-funds
trigger and provider-to-ledger replay with a synthetic provider result; real
Stripe TEST and notification delivery remain unverified.

This draft authorizes only `SETTLEMENT_TRANCHE` claims. The earlier generic
`ORDER_EARNING` authorization was removed because it has no corresponding
release Edge path; an explicit Postgres negative test now rejects it. A legacy
earning recovery requires its own reviewed execution path if it is ever needed.

## Behavioral proof

Run a rollback-only Postgres fixture against the pre-migration main schema (red) and the migration in one transaction (green). Cover unapproved, preparer/self approval, mismatched order/amount/currency, wrong or missing `NOT_SENT` evidence, live or succeeded operation, missing source charge, same request replay, a second independently reviewed retry after another definite rejection, late success on the prior operation, immutable provider identity, the existing different-destination correction, and no duplicate transfer or ledger posting. Edge tests must exercise the Money Desk adapter and actual claimed release path; mocked RPC calls alone do not prove the SQL gates.

No Dev or Production money state is changed by this design note.

## Definite rejection of the reviewed operation

Self-review found that operation 2 could receive a definite Stripe rejection
after its provider attempt started. The shared payout engine then closes the
claim and operation, but the Money Desk attempt was left `PROCESSING`. The
settlement monitor selects only active claim statuses, so it could not finish
that attempt. Also, `reconcile_definite_payout_rejection` updates the claim
before the operation; at that point the returned-funds trigger cannot yet see
the operation's final `NOT_SENT` evidence to close the payout row.

The reviewed-retry closure now locks the request, claim, operation, payout and
tranche. Only an exact `FAILED_RECONCILED` claim with a `FAILED_RETURNED`
operation, a Stripe request reference, `NOT_SENT:<code>`, and no transfer or
ledger release can close this path. It marks the payout and tranche blocked
and the original Money Desk attempt failed in the same transaction. The Edge
function calls it immediately on definite rejection; the bounded monitor
can finish the same close after a lost Edge response. Missing not-sent
evidence leaves the request open for Ops reconciliation and sends no new
transfer. A local Postgres fixture fails on the prior PR head, passes with
this change, checks the unsafe case and replay, and then rolls back. This is
not yet a Dev or live Stripe TEST proof.
