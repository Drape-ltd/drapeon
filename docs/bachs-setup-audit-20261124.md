# Bachs setup audit — 2026-11-24

Read-only audit of `origin/main` plus Production state after the live Bachs
onboarding pilot. **Owner: Phase 4 agent.** Build on this branch; tick each item
with the commit that fixes it or a written reason to decline.

Already handled elsewhere: P0 onboarding re-entry deactivation (#320), Bachs
payout change workflow (#318), tailor web visual audit (#317).

## Server

| # | Sev | Finding | Where (origin/main) | Fix direction |
|---|---|---|---|---|
| S1 | P1 | Ops can clear a Bachs first-payout review only within 15 min of a provider refresh; Ops action refreshes Stripe only, so CLEARED fails with the generic `payout-destination-first-review-invalid`. | `apps/web/app/ops/action/route.ts` ~2163-2186; freshness check in `20261028021731_bachs_first_payout_release_review.sql` | Before the review RPC, re-read the Bachs account + destinations and run `syncBachsPayoutDestination` (mirror the Stripe refresh). Surface a specific error. |
| S2 | P1 | Destination identity change / ambiguous destinations throw from the webhook → retry job 500 ("Webhook replay failed"), up to 12 retries, each calling Bachs; no named Ops issue. | `_shared/bachs-payout-destination.ts` (throws), `bachs-webhook/index.ts` ~1138 | Return `{ persisted:false, reason }` and raise one named Ops issue; no 5xx loop. (#320 already writes readiness false.) Rebind flow lives in #318. |
| S3 | P1 | No tailor notification on any Bachs state change: capability restricted, destination rejected, readiness true→false, payout failed (Ops issue only), first-payout review cleared/blocked. | `bachs-webhook/index.ts` 1095-1340; review RPC migration | Deduped push + in-app + email to the tailor, deep link `drape://profile/payout-setup` / `/account/payout`; Ops issue when readiness drops. Record terminal outcomes. |
| S4 | P1 | Readiness RPC errors `PGRST202/42883` are swallowed silently. | `_shared/bachs-payout-destination.ts` `missingReadinessRoutine` | Function now exists in Prod (#313 applied); log an Ops issue (or remove the swallow) so drift is visible. |
| S5 | P2 | Claim in `REVIEW` returns "not been started yet" with `pendingReview:false`, inviting a restart; webhook accepts REVIEW but refresh doesn't. | `payout-account-action/index.ts` ~1066-1080 | Return a pending-review state for REVIEW. |
| S6 | P2 | Ops CLEARED can set `active` without a usable `provider_destination_ref`. | review RPC `…021731.sql` 75-78 | Require `provider_destination_ref is not null` (forward migration). |
| S7 | P2 | Webhook rate limit (100/min/IP) runs before signature verification; a burst during mass onboarding → 429 → Bachs retries/disablement risk. | `bachs-webhook/index.ts` ~2206 | Verify first, or exempt verified traffic. |
| S8 | P2 | Unknown event types open one HIGH Ops issue per event id. | `bachs-webhook/index.ts` ~1406 | Dedupe by event type. |
| S9 | P2 | Placeholder email `${caller.id}@drapeon.co` sent to Bachs when the user has no email → Bachs KYC emails to a non-existent address. | `payout-account-action/index.ts` ~955 | Require a real contact email (or the Apple relay address) before starting Bachs. |
| S10 | P2 | Unsigned requests are persisted to `payment_webhook_events` (`rejected:missing_signature`), so anyone can cause DB writes. | `bachs-webhook` intake; observed in Prod | Count/log unsigned rejects without inserting a row, or rate-limit them hard. |

Verified fine: HMAC constant-time compare, 300 s tolerance, multi-secret
rotation, event-id dedupe + 200 on enqueue, out-of-order account events re-read
live state, sandbox/live key selection by project + prefix, live pilot gate,
`*.drapeon.co` return URLs, restricted capability flips readiness false, no
account numbers logged.

## Client and Ops

| # | Sev | Finding | Where | Fix direction |
|---|---|---|---|---|
| C1 | P1 | "Drapeon is reviewing your first payout" shown while Bachs itself still needs documents (every new destination starts `PENDING`); CTA hidden. | mobile `earnings.tsx` ~86, 310-377; web `payout-workspace.tsx` 139-140; mobile `payout-setup.tsx` ~1147 | One shared derivation in `packages/shared`: provider incomplete → "Finish with Bachs" + CTA; provider ready + review PENDING → "Drapeon reviews your first payout, nothing needed"; CLEARED → ready; BLOCKED → contact support. Use it on web + mobile. |
| C2 | P1 | Tiles contradict while review is pending: readiness "Ready" (web earnings, work tile, mobile home) vs payout page "Verification needed" vs mobile earnings "under review". Mobile home checks Stripe review only. | web `earnings-workspace.tsx` ~776, `work-content.tsx` ~121, `payout-workspace.tsx` ~624; mobile `(tailor)/index.tsx` 124-125, 747 | Same shared derivation everywhere; mobile home reads `bachsPayoutDestination`. |
| C3 | P1 | BLOCKED shown as connected/ready; Ops block never resets readiness; no tailor next step. | mobile `payout-setup.tsx` 586-643; web refresh copy ~505; review RPC | Block → readiness false + tailor notice + "Contact payouts" next step. |
| C4 | P1 | Web refresh copy wrong after Bachs return: normal ready+PENDING case says "Finish any remaining verification with Bachs". | `payout-workspace.tsx` ~505 | Use C1 derivation for the toast. |
| C5 | P1 | iOS: auth-session `success` returns early without refreshing, screen stays on CONNECT. | mobile `payout-setup.tsx` ~569 | Refresh on `success` too. Device-verify second and third run. |
| C6 | P2 | "Continue to Bachs" stays the primary CTA when CLEARED/active or BLOCKED. | `payout-workspace.tsx` 799-805 | Connected card + secondary "Change payout account" (#318); hide when BLOCKED. |
| C7 | P2 | Stale/legacy fields: web "Stripe Connect: Not started" for NG tailors; mobile home uses legacy `payoutBankName`; mobile `PayoutSetupProvider` type lacks `BACHS`; web `status()` checks Stripe before Bachs. | `payout-workspace.tsx` 131, 652; `lib/payout-setup.ts` 9; mobile home | Prefer the provider destination; show only the active provider's rows. |
| C8 | P2 | Mobile success copy mixes Bachs' own review with Drapeon's first-payout review. | `payout-setup.tsx` 851, 865 | C1 derivation. |
| C9 | P2 | Ops review badge counts Stripe only; card heading renders raw `BACHS`. | `ops/page.tsx` 851-855 | Count both providers; formatted label. |
| C10 | P2 | Mobile cold start/re-entry doesn't restore Bachs pending state. | `payout-setup.tsx` `load()` 291-302 | Restore from `bachsPayoutDestination`. |

## Production config (observed)

| # | Sev | Finding | Fix |
|---|---|---|---|
| P1c | P1 | Play app-signing SHA-256 missing from `assetlinks.json`; Play-installed Android builds won't return to the app after Bachs. | Owner with Play Console access supplies the fingerprint; append to `com.drape.app`. |
| P2c | P2 | Live API key is onboarding-scoped only; no account-level webhook for collection/transfer/refund/dispute. | Required before the live card pilot (`docs/payments-live-card-pilot-runsheet.md`). |

## Done means

Every P1 fixed with tests and a Dev proof on web, mobile (iOS + Android device)
and Ops for these states: not started, Bachs requirements due, Bachs reviewing,
ready + first-payout review pending, CLEARED, BLOCKED, restricted later,
destination rejected. Second and third runs of the mobile return path. Then a
Production check on the pilot tailor only, with founder approval.
