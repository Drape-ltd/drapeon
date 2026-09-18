# Drapeon launch materials and welcome copy

Status: canonical launch copy contract
Owners: Product, Brand, Lifecycle, Support

This document records the four account-welcome templates used by the shared
lifecycle contract. The copy is intentionally useful, role-specific, and
quiet: it helps a new customer or tailor take the next product action without
pretending that a marketing programme is already running.

The shared `welcomeIdempotencyKey` binds each role/step to one durable queue
job, so retries cannot send a second welcome message.

## Customer sequence

### `WELCOME_CUSTOMER_V1`

- Subject: Welcome to Drapeon
- Eyebrow: Welcome to Drapeon
- Headline: Find work worth wearing.
- Body: Discover trusted tailors, keep the conversation together, and move from idea to garment with a clear record of every step.
- CTA: Explore Drapeon → `/explore` (web) or `drape://` (app)

### `WELCOME_CUSTOMER_NEXT_STEP_V1`

- Subject: Make your fit yours
- Eyebrow: Your next step
- Headline: A better fit starts with your profile.
- Body: Save the fit details and preferences you want to reuse, then return to the tailors and pieces that feel right for you.
- CTA: Complete your fit profile → `/account/measurements` (web) or `drape://profile/measurements` (app)

## Tailor sequence

### `WELCOME_TAILOR_V1`

- Subject: Welcome to Drapeon, tailor
- Eyebrow: Welcome to Drapeon
- Headline: Let your work find its people.
- Body: Build a clear profile, show the work you are proud of, and keep customer conversations, orders, and earnings together.
- CTA: Open your tailor profile → `/account/profile?setup=1` (web) or `drape://profile/setup` (app)

### `WELCOME_TAILOR_NEXT_STEP_V1`

- Subject: Make your Drapeon profile ready
- Eyebrow: Your next step
- Headline: Show the craft behind the name.
- Body: Add approved portfolio media, your services, and at least one ready-made piece when you are ready to be discovered.
- CTA: Continue tailor setup → `/account/profile?setup=1` (web) or `drape://profile/setup` (app)

## Delivery and consent boundaries

- Resend is a delivery provider, not the source of truth for account creation,
  consent, inbox state, or order state.
- Welcome mail is account lifecycle communication. It is not a promotion and
  is not blocked by optional marketing preferences.
- Promotions and product updates require an explicit per-channel marketing consent.
  The suppression ledger wins over an optional send.
- The Resend webhook stores only redacted delivery metadata and recipient
  hashes. It never stores subjects, message bodies, full addresses, passwords, auth tokens, recovery codes, or provider secrets.
- Provider `ACCEPTED` means Resend accepted the request. `DELIVERED` is claimed
  only after a verified `email.delivered` event. Bounces, complaints, failed,
  and suppressed events create an optional-email suppression.
- Every CTA is an exact Drapeon context, with no generic homepage fallback.

## What is intentionally not in this launch sequence

Surveys, promotions, and product-news campaigns are separate lifecycle
programmes. They must use the communications control plane, audience snapshot,
explicit consent, reviewed template version, and delivery measurement before
they are enabled.
