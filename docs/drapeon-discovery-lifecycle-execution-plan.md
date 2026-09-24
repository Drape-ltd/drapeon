# Drapeon discovery and lifecycle execution plan

Status: active implementation plan
Source of truth: `drapeon-brand-relationship-and-lifecycle-system.md`
Guardrails: the completed production-delivery guardrails remain authoritative.

This plan turns the discovery feedback from tailor onboarding into a serial delivery plan. It
does not authorize production promotion, provider changes, migrations, or a native build. Each
lane must close its contract, runtime behavior, negative path, and visual evidence before the
next lane starts.

## What we are solving

### Customer discovery

- Share a public tailor profile from web and mobile.
- Make it obvious that portfolio work opens full-screen; preserve keyboard, screen-reader, and
  reduced-motion behavior.
- Keep the existing order-gated messaging rule. Customers can discover and save a tailor without
  opening an unbounded conversation; messaging remains available through the approved order path.
- Keep portfolio media—not a personal avatar—as the primary public proof when approved portfolio
  media exists.

### Tailor relationship

- Keep tailor profiles useful after launch: portfolio maintenance, availability, readiness, and
  response nudges are lifecycle moments, not generic blasts.
- A tailor can share their own profile, but the share action must never expose private contact
  details, draft media, trust-video material, or payout data.
- Currency, payout, profile, and trust state remain separate facts. A profile save must not be
  presented as a completed trust or payout setup.

### Lifecycle and growth

- Existing customer and tailor welcome messages stay in place; do not rebuild them.
- Customer “new tailor” messages use the existing `NEW_TAILOR_DROPS` topic and explicit consent.
  Start with a curated or matched digest, not an every-profile broadcast.
- Tailor reminders use the existing activity/readiness nudges and durable cooldowns; portfolio
  updates should be helpful prompts, not pressure.
- Surveys/CSAT come after a meaningful order milestone (completion or supported recovery), are
  optional, idempotent, and never block payout, review, or support.
- Microsoft Clarity remains deferred in V1. If replay is reconsidered, it needs a new privacy
  decision, consent boundary, CSP review, masking rules, and updated store disclosures.

## Delivery lanes and honest progress

Percentages describe implementation plus proof, not confidence or release readiness.

| Lane | Progress | Owner group | Definition of done |
| --- | ---: | --- | --- |
| 1. Profile discovery | 100% | Web + Mobile + Product design | Share action, portfolio-expand cue, public-media-first presentation, accessible dialog, happy/negative tests, headed web proof, and Android/iOS replay are complete. Both native surfaces have interrupted-setup recovery evidence; Android and iOS have actionable security-network failure plus successful Retry proof. |
| 2. Lifecycle contract | 100% | Lifecycle/CRM + Product + Privacy | Welcome remains stable; new-tailor eligibility, topic consent, frequency cap, audience snapshot, unsubscribe behavior, and suppression cases are written and tested. The two audience/role migrations are applied and recorded in Drape-DEV, the onboarding state-matrix readback is recorded, and signed provider receipt plus suppression fixtures are attached. The linked Dev linter still reports pre-existing schema errors; local Docker rehearsal is unavailable because Docker is not installed. |
| 3. Tailor maintenance | 35% | Backend + Tailor product + Ops | Activity/readiness nudges cover portfolio, availability, and payout setup with dedupe/cooldown; no duplicate email/push; tailor can pause non-required messages. Existing activity/readiness functions are the baseline. |
| 4. Conversion measurement | 35% | Data/analytics + Web + Mobile | Registry event, allow-listed payload, consent gate, idempotency/dedupe, funnel dashboard/query, and negative-path proof for profile view → share → save → brief/order intent. |
| 5. Surveys/CSAT | 15% | Research/Support + Lifecycle + Privacy | Completion-triggered eligibility, one response per order/version, private storage, redaction, aggregation, support routing, and suppressed/duplicate/offline tests. |
| 6. Order timeline and settlement | 20% | Payments + Ops + Backend | Customer and tailor see the same authoritative order stages, completion, provider hold, and payout release; callbacks are idempotent and reconciliation is visible to Ops. |
| 7. Launch materials | 35% | Brand/Content + Support + Partnerships | Customer and tailor welcome/help copy, sizing/measurement guidance, policies, FAQ, studio launch kit, support escalation, and app-store copy are reviewed and versioned. |

No lane percentage increases until its evidence links are recorded.

## Parties and responsibilities

- **Product/Founder:** approves audience, frequency, order-gate policy, and launch trade-offs.
- **Web:** public profile/share UX, portfolio dialog, deep links, analytics consent, and browser
  proof.
- **Mobile:** native share sheet, portfolio viewer, local setup persistence, deep-link return, and
  Android/iOS proof.
