# Staff-built tailor profiles and private claim links: architecture cross-check

Date: 2026-11-16
Branch: `codex/tailor-claim-profiles`
Base: `origin/main` at `70990ea5`

## Implementation status

**PR 1 approved and implemented on 2026-11-16.** This pull request implements only the staff-draft and private-preview foundation: lifecycle isolation, private moderated media, placeholder-account controls, invite issuance/open/revoke/decline, bounded purge, and the Ops/web preview experience. It does not implement account ownership transfer, email/phone verification, media promotion, or go-live. Those remain gated to PR 2 by the two-transaction design below.

## Original Phase 0 decision

**STOP before claim/finalize implementation.** The placeholder-user direction is viable, but the proposed claim transaction is not internally consistent with the mandatory go-live gates:

1. Step 4 says to apply the stored pre-approval atomically as part of claim.
2. The current recruitment-waiver approval sets `is_live=true`, `is_verified=true`, and `id_verification_status='VERIFIED'` immediately (`supabase/migrations/20260928180000_protected_ops_trust_exceptions.sql:88-100`; the later migration changes the recorded method to `ADMIN_RECRUITMENT_WAIVER`, `supabase/migrations/20261002130000_record_recruitment_waiver_method.sql:25-35`).
3. Changing the placeholder auth user's email while requiring confirmation necessarily leaves a period in which the new email is not confirmed. Nothing in the waiver checks `auth.users.email_confirmed_at`; its non-video preflight checks only display name, avatar, specialty, portfolio photo, and public-user phone (`20260928180000_protected_ops_trust_exceptions.sql:89-92`).

Therefore “claim and go live atomically” would make a shop public before email confirmation, contradicting “email must be confirmed before go-live.” The flow must be split into (a) an idempotent account-claim transaction that records `CLAIMING`/`CLAIMED`, sends confirmation, and remains not live, then (b) an idempotent finalize transaction reached after confirmed-email reauthentication. Finalize must row-lock the invite/profile, recheck confirmed email and verified phone, promote approved media, apply the stored waiver, and set `LIVE`. A durable receipt is required for both stages.

Two additional corrections are required before coding:

- Existing avatar and portfolio storage is public, so draft media cannot use those buckets “unchanged.” `portfolio-photos` has unconditional public read (`supabase/migrations/20260316000005_storage_rls.sql:142-167`); the bucket is explicitly documented public (`:198`). Drafts need a new private bucket with service-only writes and short-lived signed preview URLs, then a server-side copy/promotion at finalize. `trust-verification` is private but is semantically and policy-scoped to challenge videos, not storefront media (`supabase/migrations/20260721120000_tailor_challenge_video_verification.sql:7-25`).
- Updating `auth.users.email` does not rerun the insert-only `on_auth_user_created` trigger (`supabase/migrations/20260429000008_signup_trigger_hardening.sql:74-77`). The claim transaction must explicitly update `public.users.email`, display name, phone, and role alongside the auth-admin update, with compensation/recovery because Auth Admin and Postgres cannot participate in one database transaction.

## A. Trace claims

