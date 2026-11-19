# Production release log — 2026-11-18 UTC

This is a version record for the approved Track A, privacy, health, and one-time QA privacy repair. Verify live versions before any later Production action; this record is not a substitute for the live inventory.

| Action | Source / authorization | Before | After | Check |
| --- | --- | --- | --- | --- |
| Track A `handle-verification-decision` | `c79ea684`, founder approval | v54 | v55 | No immediate 5xx |
| Track A `ops-trust-action` | `c79ea684`, founder approval | v18 | v19 | No immediate 5xx |
| Track A `ops-read-gateway` | `c79ea684`, founder approval | v18 | v19 | No immediate 5xx |
| Track A `tailor-profile-action` | `c79ea684`, founder approval | v59 | v60 | No immediate 5xx |
| Track A `drape-ops` | `c79ea684`, founder approval | `075a9808` | `d72a7d0f` | Signed-in `/ops/tailors` and placement control rendered |
| `read-gateway` | Excluded from Track A | v45 | v45 | Signed-out Explore remained available |
| `request-data-access` | Merged privacy fix, founder approval | v47 | v48 at 23:08:09 | Function active; live case-routing proof below |
| `request-account-deletion` | Merged privacy fix, founder approval | v50 | v51 at 23:08:23 | Function active |
| `service-health` | Merged tax-scope fix, founder approval | v55 | v56 at 23:22:43 | Public liveness 200; authenticated readiness was not verified because the health-check secret was unavailable |
| Migration `20261118235514` | PR #239 at `01603096`, exact-head founder review and explicit admin-merge approval | Absent | Recorded once in Production ledger | Case, receipt, case event, and audit row verified |

PR #239 was admin-merged as `937dc0a29f183cadfea2fbf5bf9a2c1a3885a81f` after its exact-head approval and green CI were checked. Before applying the migration, the Production ledger was reread, and the three relevant actor columns were confirmed nullable (`ops_action_receipts.actor_principal_id`, `ops_case_events.actor_principal_id`, and `ops_audit_logs.performed_by`). The exact migration SQL was applied in one transaction with its exact-version ledger entry; unrelated local migrations were not applied.

`OPS-481417B5` now has `environment = PRODUCTION`, `provenance = QA`, queue `privacy-deletion`, and record version 2. Its `REPAIR_LEGACY_UNKNOWN_PRIVACY_CASE` receipt succeeded, with an `AUDIT_SECURITY` case event and a migration audit row containing the PR approval reference. It remains `NEW`: the current Ops UI and case action API have no audited terminal action for a `DATA_ACCESS_REQUEST`, so it was not closed by direct SQL. `tailor_data_exports` remains `IN_REVIEW`. This needs a normal, audited privacy close path before QA closure.

The remaining open trust cases were reread. The two old Drapeon Test verification cases point to a tailor record that Ops reports unavailable. No unverified Production tailor profile currently has a submitted trust video. No second seller decision was made; a new case must be matched to a live profile and its video before any approval or rejection.

No dead jobs were retried or closed. No seller placement was changed during this log update.
