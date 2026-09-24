# Drapeon lifecycle measurement plan

Status: V1 implementation contract
Registry: [`packages/shared/src/lifecycle-events.ts`](../packages/shared/src/lifecycle-events.ts)
Feedback contract: [`packages/shared/src/lifecycle-surveys.ts`](../packages/shared/src/lifecycle-surveys.ts)

This plan defines how Drapeon measures meaningful progress across customer and tailor journeys
without turning analytics into an operational ledger or a marketing contact database. The shared
registry is the machine-readable source for event names, versions, surfaces, ownership, consent
basis, allowed properties, retention, correlation, deduplication, and negative-case behavior.

## Source boundaries

- Supabase/Ops order, payment, payout, support, and delivery records remain authoritative for
  operational state.
- Consent history lives in `communication_consents`; current channel/category settings live in
  `communication_preferences`.
- Campaign audience snapshots, approvals, suppressions, schedules, and terminal delivery outcomes
  live in the communications control plane. Resend receives minimum delivery data only.
- Product analytics is optional and stays off until the user's analytics preference is known and
  explicitly granted. Required operational events are emitted only from their authoritative
  transition.
- Showcase, reviewer, and internal test identities are excluded from commercial conversion metrics
  by one canonical eligibility rule; do not filter them ad hoc in dashboards.

## Funnel stages

### Customer

`awareness → discovery → consideration → readiness → intent → purchase → retention → advocacy`

Measure public engagement, tailor/profile views, saves, first conversations, fit-profile completion,
custom or ready-made order intent, provider-confirmed payment, terminal order completion, and
referral sharing. A view, click, queued payment, or draft is not a completed conversion.

### Tailor

`supply application → profile live → portfolio complete → ready-made supply → first order → payout readiness`

Measure an accepted application, profile-live eligibility, approved portfolio completion, a
publicly orderable ready-made item, a terminal first order, and provider-confirmed payout
eligibility. Missing or rejected media is a quality failure, not supply conversion.

### Education and feedback

Measure guide start/completion and permitted survey submission separately from commercial funnels.
Survey eligibility, suppression names, response limits, and score thresholds are defined by the
feedback contract. The private `survey_responses` table and `submit-survey` Edge Function are the
server-owned persistence/routing boundary; comments never enter analytics, and negative responses
create a deduplicated Ops follow-up. Eligibility is scheduled separately in the private
`survey_invites` table: order completion creates the customer invite, a resolved support case
creates the support invite, and a provider-confirmed first order payout creates the tailor invite.
These database triggers are fail-open and idempotent, and record availability (`24h` after
completion, `2h` after support resolution) without sending email. A reviewed delivery worker must
still own consent, suppression, expiry, and Resend delivery; successful submission closes its
matching invite without exposing the private response to analytics.
Guide views are not conversions. CSAT is one response per permitted subject and negative feedback
must route to support/Ops rather than being hidden in a dashboard.

## Event contract

Every registry entry must include:

- stable event name and version;
- purpose (`CONVERSION`, `EDUCATION`, or `FEEDBACK`) and source (`UI_ANALYTICS` or
  `AUTHORITATIVE_OPERATIONAL`);
- applicable surface, route, actor role, stage, exact trigger, and terminal success/failure
  semantics;
- normalized attribution fields (`utm_*`, `ref`, or approved hashed referral ID) with the
  campaign/referral expiry policy applied before emission;
- an allow-list of properties, sensitivity class, retention, consent basis, destination metric,
  correlation ID, deduplication key, sampling rate, and explicit negative-case behavior.

Allowed values are deliberately coarse where the underlying data is sensitive: use hashed or
bucketed IDs/counts and currency where policy permits. Never send addresses, measurements, trust
videos, private media, message bodies, payment details, credentials, or auth/recovery tokens.

## Conversion and consent QA

For each event, test a real happy path and a negative/recovery path on every applicable surface:

- event is emitted only after the stated trigger, in the stated order;
- duplicate callbacks or re-entry produce one event using the declared deduplication key;
- failed, cancelled, blocked, expired, unavailable, or incomplete states do not emit success;
- attribution is normalized and expires as documented;
- analytics is silent before opt-in, while required operational records still work;
- payload inspection confirms no forbidden property or raw identifier is present;
- provider and Ops outcomes are checked separately from product analytics.

The release evidence bundle links the registry version, commit SHA, environment, surface, route,
sanitized payload inspection, and happy/negative proof. A dashboard screenshot alone is not proof of
the underlying event contract.

### Eligibility scheduling QA

The invite scheduler has its own required happy and negative traces before a delivery worker is
enabled:

- Complete an order once and confirm one pending customer invite with a 24-hour `available_at`;
  repeat the completion callback and confirm the same idempotency key, not a second invite.
- Resolve a support case and confirm one pending case invite with a two-hour `available_at`;
  reopen/re-resolve and confirm no duplicate invite for the same case.
- Confirm a provider-backed first-order payout and verify the tailor invite is created only for
  the earliest completed order and only for `ORDER_EARNING`/`SETTLEMENT_TRANCHE` payouts.
- Prove that failed, blocked, reversed, tip, consultation, material, incomplete, disputed, or
  incident-held states never deliver a survey; the delivery worker must re-check suppression at
  send time, and a scheduler/storage error must not roll back the source transition.
- Before delivery is enabled, inspect the private row and verify it contains no email address,
  message body, measurements, payment details, or raw analytics properties.

These checks are server-side contract evidence only until a reviewed delivery worker, consent
decision, UI, provider outcome, and headed web/iOS/Android replay are linked to the release bundle.

## Ownership and review

- Product owns event meaning and funnel definitions.
- Engineering owns emission, allow-list enforcement, deduplication, and versioning.
- Privacy/Ops owns consent, retention, showcase exclusion, and incident review.
- Growth may use approved aggregates and campaign outcomes, but may not create a parallel contact
  list or reinterpret operational state.

Review the registry before adding an event, after a material funnel change, and at each release
disclosure audit. Retire an event by versioning and documenting its replacement; do not silently
reuse a name for a different meaning.