| # | Result | Evidence / correction |
|---|---|---|
| 1 | Confirmed | `tailor_profiles.user_id` is `unique not null` and references `public.users(id)` (`supabase/migrations/20260313000001_initial_schema.sql:75-78`); `public.users.id` references `auth.users(id)` (`:43-50`). No later migration found replaces that ownership chain. |
| 2 | Confirmed | `tailor_pickup_details.user_id` is its PK and directly references `auth.users(id)` (`supabase/migrations/20260422000003_tailor_pickup_details.sql:7-12`). The structured origin fields are additive (`supabase/migrations/20260816100000_early_fulfillment_eligibility.sql:5-19`). |
| 3 | Partly confirmed | The uid-keyed ownership convention exists for `portfolio-photos` and `avatars`; portfolio read is public (`20260316000005_storage_rls.sql:142-167`) and avatar owner writes are uid-scoped (`20260316000009_security_hardening.sql:50-70`). `trust-verification` is private and uid/challenge scoped (`20260721120000_tailor_challenge_video_verification.sql:7-25`). Public buckets are unsuitable for drafts. |
| 4 | Confirmed | Explore requires `is_live`, `is_verified`, and not test (`supabase/functions/read-gateway/index.ts:365-375`); public profile does the same (`:421-431`). RLS and related portfolio/item policies enforce it (`supabase/migrations/20260910090000_public_marketplace_test_profile_boundary.sql:39-86`) and the partial index has the same predicate (`:12-14`). |
| 5 | Confirmed with filename correction | The base RPC is `20260928180000_protected_ops_trust_exceptions.sql`, refresh wrapper is `20260929162000_repair_trust_exception_refresh_rpc.sql:14-94`, and method repair is `20261002130000_record_recruitment_waiver_method.sql:1-36` plus production-forward `20261028000916_prod_forward_recruitment_waiver_method.sql:1-30`. It requires active admin, allowed environment, sensitive assurance (`20260928180000...:22-27`), reason/evidence/idempotency (`:40-43`), review acknowledgements (`:82-83`), and display name/avatar/specialty/photo/phone (`:89-92`). |
| 6 | Confirmed | The current identity lock reads `drape.identity_verification_trusted_write` (`supabase/migrations/20260724013000_allow_initial_verified_payout_setup.sql:5-12`). Earlier trigger installation is at `20260716174001_verification_shadow_review.sql:201-205`. Claim edits must precede approval or use a narrowly scoped trusted finalize RPC. |
| 7 | Confirmed | Token hashing/generation are at `supabase/functions/identity-handoff-action/index.ts:254-263`; active-state enforcement is `:334-366`; issuing/sending is in the `591-695` region. The backing table begins at `supabase/migrations/20260716064610_identity_handoff_live_selfie.sql:5-18`. Reuse this pattern, not its trust-video table. |
| 8 | Corrected | The general pattern exists, but the cited route is not the exact exception path. Production exception writes are Ops route origin/session/MFA checks (`apps/ops/app/api/actions/trust-exception/route.ts:12-18`), Cloudflare assertion forwarding (`:71-80`), Edge broker/principal validation (`supabase/functions/ops-trust-exception-action/index.ts:20-80`), then one RPC that creates its own audit, event, and completed receipt (`20260928180000...:112-133`). Do not force a separate prepare/complete protocol onto this action without a deliberate migration. |
| 9 | Confirmed | `payout-account-action` resolves the signed-in caller and loads their profile by user id (`supabase/functions/payout-account-action/index.ts:706-729`); absence is a setup blocker. Phase 3 should only link to it and must not change payment code. |

## B. Requirements ownership matrix

The ownership below is the minimum complete contract. “Staff” values remain editable by the tailor until finalize; “System” means derived, verified, or generated rather than trusted from form input.

