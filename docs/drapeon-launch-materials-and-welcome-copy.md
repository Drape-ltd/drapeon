# Drapeon Launch Materials and Welcome Copy

Status: copy and content system for review
Owner: Drapeon product, brand, and operations
Source of truth: [Drapeon Brand, Relationship, and Lifecycle System](/Users/onaopemipodimowo/Documents/Codex/2026-09-15/i-a/outputs/drapeon-brand-relationship-and-lifecycle-system.md)

This document turns the brand brief into usable customer, tailor, and launch-partner material.
It is a content specification, not a promise that every message or provider workflow is already
deployed. Product, payment, payout, privacy, safety, and release guardrails remain authoritative.

## 1. Voice and vocabulary

Use these words consistently:

| Concept | Preferred term | Avoid |
| --- | --- | --- |
| Person making or altering a garment | tailor | seller, maker, vendor (unless a legal/provider context requires it) |
| Finished non-custom item | ready-made piece | product drop, inventory, merch |
| Customer's saved fit information | fit profile | body data, measurements profile (unless explaining a field) |
| Shared progress record | order timeline | tracking feed, ticket |
| Drapeon-mediated resolution | support review | guarantee, automatic refund |

Voice is calm, specific, warm, and useful. Do not use urgency theatre, unsupported guarantees,
all-caps pressure, or private details in marketing copy. Say what happens next, who owns it, and
where the customer or tailor can recover when something changes.

## 2. Welcome sequence

The existing role-specific contract in `packages/shared/src/lifecycle-welcome.ts` is the canonical
copy source. The email renderer, web preview, app inbox, and any future provider template must use
the same `templateKey`, CTA destination, and idempotency key.

### Customer

**Immediate — `WELCOME_CUSTOMER_V1`**

- Subject: Welcome to Drapeon
- Eyebrow: Welcome to Drapeon
- Headline: Find work worth wearing.
- Body: Discover trusted tailors, keep the conversation together, and move from idea to garment
  with a clear record of every step.
- CTA: Explore Drapeon → `/explore` (app: `drape://`)

**Next step — `WELCOME_CUSTOMER_NEXT_STEP_V1` (two days later)**

- Subject: Make your fit yours
- Eyebrow: Your next step
- Headline: A better fit starts with your profile.
- Body: Save the fit details and preferences you want to reuse, then return to the tailors and
  pieces that feel right for you.
- CTA: Complete your fit profile → `/account/measurements` (app:
  `drape://profile/measurements`)

The customer sequence should explain discovery, fit context, conversations, order stages, and
support without implying that a tailor is an employee of Drapeon. A customer can browse without
buying, and a welcome email never opts them into marketing.

### Tailor

**Immediate — `WELCOME_TAILOR_V1`**

- Subject: Welcome to Drapeon, tailor
- Eyebrow: Welcome to Drapeon
- Headline: Let your work find its people.
- Body: Build a clear profile, show the work you are proud of, and keep customer conversations,
  orders, and earnings together.
- CTA: Open your tailor profile → `/account/profile?setup=1` (app:
  `drape://profile/setup`)

**Next step — `WELCOME_TAILOR_NEXT_STEP_V1` (two days later)**

- Subject: Make your Drapeon profile ready
- Eyebrow: Your next step
- Headline: Show the craft behind the name.
- Body: Add approved portfolio media, your services, and at least one ready-made piece when you
  are ready to be discovered.
- CTA: Continue tailor setup → `/account/profile?setup=1` (app: `drape://profile/setup`)

The tailor sequence must make the relationship clear: Drapeon provides discovery, structured
orders, communication, support review, and payout rails; the tailor owns their craft, availability,
quoted work, and customer commitments. Payout copy must describe eligibility and release state,
not promise an instant transfer.

### Delivery and consent rules

1. The account/auth system is the source of truth for the user's email. Resend is a delivery
   provider and suppression ledger, not the marketing consent database.
2. Welcome and security/order messages are transactional. They may be sent to an account email
   without marketing consent, with a working support/preferences path.
