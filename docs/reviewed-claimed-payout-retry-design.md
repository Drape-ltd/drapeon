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
The current local RPC draft does not yet do those steps and is not deployable.

The Edge action validator and claimed release adapter also assume a correction ID for operation 2. The forward migration and Edge change must update these paths together, while preserving the different-destination correction branch and its fingerprints. The rollback must restore the exact live function definitions, captured before migration. The catalog query also found `record_payout_attempt_outcome` and late-success guards, which must be included in the behavioral proof even if their bodies need no edit.

## Behavioral proof

Run a rollback-only Postgres fixture against the pre-migration main schema (red) and the migration in one transaction (green). Cover unapproved, preparer/self approval, mismatched order/amount/currency, wrong or missing `NOT_SENT` evidence, live or succeeded operation, missing source charge, same request replay, a second independently reviewed retry after another definite rejection, late success on the prior operation, immutable provider identity, the existing different-destination correction, and no duplicate transfer or ledger posting. Edge tests must exercise the Money Desk adapter and actual claimed release path; mocked RPC calls alone do not prove the SQL gates.

No Dev or Production money state is changed by this design note.