| Requirement | Owner | Evidence / rule |
|---|---|---|
| Auth uid and placeholder `.invalid` email; no password; ban; `role=TAILOR`, `account_origin=STAFF_DRAFT` | System | Service-role creation; sign-in denial needs an integration test. |
| Real email and password | Tailor (claim) | Claim input; unique-email collision must stop without merge. |
| Email confirmed timestamp | System | Must be rechecked from Auth immediately before finalize/live; it cannot be satisfied in the initial claim transaction. |
| Phone number | Tailor (claim) | Setup step 0 requires phone (`packages/shared/src/tailor-setup.ts:199-204`); waiver also requires `public.users.phone` (`20260928180000...:89-92`). |
| Phone OTP verification receipt | System | Reuse `account-profile-action` send/verify controls; verify action records `account.phone_verified` (`supabase/functions/account-profile-action/index.ts:1014-1022`). A phone string alone is insufficient. |
| Display name | Staff draft, Tailor review | Setup step 0 (`tailor-setup.ts:192-197`), web bootstrap validation (`account-profile-action/index.ts:504-510`), waiver (`20260928180000...:89-92`). |
| Avatar | Staff draft, Tailor review | Setup step 0 (`tailor-setup.ts:206-208`), waiver. Must live in private draft media until finalize. |
| Public location | Staff draft, Tailor review | Setup step 0 (`tailor-setup.ts:210-212`); bootstrap permits blank initially but go-live does not (`account-profile-action/index.ts:170-176`). |
| Bio, minimum 80 valid characters | Staff draft, Tailor review | `tailor-setup.ts:214-219`. |
| Languages, 1–12 | Staff draft, Tailor review | `tailor-setup.ts:221-225`; bootstrap schema `account-profile-action/index.ts:175`. |
| Specialties, 1–20 | Staff draft, Tailor review | `tailor-setup.ts:227-231`; waiver requires at least one. |
| Currency and valid min/max within currency bounds | Staff draft, Tailor review | `tailor-setup.ts:233-241`; bootstrap normalization and ordering check (`account-profile-action/index.ts:518-540`). |
| Seller type/order modes | Staff draft, Tailor review | At least custom or ready-made (`tailor-setup.ts:243-256`). Default v1 draft may be `TAILOR`, custom=true, ready-made=false, but it must be explicit. |
| Portfolio proof | Staff draft, Tailor review/removal | Tailor requires portfolio; boutique requires a ready-made item; hybrid requires both (`tailor-setup.ts:243-253`). Waiver specifically requires at least one **photo**, so video-only does not qualify (`20260928180000...:89-92`). |
| Media moderation and approved placement | System/Ops | Queue existing media-safety review; trust approval on current main also requires marketplace placement (`supabase/migrations/20261111152000_trust_approval_requires_placement.sql:1-70`). Finalize must reject unapproved/quarantined assets. |
| Fulfillment mode | Staff draft, Tailor review | At least pickup/delivery/shipping (`tailor-setup.ts:259-261`). |
| Private pickup origin | Tailor (claim) | Minimum setup address (`tailor-setup.ts:263-268`); authoritative row is private `tailor_pickup_details` (`20260422000003...:1-12`). |
| Structured origin line1/city/region/postal/country | Tailor (claim) | Fields added by `20260816100000_early_fulfillment_eligibility.sql:5-13`; required in practice for supported fulfillment/corridor evaluation. |
| Origin verification source/reference/time | System (or reviewed Ops process) | `20260816100000...:11-13,111-112`; do not let the claimant self-assert `verified_at`. |
| Challenge video | System waiver | Normal setup flags it (`tailor-setup.ts:270-272`); handpicked flow satisfies the trust decision only through recorded `ADMIN_RECRUITMENT_WAIVER`, never with a fake path. |
| Pre-approval actor, reason, evidence, assurance, acknowledgements, case/version | Admin/System | Existing waiver contract (`20260928180000...:22-43,67-92`). Store a reference to an open waiver case/snapshot, not a boolean “preapproved.” Refresh after tailor edits before decision (`20260929162000...:60-83`). |
| Profile complete | System | Derived database state; readiness blocks paid work when false (`supabase/functions/_shared/tailor-readiness.ts:31-58`). |
| Trust verified/live | System | Finalize-only after confirmed email, OTP receipt, consent, media approval/promotion, placement, and waiver decision. |
| Payout readiness | Tailor after claim/System | Independent of marketplace visibility. Paid orders/items require verified trust plus provider readiness (`tailor-readiness.ts:31-93`). Not part of claim implementation. |
| Consent text/version/time and exact media manifest | Tailor/System | Tailor checks consent; system snapshots immutable text version and asset ids/hashes before finalize. |
| Public profile/explore/order data | Staff draft + Tailor review + System derivation | Public reads consume name, location, seller type/category, ratings, availability, specialties, currency, avatar/media, modes, fulfillment, price, response metrics (`read-gateway/index.ts:365-430`). Ratings/order counts/ranking are system-owned and start at zero/default. |
| Availability, `accepts_custom_orders_now`, `shop_paused` | Staff default + Tailor review | Public gateway reads them (`read-gateway/index.ts:369-370,425-426`); choose explicit defaults so claim does not accidentally open unavailable work. |
| Consultation fields | Staff default + Tailor review | Public profile reads consultation mode/requirement/fee/currency/duration/call type/creditability (`read-gateway/index.ts:425-426`). Use existing free/optional defaults unless explicitly configured. |

`bootstrap-web-onboarding` is not safe to call wholesale for claim: it expects an already authenticated caller and writes user/profile metadata (`account-profile-action/index.ts:504-672`). Claim should reuse its validators and canonical normalizers, not replay the onboarding action against a banned/unconfirmed placeholder.