3. A marketing audience/contact is created or synchronized only after explicit channel consent
   and an eligible topic is selected. Never infer marketing consent from account creation,
   checkout, a survey response, or a welcome-email open.
4. Queue each `(userId, role, step)` once using the shared `welcomeIdempotencyKey()` contract,
   whose value is `welcome:{role}:{userId}:{step}`. Retries must be idempotent and must record
   provider terminal outcomes without duplicating customer mail. The current webhook passes this
   key to Resend's `Idempotency-Key` header and carries the canonical template key in
   `X-Drapeon-Template-Key` for safe provider correlation. A separate signed Resend/Svix webhook
   records only the provider event ID, Resend email ID, outcome, safe reason code, and event time;
   it intentionally does not retain recipient addresses, sender addresses, subjects, bodies,
   opens, or clicks. A delivery delay is an operational warning, not a final delivery outcome;
   a later signed provider event is required to settle it. These are provider boundaries, not a
   replacement for a durable delivery ledger or suppression rules. Provider acceptance is not
   delivery proof.
5. Links must be origin-correct for web and app, use the canonical Drapeon sender, and never put
   passwords, auth tokens, measurements, payment details, or private media into the URL. Never put
   passwords, auth tokens, recovery codes, or other credentials into welcome content or links.
6. Greet a recipient by a verified account display name only. Normalize whitespace, bound the value
   before rendering, and use the neutral fallback “there” when no account name is available. Never
   infer a personal name from an OAuth provider, a marketing list, or an unverified profile field.

### Resend delivery-event activation and rollback

The Dev path is configured and enabled. Repeat the same evidence on production only in an approved
promotion; never copy a Dev signing secret into production:

1. Set `RESEND_WEBHOOK_SECRET` in the matching Supabase project. It must be the `whsec_…` signing
   secret generated by Resend for this endpoint; do not put it in a browser, app build, or source
   file. The Dev secret has been set in its encrypted Edge Function secret store.
2. Deploy the email-provider-event migration and the `resend-email-webhook` Edge Function. Both
   are deployed in Dev.
3. In Resend, add only this endpoint for the matching project:
   `https://<supabase-project-ref>.supabase.co/functions/v1/resend-email-webhook`.
   Subscribe to `email.delivered`, `email.bounced`, `email.complained`, `email.failed`,
   `email.suppressed`, and `email.delivery_delayed`. Do not enable open or click events for this
   operations ledger.
4. Send one seeded application-owned transactional test and use Resend’s signed test event (or its
   live terminal event) to prove the `email_provider_events` row and matched
   `notification_delivery_outcomes` transition. Capture the provider event ID and safe status, not
   an address, subject, or body. Dev has already proven a real Auth new-device email reaches Gmail
   and records a signed provider delivery, but Auth-provider messages intentionally have no
   Drapeon application notification-outcome row to transition.
5. Replay the same signed event to prove idempotency, then submit a deliberately altered signature
   to prove rejection. Attach the headed browser/email-client and relevant web/iOS/Android evidence
   to the release bundle before promotion.

If the endpoint misbehaves, first remove or pause the Resend webhook subscription. The send path
continues to record `ACCEPTED`; it must never be relabeled as delivered without a verified provider
event. Roll back by disabling the endpoint/subscription, preserving the append-only event ledger for
investigation, and raising an operational incident rather than deleting delivery evidence.

## 3. Supporting launch materials

### Customer-facing pages and modules

- **Welcome/setup:** what Drapeon protects, how to choose a tailor or ready-made piece, and how
  to complete a fit profile without over-collecting data.
- **FAQ:** how discovery, briefs, quotes, payment state, order timeline, support review, refunds,
  and tailor verification work. Keep the current public FAQ aligned with this vocabulary.
- **Fit and measurement guide:** preparation, privacy, versioning, re-confirmation before an
  order, and what to do when fit changes.
- **Order timeline guide:** quote → payment → consultation/sourcing (if applicable) → approval →
  making → finishing → delivery/pickup → receipt → support/review.
