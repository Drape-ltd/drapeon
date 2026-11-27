# Bachs payout change workflow — findings and build spec

Status: **draft implementation; Dev schema and focused tests verified, sandbox and screen proofs owed. Do not merge or promote.** Owner: Phase 4 agent. Must land before the Nigerian
tailor payout email goes out. Follows AGENTS "Replacement Workflow Completion"
and "Workflow Outcome Discipline".

The current branch includes the provider-documented update link, child-bank
history and service-only transition RPCs, idempotent request notifications,
the 48-hour expiry worker, and web/mobile change screens. The Dev migration
set and rollback-only cancel/expire/reject/confirm test passed. The real
sandbox sequence, installed mobile screens, and Ops review proof remain release
blockers.

The existing `payout_destination_provider_reference_immutable` trigger rejects
changing a non-null `provider_destination_ref`. The initial draft RPC tried to
overwrite it and has been removed before any Dev apply. Claude's reviewed
decision keeps the one `payout_destinations` row per connected Bachs account
and stores bank history in a separate `bachs_withdrawal_destinations` table.
The parent `provider_destination_ref` remains the immutable original-onboarding
reference. No order snapshot or account-level release destination changes.

Read-only Dev and Production catalogs both show
`payout_destination_provider_reference_immutable` plus
`payout_destination_identity_immutable`, and the unique
`payout_destinations_provider_provider_account_ref_key` index. They also share
the three-column unique index on provider/account/destination reference. A
child-row migration must leave the one-row-per-account uniqueness rule and
identity guards untouched.

### Child-bank decision (2026-11-24)

Orders pin the connected Bachs account row and releases transfer to its
`acct_` identity. The bank `pd_` identity is used for withdrawals from that
account. Dev has seven orders pinned to the existing account row (three
`CONFIRMED`, two `IN_DISPUTE`, two `EXPIRED`); the bank can change without
retiring that row or altering any order snapshot. A new
`bachs_withdrawal_destinations` child table owns current/pending/history bank
state. The parent identity and its unique constraint remain unchanged.

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
| Confirm | Receipt: reference, time, what happens next | Atomically mark the pending child CURRENT and the old child RETIRED, then PATCH the new Bachs `pd_` as default. Keep the parent account and pinned orders unchanged. Preserve first-payout review. | Review the child bank change when `requiresOpsPayoutDestinationReview` says so; hold withdrawal actions until cleared, never order releases | Confirmation email/push, Ops notice |
| Cancel / 48 h expiry | Back to the original account | Child becomes CANCELLED/EXPIRED; request becomes CANCELLED with the exact lifecycle outcome in metadata. Parent and pinned orders stay unchanged. Bachs does not switch the default when a new bank is added. | Closed | Cancellation notice |
| Bachs rejects new destination (`payout_destination.rejected`) | "Bachs couldn't verify the new account. Try again." | Child becomes REJECTED; existing request guard requires request status CANCELLED, with REJECTED lifecycle metadata. Old bank stays CURRENT. | Visible | Notice |

Stale-state rules: while a change is pending, every surface shows one pending
state; the superseded destination is never presented as "being replaced" and
"active" in contradictory tiles; historical values stay only in audit.

## Dev verification (2026-11-25)

- Dev project `pqptfuqogvrajozfsqzi` recorded exact migrations
  `20261125062323`, `20261125062332`, `20261125062341`, `20261125062352`,
  and forward guard repair `20261125063400`. The repair maps a provider
  rejection to a CANCELLED request with REJECTED lifecycle metadata because
  the existing request guard permits REJECTED only after confirmed Ops review.
- The one existing Bachs account gained one CURRENT child. The child table has
  RLS enabled and zero anon/authenticated table grants; all five transition
  RPCs are service-only. Existing parent and order references stayed intact.
- A rolled-back Dev transaction exercised stage replay, cancel, expiry,
  provider rejection, confirmation and duplicate confirmation. It asserted one
  CURRENT child, unchanged parent bank reference, unchanged first-withdrawal
  review and unchanged pinned-order count. No synthetic rows were retained.
- For a second or third bank change, review compares the new bank with the
  CURRENT child. The parent bank is only the original-onboarding reference and
  may no longer be the bank used for withdrawals.
- Sync now reads the child history and excludes RETIRED, REJECTED, EXPIRED and
  CANCELLED bank IDs from new provider candidates. Bachs may leave an old bank
  usable; it must not be staged again on a third run. A focused test covers a
  usable original bank, a CURRENT second bank and a new third bank. The exact
  shared-file change is deployed on Dev in `payout-account-action` v186 and
  `bachs-webhook` v114, retaining `verify_jwt=false`; zero Dev routes were
  enabled after those deployments.
- Focused Bachs tests passed (37/37) in an isolated Dev integration checkout
  containing this branch and #321. Dev `payout-account-action`,
  `monitor-payout-changes`, and `bachs-webhook` were deployed from that checkout
  to avoid replacing #321's already-deployed code; all retained their prior
  `verify_jwt=false` setting. Dev still has zero enabled payment routes.
- The later current-child comparison is live in Dev `payout-account-action`
  v185. Dev `ops-money-action` v125 was built from its exact prior deployed
  bundle with only the new Bachs bank-review finalizer dispatch added; this
  preserved the separate #269 refund-recovery actions. It typechecked, and
  zero Dev payment routes remained enabled after deployment.