## C. Placeholder side-effect sweep

The required exclusion key should be a database column (`tailor_profiles.lifecycle_state` or `is_staff_draft`) with an indexed `STAFF_DRAFT` state. Auth metadata alone is not queryable reliably by jobs/RLS. Every query below must fail closed on that state.

| Side effect | Current behavior | Draft exclusion required |
|---|---|---|
| Auth insert → public user | `handle_new_user` always upserts `public.users` on auth insert (`20260429000008_signup_trigger_hardening.sql:7-77`). | Expected; create metadata with role/display name. Immediately mark the corresponding DB account/profile draft in the same orchestrated operation. Cleanup must delete auth user last so FK cascades work. |
| Welcome/lifecycle/marketing | No welcome send occurs in `handle_new_user`; communication preferences/jobs are created by later account/onboarding activity. | All signup/welcome/lifecycle selectors and enqueue sites must require not-draft/claimed. Do not enqueue on placeholder creation. Marketing consent must remain absent until claimed. |
| Readiness reminders | Job selects every PENDING/VERIFIED/APPROVED profile with incomplete payout (`supabase/functions/send-tailor-readiness-reminders/index.ts:53-63`) and queues push/email (`:72-140`). | Add `lifecycle_state <> STAFF_DRAFT` (and ideally `CLAIMED/LIVE` allowlist). Without it, pre-approved drafts will receive reminders at invalid addresses. |
| Public Explore/profile/search | Gateway and RLS already require live+verified+not-test (`read-gateway/index.ts:365-431`; `20260910090000...:39-86`). | Drafts must stay `is_live=false,is_verified=false`; also add explicit draft exclusion to defense-in-depth predicates before any stored preapproval can be represented. |
| Ranking/index/sitemap | Public partial index uses live+verified+not-test (`20260910090000...:12-14`); sitemap/public callers inherit gateway/RLS. | Add draft exclusion to the canonical public predicate/index, not per client. |
| Analytics/audit | Edge actions call audit/log directly; auth insert creates no application analytics event in the trigger. | Draft create/open/claim events must be explicit, token-free, and tagged `account_origin=STAFF_DRAFT`; normal signup funnels must begin only at claim. |
| Slack/Ops alerts | No Slack send is in `handle_new_user`. Ops issue/event functions may react to verification/media actions. | Use dedicated safe open/claim alerts with ids only; suppress generic signup/readiness alerts for drafts. Never include token/source URL/private address. |
| Ops roster/counts/metrics | Roster currently selects `tailor_profiles` broadly (for example `apps/ops/lib/remaining-domain-data.ts:109`). | Default business metrics exclude staff drafts; Draft Tailors gets a separate count/status dimension. |
| Realtime | Profile tables can produce normal row changes to authenticated subscribers. | No placeholder can authenticate; token preview must use a minimal server projection, never a realtime subscription. After claim, normal account subscriptions resume. |
| Account deletion/finalization | Finalizer discovers the tailor profile by auth uid (`supabase/functions/finalize-account-deletions/index.ts:63`). | Draft purge is a separate bounded retention job: revoke invite, delete private media, dependent profile/user rows, then Auth user; retain only non-PII audit tombstone/correlation evidence. Do not fake a user-requested deletion. |

Before implementation, run a repository-wide query inventory for every `from('tailor_profiles')`, auth-admin create/update, communication enqueue, metric, and public projection and add a test for draft exclusion. The entries above identify the direct creation and high-risk scheduled/public side effects; this should be enforced by a central lifecycle predicate rather than relying on an ever-growing manual list.

## D. Surface contract