- **Refunds, returns, and aftercare:** explain stage-dependent remedies and the support-review
  path; do not write blanket guarantees that policy cannot honor.
- **Support, safety, and privacy:** how to report a concern, request help, manage communication
  topics, export/delete an account, and distinguish transactional from marketing messages.
- **Ready-made guide:** fit information, availability, delivery/pickup, returns, and how a
  ready-made order differs from a custom brief.

### Tailor-facing pages and modules

- **Welcome/application:** what a public profile requires, what verification means, and what it
  does not guarantee.
- **Profile-ready checklist:** name, location, services, response expectations, portfolio media,
  languages/accessibility, delivery/pickup options, and a clear cancellation/support path.
- **Photography and media guide:** minimum approved portfolio set, crop/ratio, lighting,
  background, alt text, ownership/permission, and what happens when a media URL fails.
- **Custom and ready-made setup:** explain the difference between a structured custom brief and a
  ready-made listing, with separate availability, price, and fulfilment expectations.
- **Order-stage communication:** what each stage means, when to raise a delay or cancellation
  review, and how the shared timeline protects both sides.
- **Stripe Connect and payout guide:** onboarding, eligibility, protected/in-progress funds,
  release state, failed payout recovery, and who to contact; avoid “paid instantly” language.
- **Safety, reporting, and disputes:** prohibited conduct, chat/report choices, evidence handling,
  customer concerns, and the remedy ladder.

### Studio and launch-partner kit

Provide a short, reusable kit for a product-launch studio or partner:

- one-sentence positioning and pronunciation note;
- approved wordmark, app icon, favicon, social avatar, and image/alt-text rules;
- customer and tailor one-page explainers;
- a demo order timeline using seeded, non-production data;
- approved screenshots/video with commit, build, and environment labels;
- launch FAQ, support contact, privacy/consent explanation, and escalation owner;
- a claims checklist: no unverified turnaround, availability, payment, safety, or refund claims.

## 4. Measurement, conversion, and surveys

The event registry is the only conversion vocabulary. Marketing and product teams may report on
these events, but the order/payment system remains the authority for actual completion:

| Outcome | Event or authority | Minimum safe fields |
| --- | --- | --- |
| Guide helped someone start | `guide_started` | guide key, role, surface |
| Customer showed custom intent | `custom_order_intent` | entry surface, role, tailor context bucket |
| Tailor applied | `tailor_application_submitted` | entry surface, application kind, portfolio count bucket |
| Waitlist joined | `waitlist_joined` | role, entry surface |
| Ready-made purchase | authoritative paid order | order id/reference in restricted systems; no payment detail in analytics |
| Order completed | authoritative order completion | order reference in restricted systems |

Only allow-listed, consented, sanitized fields may leave the client. Never include email,
measurements, messages, private media, addresses, payment credentials, or auth/recovery tokens.
Marketing reports should separate acquisition, activation, order completion, repeat use, and
support outcomes; do not call an email open or update view a conversion.

Surveys are feedback instruments, not a second support or order system:

- invite a short, optional CSAT after delivery/receipt and after a support case closes;
- ask one rating plus an optional free-text reason, with an explicit “contact support” route;
- suppress duplicates per order and cooldown repeated requests;
- route low scores to support review without promising a remedy automatically;
- aggregate themes only after removing direct identifiers and sensitive order details;
- keep survey participation separate from marketing consent and never require it to continue an
  order, receive a payout, or access the account.

## 5. Topics and analytics boundary

Marketing topics are explicit and reversible: Drapeon Stories, New Tailor Drops, Ready-made Edits,
and Launch Events. Each topic has role/channel eligibility, a visible preference control, and a
provider alias. A user can withdraw a channel without losing transactional order, security, or
support mail.

Microsoft Clarity remains deferred for V1. Do not add its script, cookies, CSP entries, or session
replay. If a future decision approves it, add a consent banner and vendor disclosure first,
restrict it to public marketing routes, mask aggressively, and repeat the full browser/device
proof matrix before activation. Public funnel events and support outcomes are the current,
lower-risk measurement priority.