- On 2026-11-25, the documented synthetic Dev Bachs tailor authenticated to
  `payout-account-action` (`get-status` HTTP 200). A sandbox update-link request
  succeeded as change request `9720f507-d42e-4955-b521-ca488fc30a04` while
  the Dev-only onboarding flag was temporarily on. The local headless browser
  failed at `browserType.launch` before rendering the hosted page. The normal
  cancel action returned HTTP 200; the request is `CANCELLED` with lifecycle
  `CANCELLED`. The flag was restored to its prior false value (digest checked),
  and Dev has zero enabled routes. A second run with approved local browser
  access opened the Bachs Connect hosted update link (HTTP 200) for request
  `5ce485b1-60d5-4ae5-8b77-bf480197498d`; the page began with sandbox
  identity verification rather than a bank selector. That request was also
  cancelled through the normal action (HTTP 200), with zero pending requests
  left. This proves link creation, hosted-page access and cancellation, not
  hosted bank entry, confirmation or a provider event.
- A later hosted-page pass advanced one screen and showed Bachs' identity form:
  date of birth, phone/address, government ID number and upload, plus consent,
  before any bank-change step. The [sandbox testing guide](https://docs.bachs.io/connect/testing)
  does not provide a
  synthetic identity-document fixture. Request `4ab28992-2fec-4e46-a700-80db76120821`
  was cancelled normally. No identity data or document was submitted. A full
  provider-originated change proof remains owed; do not use a real person's ID
  in this synthetic Dev account. For a real tailor, Bachs owns this regulated
  payout KYC step: the tailor completes identity and government-ID fields on
  Bachs' hosted page. Drapeon does not collect those fields itself.
- The sandbox account already had a second **usable** provider bank. A normal
  Dev `refresh-bachs-connect-status` call staged it as child
  `ce85fd94-51e7-4b40-a905-e2b756695e52` and change request
  `2eb6eb06-a9b8-4c68-a528-3a01c58bc3ed`. The QA tailor confirmed through
  `confirm-payout-change` (HTTP 200): the original child became RETIRED, the
  second became CURRENT with provider default `SYNCED`, and the request entered
  `OPS_REVIEW`. Ops case `50a40878-623a-4e33-92ac-e294e3a76a67` is open.
  The immutable parent bank reference, first-withdrawal review `CLEARED`,
  parent active flag, and seven pinned orders (three CONFIRMED) did not change.
  The reviewed Money Desk request has not been created or approved, and no
  tranche transfer was attempted. That part still needs genuine Ops approval;
  no approval row was inserted or simulated.
- Repeating the QA `confirm-payout-change` request returned HTTP 200 and left
  exactly one CURRENT child, zero pending children and two total history rows.
  The duplicate confirmation did not create another bank-history row.
- The requested and needs-review notices each queued one email and one push
  job (`8e09681c`, `e35bc61f`, `3814643f`, `ecc99d8f`). All four jobs reached
  `SUCCEEDED` processing with terminal delivery outcomes `SKIPPED` for this
  synthetic recipient with no deliverable inbox/device. This proves recorded
  outcomes, not delivery to a real tailor.
- A temporary Dev-only, service-role-gated Bachs helper read the sandbox bank
  IDs during this proof. It was restored to its prior HTTP 410 behavior at
  version 107 with JWT verification on. The Dev onboarding flag is false again
  (digest checked), and zero payment routes are enabled.
- A direct `supabase db lint --local` could not connect to the sandboxed local
  Postgres port. The migrations compiled and their rollback/forward definitions
  were checked in rolled-back Dev transactions. `pnpm launch:contracts` passed
  on Node 22 from the #318 branch.

### Withdrawal integration gate

The separate #273 withdrawal caller still selects
`payout_destinations.provider_destination_ref`, which is deliberately the
immutable original-onboarding bank after this change. Before either PR can
release withdrawals to a changed bank, that caller must select the one CURRENT
child, require `provider_default_status='SYNCED'` and
`ops_review_status='CLEARED'`, and use that child's `pd_` for payout creation.
Order releases remain pinned to the parent `acct_`. This cross-PR integration
is not part of the completed Dev transition proof.

## Build checklist (Phase 4)

1. Confirm in docs.bachs.io the account-link `type` for updating payout
   details and whether Bachs keeps the old destination usable until the new one
   is approved. Record the answer with the doc URL in this file. Do not contact
   Bachs support.
2. Server: Bachs branch in `payout-account-action` (`start-bachs-change`,
   reuse `confirm-payout-change` / `cancel-payout-change`); staging in
   `syncBachsPayoutDestination` instead of conflict when a BACHS change request
   is open; readiness sync `p_ready=false` on any deactivation. Add a guarded,
   atomic child-bank activation RPC; do not overwrite the immutable parent provider ref.
3. Webhook: `payout_destination.approved/rejected` already trigger a refresh
   (#312); make the refresh advance/fail the staged request.
4. Web + mobile: "Change payout account" on the connected card, pending card,
   confirm/cancel, receipts, contextual exits; shared status formatter for every
   state; no raw enums.
5. Ops: change request visible in the payout queue with masked old/new summary.
6. Comms: queued idempotently with recorded terminal outcomes and exact deep
   links.
7. Tests: Deno unit tests for staging vs conflict, readiness on deactivation;
   contract test that the parent `provider_destination_ref` and pinned orders
   never change while a confirmed child bank becomes CURRENT.
8. Proof (Dev sandbox): change → pending → confirm; change → cancel; change →
   rejected; second and third run. Then a Production check on the pilot tailor
   only with founder approval.