| Surface | Required behavior |
|---|---|
| iOS | No claim UI in v1 because claim is phone-web and token-bearing. Claimed account sign-in must load the existing tailor setup/dashboard; Explore must show only after finalize. Payout link remains existing mobile surface. |
| Android | Same as iOS; explicitly verify in-app-browser claim handoff, subsequent native sign-in, Explore visibility, and no stale customer role. |
| Customer web | `/claim/[token]` is a server/token-gated minimal preview with no customer session dependency. Public Explore/profile remain absent until finalize. |
| Tailor web | Claim/resume/final receipt, confirmed-email return, setup editing, and existing `/account/payout` handoff. Re-entry after claim must resolve to sign-in/receipt, not form. |
| Ops | Draft builder, private preview, invite issue/revoke/delete, preapproval case, lifecycle status, open/claim alerts, suspend/revoke action, and metrics separation. |
| Shared types | Canonical lifecycle enum, safe preview projection, claim/finalize receipts, consent version, failure codes, and public-predicate helper. Do not expose raw DB enum strings in UI. |
| DB/Edge | Service-only invite/draft tables/RPCs; row locks and idempotency; private media manifest; confirmed-email + OTP + consent + moderation + placement checks at finalize; bounded purge. |
| Realtime | Not applicable before claim (placeholder is banned; preview is token read). After claim, existing authenticated channels apply; finalize must invalidate/reload Explore/profile caches. |
| Notifications | Dedicated token-free Ops opened/claimed events; welcome only after claim with terminal job outcome; customer-facing discovery has no notification requirement. |

## Threat model and security decisions

- Generate 32 random bytes and base64url encode; persist SHA-256 only. Return the raw token exactly once to the authenticated Ops response and never put it in audit/log/Slack/analytics payloads. Follow `identity-handoff-action` token helpers (`:254-263`).
- Store invite state server-side and row-lock on every resolve/claim/finalize. Resolve may distinguish an actionable invite from a generic unavailable recovery state, but must not expose whether arbitrary token guesses ever existed.
- Before claim consumption, the private link remains the credential: a holder may start a new provider proof that supersedes and revokes an unfinished bootstrap belonging to the same invite. Rate-limit and audit every supersede. This recovery tradeoff prevents a crashed sign-in from permanently locking out the tailor; link forwarding remains mitigated by server-side provider proof and the later phone/consent claim gates.
- Enforce 30-day expiry, one active token per draft, revocation on regenerate, one winning claim, per-IP and per-token-hash limits, POST origin/CSRF checks, existing bot protection, and durable idempotency keys.
- `/claim/*` must set `Referrer-Policy: no-referrer`, `robots: noindex,nofollow`, private/no-store caching, and a CSP with no analytics/third-party scripts. Redaction must happen before Sentry capture.
- Preview projection must omit uid, pickup details, auth/email/phone, source handle/URL, staff identity, internal notes, waiver details, moderation data, and storage paths. Return only display-safe fields and short-lived signed media URLs.
- Placeholder proof must cover password sign-in, magic link/OTP, OAuth linking, refresh/session issuance, and password recovery—not only “no password.” The ban plus invalid email is the authority; metadata is not.
- Link possession is ownership only after phone OTP and confirmed email. Open and claim create safe Ops events. Revoke/suspend must invalidate outstanding sessions and force `is_live=false` under an audited admin action.
- Draft media belongs in a new private bucket. Validate MIME by bytes, dimensions/duration and size; strip EXIF/GPS before persistence; queue existing media-safety moderation; promote only the consented, approved manifest at finalize.
- `tailor_claim_invites` and claim RPCs revoke anon/authenticated access and grant only service role. The public web route calls an Edge broker that exposes a minimal projection, never direct table access.
- Expired/declined/revoked drafts are purged by a bounded, idempotent batch with retention and recorded terminal outcome. Invite/audit tombstones must not retain the raw token or unnecessary source PII.

## Required design decision to unblock Phase 1

Approve the two-transaction lifecycle:

`INVITED → OPENED → CLAIMING → CLAIMED_AWAITING_EMAIL → FINALIZING → LIVE`

The first transaction consumes ownership exactly once and converts the account without going live. The second is available only to the same newly authenticated uid after email confirmation; it rechecks phone OTP, consent, media moderation/promotion, structured origin requirements, placement, and refreshed waiver evidence, then invokes the waiver and records the final receipt. Expiry/revocation may stop an unclaimed invite; suspension/recovery governs an already claimed account.

Phase 0 made no migrations, Edge functions, web routes, payment code, deployments, or production changes. PR 1 subsequently implemented the approved pre-claim foundation in development only; it still makes no payment-code or production changes.