## 6. Content QA and release gate

Before publishing a material or template:

- verify customer and tailor wording against the vocabulary table and shared welcome contract;
- render web, iOS, Android, and email variants where the material is used;
- exercise a happy path and a negative/recovery path (missing media, denied consent, expired link,
  unavailable payout, blocked delivery, and duplicate trigger where relevant);
- inspect desktop and mobile layouts, dark mode, focus/VoiceOver/TalkBack labels, alt text, and
  reduced-motion behavior;
- confirm CTA origin, role targeting, consent state, idempotency key, and sanitized telemetry;
- attach headed-browser screenshots/trace and native recordings to
  `evidence/<releaseSha>/<surface>/<flow>/` for applicable UI/backend changes;
- record provider terminal outcome for email, push, or SMS changes;
- name the owner, known limitation, rollback/recovery path, and next review date.

The completed production-delivery guardrails and the linked brand/lifecycle brief remain the
promotion authority. Copy approval alone is not release proof.

## 7. Long-term product direction: Drapeon as the operating system for independent fashion

This is a forward-looking product direction, not a launch commitment. The near-term product
should first prove that discovery, briefs, orders, timelines, communication, payment state, and
tailor payouts are reliable. Later capabilities should deepen that same record of work instead of
creating disconnected tools.

### Tailor operating system

Drapeon should make the tailor's day easier and more controlled:

- a profile and portfolio that turns craft into discoverable, trustworthy work;
- structured custom briefs and ready-made listings with clear availability and fulfilment rules;
- one order timeline for customer decisions, measurements, approvals, making, delivery, and
  support review;
- reusable fit and preference context, customer communication, quote/version history, and
  operational reminders;
- payout eligibility, release state, failed-payout recovery, and financial records that are easy
  to understand;
- later, studio-level tools for workload, team access, repeat customers, campaigns, and
  performance insights.

The product should charge for additional software value before it charges for basic visibility or
transaction access. Possible future offerings include an optional Tailor Pro workspace, campaign
tools, paid but clearly labeled promotion, and access to vetted production partners. Paid placement
must never override verification, safety, or quality signals.

### Customer return loop

Customers should return because Drapeon remembers useful context and makes the next decision
easier—not because it manufactures urgency. Candidate loops to validate after real orders include:

- a reusable fit profile with customer-controlled edits and re-confirmation before an order;
- saved tailors, collections, fabrics, silhouettes, and ready-made pieces;
- a meaningful order timeline and aftercare record that makes the garment feel like part of an
  ongoing wardrobe, not a one-off transaction;
- post-delivery fit feedback, alteration help, repair/aftercare guidance, and optional reminders;
- seasonal discovery based on explicit interests, not inferred sensitive attributes;
- referrals and shared work stories that respect the tailor's ownership and the customer's privacy;
- later, opt-in virtual try-on or outfit visualization, clearly labeled as visualization rather than
  a fit guarantee.

Retention hypotheses must be measured against repeat discovery, repeat inquiry, repeat order,
saved-fit reuse, completed aftercare, and customer-reported confidence. Email opens, push opens,
and time in app are supporting signals only; they are not proof that the customer received value.

### Ecosystem expansion, in sequence

1. **Reliable marketplace:** prove discovery, order completion, support review, and payout release.
2. **Tailor workspace:** add the operational tools tailors use repeatedly between orders.
3. **Customer wardrobe loop:** make fit, care, alterations, and repeat discovery genuinely useful.
4. **Services network:** introduce vetted alterations, manufacturers, fabric suppliers, and other
   specialists as reviewed referrals before taking responsibility for their fulfilment.
5. **Platform ecosystem:** offer subscriptions, campaigns, partner access, and workflow APIs once
   the underlying order and trust data is mature.

Do not build every layer at once. Q4 learning should establish which problems recur, which records
tailors maintain outside Drapeon, why customers return, and where support or payout friction appears.
Those observations—not a feature checklist—should determine the next investment.
