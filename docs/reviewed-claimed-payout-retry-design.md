# Reviewed retry for a definitely rejected claimed payout

Status: design evidence for a Dev-only fix PR. No migration or provider call has run.

## Failure being repaired

`reconcile_definite_payout_rejection` closes a Stripe operation only after an exact lookup finds no transfer. It records `FAILED_RETURNED` with a request ID and `NOT_SENT:<code>`, and closes the claim as `FAILED_RECONCILED`. The live `start_payout_attempt` then returns `BLOCKED`. The existing destination correction requires a different destination, so it cannot retry after a capability issue is fixed on the same account. The original provider key must never be reused.

## Required authorization and identity

- Use a new `POST_RELEASE_RECOVERY` Money Desk target for a claimed payout retry. Require an `EXECUTING` request, a processing execution attempt, two distinct APPROVE decisions from principals other than the preparer, and exact claim order, amount, and currency.
- Freeze a retry authorization linked to the request, claim, prior operation, next operation number, unchanged provider and destination, and the provider rejection evidence. Replays of the same request must return the same authorization and operation.
- Permit this path only for a `FAILED_RECONCILED` claim whose latest operation is `FAILED_RETURNED` with `NOT_SENT:<code>`, a final failure reference, and no transfer ID. Refuse if any operation on the claim is transferred, withdrawn, late succeeded, pending, or unknown.
- Create operation N+1 with `${businessKey}:op:${N+1}` and the original amount, currency, provider, destination, source charge, route, and earning identity. Never change operation N or the original payout receipt.
- Keep this retry distinct from `payout_destination_corrections`. The existing correction path and its requirement for a different destination must remain intact.

## Guards that need a coordinated change

The live operation constraint and `require_matching_payout_correction_operation`, `validate_payout_provider_operation_reservation`, and `verify_provider_operation_destination_fingerprints` currently require a destination correction for every operation above 1. `start_payout_attempt`, the Edge action validators, `guard_payout_forward_status`, and the release adapter also assume that shape. The forward migration must update these together and preserve their existing correction branch. The rollback must restore the exact live definitions, captured before migration.

## Behavioral proof

Run a rollback-only Postgres fixture against the pre-migration main schema (red) and the migration in one transaction (green). Cover unapproved, preparer/self approval, mismatched order/amount/currency, wrong or missing `NOT_SENT` evidence, live or succeeded operation, missing source charge, same request replay, a second independently reviewed retry after another definite rejection, late success on the prior operation, immutable provider identity, the existing different-destination correction, and no duplicate transfer or ledger posting. Edge tests must exercise the Money Desk adapter and actual claimed release path; mocked RPC calls alone do not prove the SQL gates.

No Dev or Production money state is changed by this design note.