- **Backend/Supabase:** topic consent, audience snapshots, idempotency, delivery jobs, currency and
  profile sequencing, provider callbacks, and safe server-side telemetry.
- **Lifecycle/CRM:** welcome ownership, new-tailor digest, tailor nudges, survey timing, Resend
  templates, suppression, and delivery webhooks.
- **Ops/Trust:** profile/media approval, manual exception records, alert routing, payout readiness,
  and incident/reconciliation response.
- **Data/Analytics:** registry ownership, conversion definitions, consent enforcement, dashboards,
  and retention limits.
- **Brand/Content/Support:** voice, policies, customer/tailor education, help articles, and human
  escalation paths.
- **Privacy/Legal:** consent language, retention, survey/replay review, vendor disclosures, and
  jurisdiction-specific marketing rules.
- **QA/Release:** evidence bundle, regression matrix, store-build checks, rollback capsule, and
  promotion approval.

## Test plan for every lane

### Happy paths

1. Anonymous visitor opens a public tailor profile with approved portfolio media.
2. Visitor expands a portfolio item, navigates previous/next, closes it, and returns focus to the
   originating tile.
3. Visitor shares from web (native share where supported, clipboard fallback otherwise) and from
   mobile; the link opens the same public profile.
4. Customer saves a tailor, starts the permitted brief/order path, and sees no unsolicited message
   surface before the gate.
5. Consented customer receives a relevant new-tailor digest; opted-out customer receives none.
6. Tailor receives one maintenance nudge, updates the portfolio, and does not receive a duplicate
   within the cooldown window.
7. Completed order becomes eligible for one survey; response is stored privately and appears only
   in an aggregated Ops view.

### Negative and recovery paths

- Missing, blocked, or failed portfolio media shows the approved fallback; no broken-image wall or
  false conversion event.
- Clipboard/native share unavailable, cancelled, or interrupted leaves the profile usable and gives
  a truthful retry affordance.
- Private/draft/unapproved tailor, expired profile, or missing ID returns a safe not-found state.
- Analytics denied or unknown means no lifecycle event; private routes never emit public conversion
  events.
- Duplicate share, save, welcome, nudge, campaign, webhook, or survey submission is idempotent.
- Stale mobile setup resumes without losing the recorded trust video; currency failure is retryable
  and does not claim trust/payout completion.
- Messaging is blocked before the required order context and remains available after the approved
  gate.
- Provider timeout, offline device, 401/403 session, and rate limit produce actionable copy and a
  recoverable state—not a generic “weak connection” diagnosis.

### Evidence required before promotion

- Focused unit/contract tests for shared event, consent, idempotency, currency, media, and survey
  rules.
- Headed browser replay at desktop and mobile widths for every changed web path, with screenshots or
  trace linked to the commit.
- Android and iOS replay for every changed native path; if a device/simulator is unavailable, mark
  the lane unverified rather than substituting a typecheck.
- Provider terminal evidence for email/push/webhook changes, including duplicate and failure cases.
- Ops evidence for moderation, suppression, alert routing, and manual exceptions.
- `git diff --check`, web/mobile typecheck, focused lint, and the applicable release-contract guard.

## Onboarding-specific closeout

These are the onboarding changes learned from the Nigerian tailor session. They are intentionally
limited to native proof, Dev database rehearsal, and provider evidence; branding work is outside
this closeout.

### 1. Native proof — Lane 1 (100%)

- Replay profile sharing, portfolio expansion/full-screen viewing, local-currency plus USD estimate
  presentation, and deep-link return on Android and iOS. Happy-path captures are recorded for both
  platforms; Android captures are `/private/tmp/drape-android-profile-clean9.png`,
  `/private/tmp/drape-android-portfolio-viewer.png`, and
  `/private/tmp/drape-android-share-sheet3.png`, while iOS captures remain recorded in the evidence
  file.
- Interrupted setup recovery is captured on both platforms. iOS restored identity values, profile
  image, and a synthetic sandbox-only trust-video URI/content type/consent state after process
  termination and reauthentication. Android restored the exact phone, location, and
  114-character bio after a force-stop, cold start, and reauthentication of the same Dev account.
- Android's invalid-proxy replay and iOS's deterministic native `-1003` mapper replay both show the
  actionable Wi-Fi/mobile-data copy and recover through the real Retry control to
  `Security check complete`.
- The screenshots and exact artifact paths are recorded in
  `docs/onboarding-closeout-evidence-2026-09-20.md` and preserved under
  `evidence/64254f832c5bae013db9bfd1b94ab5d40cf1bbcd/native-lane-1/`. No production data or
  configuration was used.

### 2. Lifecycle database rehearsal — Lane 2 (100%)

