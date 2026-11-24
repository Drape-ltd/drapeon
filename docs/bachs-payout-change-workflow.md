# Bachs payout change workflow — findings and build spec

Status: **spec, not built.** Owner: Phase 4 agent. Must land before the Nigerian
tailor payout email goes out. Follows AGENTS "Replacement Workflow Completion"
and "Workflow Outcome Discipline".

## Findings (origin/main, 2026-11-24)

1. **No Bachs change path exists.** `payout-account-action` stages
   `payout_change_requests` only for Stripe (`stagePayoutChangeRequest` calls at
   the Stripe start/refresh branches; every call passes `provider: 'STRIPE'`).
   Bachs start/refresh never stages a replacement.
2. **Wrong Bachs link type for a change.** `createBachsOnboardingLink`
   (`_shared/bachs-operations.ts`) always requests `type: 'onboarding'` for
   `/v1/accounts/{id}/account-links`. Re-entering "Continue to Bachs" for a
   BOUND account reopens onboarding. Bachs' hosted success page states that a
   bank/director change requires "a new link" from the platform.
3. **A bank change at Bachs breaks payouts silently.** In
   `syncBachsPayoutDestination` (`_shared/bachs-payout-destination.ts`), when
   the provider destination id differs from the stored
   `provider_destination_ref`, the destination is deactivated
   (`bachs_destination_identity_changed`) and the sync throws
   `BACHS_PAYOUT_DESTINATION_IDENTITY_CONFLICT`. The webhook routes that to an
   Ops issue. The tailor sees no pending state, no next step, and their payout
   path is off. Two usable destinations at once also deactivate and throw
   `BACHS_PAYOUT_DESTINATION_AMBIGUOUS`.
4. **No visible "Change payout account" entry.** Web
   (`payout-workspace.tsx`) and mobile (`payout-setup.tsx`) reuse the
   provider-setup section as the change entry; once connected it reads as
   "Continue to Bachs" (see #317 item 1). The Stripe confirm/cancel cards
   (`confirm-payout-change` / `cancel-payout-change`) exist but are Stripe-only
   in practice.
5. **Readiness interaction.** Since #313, `sync_bachs_payout_profile_readiness`
   flips `payout_account_verified` from provider evidence. Deactivation in (3)
   does not currently call it with `p_ready=false` before throwing, so the
   profile can keep saying "payout ready" while the destination is inactive.

## Target behaviour

| Step | Tailor (web + mobile) | Server / DB | Ops | Comms |
| --- | --- | --- | --- | --- |
| Start | "Change payout account" (secondary, inline on the connected card) | Create a Bachs **update** link (verify the supported `type` in Bachs docs; fall back to onboarding only if Bachs confirms it edits the same account) with a dedicated return URL `?setup=bachs-change-return` | — | — |
| Return / webhook shows a new usable destination | One pending card: "New account ••••1234 — confirm within 48 h. Your current account stays active until then." Confirm / Cancel | Stage `payout_change_requests` (provider BACHS, current = old `pd_`, requested = new `pd_` masked summary). Do **not** deactivate the old destination; do not throw identity conflict for a staged change | Visible in the payout review queue | Email + push: "Confirm your new payout account" (deep link to payout page) |
| Confirm | Receipt: reference, time, what happens next | Swap `provider_destination_ref`, reset `first_withdrawal_review_status` to PENDING if policy requires, audit event, re-run readiness sync | Review if `requiresOpsPayoutDestinationReview` says so | Confirmation email/push, Ops notice |
| Cancel / 48 h expiry | Back to the original account | Request CANCELLED/EXPIRED; tailor must revert at Bachs if Bachs already switched (verify Bachs semantics) | Closed | Cancellation notice |
| Bachs rejects new destination (`payout_destination.rejected`) | "Bachs couldn't verify the new account: <reason>. Try again." | Request FAILED with provider reason; old destination unchanged | Visible | Notice |

Stale-state rules: while a change is pending, every surface shows one pending
state; the superseded destination is never presented as "being replaced" and
"active" in contradictory tiles; historical values stay only in audit.

## Build checklist (Phase 4)

1. Confirm in docs.bachs.io the account-link `type` for updating payout
   details and whether Bachs keeps the old destination usable until the new one
   is approved. Record the answer with the doc URL in this file. Do not contact
   Bachs support.
2. Server: Bachs branch in `payout-account-action` (`start-bachs-change`,
   reuse `confirm-payout-change` / `cancel-payout-change`); staging in
   `syncBachsPayoutDestination` instead of conflict when a BACHS change request
   is open; readiness sync `p_ready=false` on any deactivation.
3. Webhook: `payout_destination.approved/rejected` already trigger a refresh
   (#312); make the refresh advance/fail the staged request.
4. Web + mobile: "Change payout account" on the connected card, pending card,
   confirm/cancel, receipts, contextual exits; shared status formatter for every
   state; no raw enums.
5. Ops: change request visible in the payout queue with masked old/new summary.
6. Comms: queued idempotently with recorded terminal outcomes and exact deep
   links.
7. Tests: Deno unit tests for staging vs conflict, readiness on deactivation;
   contract test that only the staged path can swap `provider_destination_ref`.
8. Proof (Dev sandbox): change → pending → confirm; change → cancel; change →
   rejected; second and third run. Then a Production check on the pilot tailor
   only with founder approval.
