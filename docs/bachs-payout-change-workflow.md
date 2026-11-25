# Bachs payout change workflow — findings and build spec

Status: **draft implementation, incomplete; do not merge or deploy.** Owner: Phase 4 agent. Must land before the Nigerian
tailor payout email goes out. Follows AGENTS "Replacement Workflow Completion"
and "Workflow Outcome Discipline".

The current branch includes the provider-documented update link, a staged
destination read path, and idempotent request notifications. Confirmation
fails closed while the replacement migration is being redesigned. It has
**not** yet completed atomic activation/rejection,
the 48-hour expiry worker, web/mobile change screens, or the full Dev sandbox
matrix. These are release blockers, not follow-up polish.

The existing `payout_destination_provider_reference_immutable` trigger rejects
changing a non-null `provider_destination_ref`. The initial draft RPC tried to
overwrite it and has been removed before any Dev apply. The replacement must
create a **new** `payout_destinations` row, preserve the old row as history,
and switch one authoritative current-row marker atomically. This requires a
reviewed change to the existing one-row-per-provider-account uniqueness rule
and every account-ref lookup (Edge and SQL), with a compatibility check against
Dev and Production schemas. Until then, no Bachs change can be confirmed or
Ops-approved.

Read-only Dev and Production catalogs both show
`payout_destination_provider_reference_immutable` plus
`payout_destination_identity_immutable`, and the unique
`payout_destinations_provider_provider_account_ref_key` index. They also share
the three-column unique index on provider/account/destination reference. A
new-row migration must replace the one-row-per-account uniqueness rule with
one-current-row enforcement without weakening the existing identity guards.

### New-row migration review gate (2026-11-24)

Dev catalog confirms that `(provider, provider_account_ref)` is a unique
constraint, while `(provider, provider_account_ref, provider_destination_ref)`
is a second partial unique index. The intended forward migration would add a
nullable retirement timestamp and audited retirement reason, then replace only
the first uniqueness rule with one current row per provider account. Stripe
must keep its existing one-row behavior. The immutable destination reference
and the three-column uniqueness rule stay intact.

Before applying that migration, update all Bachs account-ref readers to select
the unretired row: webhook account refresh and withdrawal lookup, destination
sync, payout-account get-status/start-change, Ops queue and review, and
`sync_bachs_payout_profile_readiness`. Order payout lookups pinned to a row ID
must continue to resolve their historical row; they must not silently switch
to the replacement. New-row activation must lock the request and old row,
validate the provider `pd_` identity and capability evidence, retire the old
row, insert one new row, mark the request terminal and audit the transition in
one transaction. Cancellation, expiry and rejection leave the old row current.

**Money-path decision for review:** Existing accepted orders can be pinned to
the old row. Retiring it as inactive may block their eventual payout. The
workflow must either hold confirmation until those obligations are cleared or
provide a separately reviewed snapshot-destination correction. It must not
rewrite accepted order snapshots as a side effect. No migration or activation
RPC is applied while that case is unresolved.

Read-only Dev evidence: seven Bachs orders are pinned to a destination row:
three `CONFIRMED`, two `IN_DISPUTE`, and two `EXPIRED`. This is an exercised
case, not a hypothetical constraint. Confirmation must fail closed while an
older pinned order can still need that destination; a reviewed correction is
needed before retiring that row for such an account.

## Provider contract confirmed (2026-11-24)

Bachs' [hosted onboarding guide](https://docs.bachs.io/connect/guides/hosted-onboarding)
specifies `type: "update"` for an account that is already live, and
`type: "onboarding"` for an account that has not finished setup. Both links
require `refresh_url` and `return_url`; creating a new link supersedes the
previous one. A return redirect is not proof of completion: refresh the account
and wait for `account.updated` and `capability.updated` evidence.

The [payouts guide](https://docs.bachs.io/connect/payouts) says a new bank
destination does **not** replace the old destination. The old default remains
until explicitly switched, and payouts can name a destination ID. A bank
destination is generally usable as soon as it is registered, but the app must
check `is_usable` and must not assume all destinations are approved. The same
guide says the account holder must add the bank through the hosted link. This
supports staging the new ID while keeping the old payout destination active.

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
| Confirm | Receipt: reference, time, what happens next | Insert a new destination row and atomically switch the current-row marker; keep the old row immutable. Preserve the account-level first-payout review outcome unless policy requires another review, audit event, re-run readiness sync | Review if `requiresOpsPayoutDestinationReview` says so | Confirmation email/push, Ops notice |
| Cancel / 48 h expiry | Back to the original account | Request CANCELLED/EXPIRED; keep the original destination ID pinned. Bachs leaves that destination in place and does not switch the default when a new one is added. | Closed | Cancellation notice |
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
   is open; readiness sync `p_ready=false` on any deactivation. Add a guarded,
   atomic new-row activation RPC; do not overwrite the immutable provider ref.
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