- Local Postgres remains unavailable because Docker is not installed, so the rehearsal used the
  authenticated linked Dev project and is explicitly marked as a linked-Dev rehearsal.
  Dev-only schema lint completed and the pending audience/role migrations were applied and
  verified in Dev migration history:
  `20260920100000_guard_new_tailor_drop_audiences.sql` and
  `20260920113000_harden_marketing_recipient_role_lookup.sql`.
- The linked Dev linter surfaced pre-existing findings (the `extensions.index_advisor`
  `hypopg_reset()` error and the `public.update_account_currency_with_price_conversion` text/UUID
  mismatch, plus existing warnings). These are recorded as separate database debt; they did not
  block the two reviewed migration applications.
- Exercise the onboarding state matrix: saved profile, submitted trust video, approved trust,
  payout provider ready, and each partial/failure combination. The Dev readback now shows the
  expected complete/verified/trust-video, incomplete/not-submitted, and profile-complete/pending
  combinations without changing any rows. It also confirms that the NGN profile-price currency
  can remain separate from the default USD payout currency until a payout destination is ready.
- Confirm NGN is stored as the tailor's account/profile currency, a failed currency lock is
  retryable, and a profile save cannot make the tailor publicly live or payout-ready by itself.
- Verify explicit customer IDs, canonical `public.users.role`, fail-closed behavior, and no
  role-wide new-tailor broadcast. Do not touch Production from this rehearsal.
- Record SQL/readback evidence and migration identifiers in the release evidence bundle.
- The completed rehearsal record is preserved at
  `evidence/64254f832c5bae013db9bfd1b94ab5d40cf1bbcd/dev-database-rehearsal.json`.

### 3. Provider evidence — complete

- Run a sandboxed Resend delivery/webhook rehearsal for welcome, tailor-maintenance, and new-tailor
  eligibility events; capture terminal outcomes for success, duplicate, suppression, and provider
  failure cases.
- Confirm correlation/idempotency keys, unsubscribe/topic suppression, and the distinction between
  profile-saved, trust-approved, and payout-ready lifecycle triggers.
- Keep real customer campaigns disabled. No production blast is part of this closeout.
- Local provider safeguards are green: the delivery-webhook contract, the signed receipt fixture,
  the suppression fixture, and nine focused Resend/account-email/durable-job tests pass. The fixture proves an active
  `communication_suppressions` row returns `SKIPPED/PREFERENCE_DISABLED` before the provider is
  contacted. With explicit authorization, one internal Dev verification probe was accepted by
  Resend (`01a0c1ac-fa04-742b-85e8-79314a736bc4`); replaying the same key returned
  `deduplicated: true`. No customer campaign was sent. The headed Resend dashboard also shows
  the configured production webhook receiving a signed delivery event with HTTP 200 and
  `{ "ok": true, "processed": true }`. The newly authorized probe has no matching Dev
  provider-event row because the configured Resend subscription points at the production
  endpoint (historical Dev receipt rows remain intact); that environment boundary stays explicit
  rather than being presented as a Dev receipt.
- The linked Dev function was rechecked on 2026-09-21: `resend-email-webhook` is `ACTIVE` at
  version 3, and an unsigned, non-mutating POST was rejected with HTTP 401 before persistence.
  This remote negative-path proof is preserved in
  `evidence/64254f832c5bae013db9bfd1b94ab5d40cf1bbcd/provider/dev-endpoint-negative-probe.json`.

## Immediate sequence

1. Lane 1 is closed at 100% for the current implementation. Preserve its headed web, iOS, and
   Android artifacts in the release evidence bundle and reopen the lane if any covered surface
   changes.
2. Rehearse the onboarding state matrix against the now-migrated Dev project and attach SQL/readback
   evidence; do not touch Production.
3. Add/verify share conversion telemetry only after its event contract and consent test exist.
4. Keep the signed receipt and suppression fixture attached to the provider evidence bundle. A
   live Dev Resend endpoint may be configured later, but it is not required to claim completion of
   the privacy-minimized signed contract receipt. Welcome and customer campaigns remain untouched.
5. Design surveys/CSAT and order-timeline work after the first two lanes have evidence.

Production remains unchanged until the explicit promotion instruction is given.

## Current implementation notes

- Profile sharing and portfolio expansion are implemented in the web and mobile profile surfaces.
- Public web Explore/profile prices now keep the tailor's local currency primary and show a
  clearly-labelled USD reference estimate when the source currency is known; the estimate is never
  used for checkout, order, payout, or ledger calculations. The estimate is intentionally
  higher-contrast and semibold so it is discoverable without competing with the local price.
- Tailor mobile setup drafts now retain a sandboxed local trust-video copy and content type
  alongside the existing profile, pricing, portfolio, fulfillment, and consent fields. This
  prevents a process restart or cache eviction between recording and the signed upload from
  silently discarding the handoff. The private video remains submitted through the existing signed
  Supabase storage flow and the sandbox copy is deleted after successful setup. Native
  restart/recovery replay now passes on iOS, while Android process-death recovery passes for the
  broader identity draft.
- Web Turnstile script-load failures now distinguish an offline browser from a reachable network
  that cannot reach the security service, with an actionable Wi-Fi/mobile-data retry message.
  Android maps WebView `-5`/proxy failures and iOS maps native `-1003`, `-1004`, and
  `cannot connect` failures to the same actionable recovery family.
- Lane 1 is now 100% for the current implementation: mobile typecheck passes, focused lint has no
  errors (existing setup warnings remain), headed web proof is attached, both native happy paths
  are attached, both native interrupted-setup paths pass, and Android/iOS security failure plus
  successful Retry recovery are captured.
- Headed web proof and focused Playwright coverage confirm the NGN-first profile presentation,
  labelled USD estimate, share action, and portfolio expansion. Android/iOS happy-path,
  interrupted-setup recovery, and security Retry evidence are attached; Lane 1 has no remaining
  evidence item for the current implementation.
- Native share-link routing now includes the public `/tailors/:id` route and Android verified-link
  declarations for `drapeon.co` and `www.drapeon.co`, so an installed app can receive the same
  profile URL that the web fallback serves. The native public-profile route now exposes its own
  share action as well as the authenticated customer profile action. It also mirrors the customer
  profile's local-currency price with a clearly-labelled viewer-currency estimate and keeps the
  local range as supporting context. Android association proof still requires the production Play
  signing fingerprint and a release-signed build; the iOS Dev deep-link replay is recorded below.
- The first iOS deep-link replay found that the root `tailors` segment was missing from the mobile
  route guard's public allow-list. The guard now exempts `/tailors/:id` for signed-out and signed-in
  role redirects. Typecheck remains green, and the installed Dev build now opens the native public
  profile, portfolio viewer, and share sheet from the Drape custom scheme. Android happy-path proof
  and the Android security-network Retry recovery are captured on `drape_api35`; interrupted setup
  recovery and iOS security failure/Retry evidence are also captured, so Lane 1 closes at 100%.
- The iOS universal-link association now includes `/tailors/*` as well as payments. Android
  `assetlinks.json` still needs the production Play signing fingerprint before auto-verification
  can be claimed; the Android intent filters are present, and the local Dev deep-link replay is
  complete, but that association must be completed and replayed on a release-signed build.
- The new-tailor audience contract now requires explicit customer `user_ids` and rejects role-wide
  audiences in the shared contract test and the Dev-applied migration
  `20260920100000_guard_new_tailor_drop_audiences.sql`. It has not been pushed to Production.
- A follow-up Dev-applied migration,
  `20260920113000_harden_marketing_recipient_role_lookup.sql`, makes recipient filtering use the
  canonical `public.users.role` and fail closed when an account is missing or uninitialized; auth
  metadata is no longer treated as the audience authority.
- Shared lifecycle/marketing contracts pass under the workspace Node runtime (4 suites, 15 tests),
  and all eight local Playwright lifecycle preview checks pass (marketing topics, welcome, survey,
  and Ops privacy/routing states). The separate headed browser proof covers the public profile,
  portfolio cue, share action, and currency display. Database application and the read-only
  onboarding state-matrix readback are complete in Dev; production Resend receipt proof is now
  recorded, while a Dev-specific receipt remains an environment-bound follow-up. Web typecheck and
  `git diff --check` are clean for the touched surfaces. Local Supabase schema lint remains
  unavailable because no local Postgres instance is running; the linked Dev lint result is recorded
  above.
- Consent-gated conversion previews also pass (4/4): profile views require approved media,
  blocked order contexts emit nothing, and fit completion exposes only the sanitized event shape.
  Dashboard/real-provider evidence and native replay are still required before increasing the
  conversion lane or promoting it.
- Tailor-maintenance unit coverage is green (9/9): activity nudges stay live-profile-only,
  unfinished listings are prioritized, established-tailor recaps use real signals, and the
  cross-campaign cooldown plus payout-reminder cadence remain bounded and idempotency-friendly.
- Local Resend delivery safeguards are green (9/9): webhook signatures, content-minimal event
  mapping, template identity, provider correlation/idempotency, durable fallback behavior, and
  active suppression short-circuiting all pass with the provider request stubbed. The headed
  Resend dashboard shows a production webhook receipt answered with HTTP 200; no production
  configuration was changed here.
- The mobile lint contract now checks that the public `/tailors` route stays aligned across Android
  intent filters and the iOS universal-link association. It warns (without inventing a key) when
  Android `assetlinks.json` is absent; the production Play signing fingerprint remains the only
  missing input for that file.
