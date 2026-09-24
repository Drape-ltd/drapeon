# Signup Experience Rebuild — Plan

**Status:** proposed, not started
**Date:** 2026-09-16
**Scope:** tailor signup and studio setup on web, with customer signup and mobile parity
**Defects:** section 3. **Replay matrix:** section 10. **Decisions needed from the founder:** section 12.

---

## 1. Why this rebuild

A real tailor was walked through web signup and could not finish it without help. The observed
failures were not cosmetic:

- She signed up with Google and could never set a phone number. There is no path, not a hard one.
- She recorded her trust video on her phone; the laptop never acknowledged it until a manual refresh.
- She clicked the confirmation link in her email and got an error, although confirmation succeeded.
- She selected a profile photo, continued, and was told the photo was not saved.
- Her video was rejected with no usable explanation.
- Portfolio uploads gave no progress and no meaningful errors.
- She picked her address from the dropdown and it saved as "215, 215 Elm Street, …".
- She kept having to ask what fields meant, because several have no visible label and none explain
  why Drapeon is asking.

The root cause is structural, not decorative. Tailor signup is split across two independently
written implementations with different validation rules, different upload code, different error
vocabularies, and no shared notion of "what is left to do."

Fixing the copy will not fix this. The flow needs one owner, one state model, one error system, and
one upload component.

---

## 2. Target experience

Principles, in priority order:

1. **Nothing is a dead end.** Every blocked state names the next action and provides it in place.
2. **The system remembers.** Selecting a file saves it. Moving away keeps it. Nothing waits on a
   second click the user cannot be expected to know about.
3. **All requirements are visible at once.** A persistent checklist, not one error at a time.
4. **Errors are attached to the field they describe** and say what to do, not what failed.
5. **Rules appear before the work, not after it.** Video length, file types, and minimums are stated
   before recording or choosing.
6. **One device is enough, two devices are supported.** Recording on a phone while the laptop is
   open is the normal case, not the edge case.
7. **No question goes unanswered on screen.** Every field says what it is, whether it is required, and
   on request, why it is being asked and who can see it. A tailor should never need to ask a person.

The tailor's mental model should be: *four short steps, I can see what's left, and the page keeps up
with me.*

---

## 3. Blocking defects to fix first

These are correctness, not polish. Each has a confirmed root cause.

| # | Defect | Root cause | Fix |
|---|---|---|---|
| B1 | Google/Apple tailors can never set a phone | Phone change requires a password reauth proof (`account-app-surface.tsx:16971` → `issueWebReauthProof:3013`); OAuth users have no password | Adopt the mobile OTP path (`sendAccountPhoneOtp` / `verifyAccountPhoneOtp`). Require OTP always; require password reauth only when the account has a password identity |
| B2 | The phone "Update" link loops back to setup | `/account/settings` runs through `AccountRouteRuntime`, which force-redirects tailors with `profile_completed !== true` back to `?setup=1` (`account-route-runtime.tsx:392-395`) | Edit the phone inline inside the onboarding step. Never send an onboarding user to a route the runtime will bounce |
| B3 | The phone typed before OAuth is silently dropped | `oauth-signup-draft.ts` TTL is 15 minutes and browser-local | Persist the pending phone server-side with the signup intent, or re-ask for it inside onboarding with OTP. Never fail silently |
| B4 | Trust video not acknowledged until refresh | Realtime subscription and the 30s poll both sit inside an effect gated on the in-memory `session` (`account-app-surface.tsx:25652`, interval `:25681`); the ungated check only runs on mount and `visibilitychange` | Poll and subscribe on `userId` alone, unconditionally while status is not terminal. Add an explicit "I've recorded it — check now" button. Persist the handoff session so a reload keeps the QR code |
| B5 | Confirmation email link errors | `exchangeCodeForSession` needs the PKCE verifier from the originating browser (`auth-callback-client.tsx:161`); opening elsewhere fails and consumes the link | Emit `token_hash` links and use the existing `verifyOtp` branch (`:173-181`), which works from any browser. Keep "I've confirmed" only as a fallback |
| B6 | Profile photo silently unsaved | Selection sets a preview only; persistence needs a separate "Save profile photo" click (`:17254`) | Upload on select, show progress, show saved state. Remove the separate save button and the on-screen instructions that compensate for it |
| B7 | Avatar rejects iPhone photos with a chat-message error | Avatar validation calls `validateMessagePhoto` (`:17151`); `accept` excludes HEIC | Accept HEIC/HEIF, convert client-side or server-side, and write avatar-specific error text |
| B8 | Trust video rejected after recording | Hard 8–15s window (`identity-trust.ts:6-7`) enforced post-capture; unreadable duration metadata surfaces as a vague failure | Widen to 8–30s, state the window before recording, show a live duration counter, and on unreadable metadata let the server probe rather than blocking the tailor |
| B9 | Trust submission reports one unrelated missing field | Server returns only the first incomplete field as a 409 (`identity-handoff-action/index.ts:190`) | Return all field errors, render them as a checklist, and block the recorder *before* recording if the profile is incomplete |
| B10 | Selecting an address suggestion duplicates the house number | `parseAddressSearchSuggestion` takes `display_name.split(',')[0]` as `providerLabel` — for a street address that fragment is just the house number — and prefers it over the full street (`packages/shared/src/address.ts:56,60`) | Only use `providerLabel` as `line1` when it is a named place, not when it equals the house number or is purely numeric. Prefer `street` in that case. Covers web and mobile, which share this parser |
| B11 | Required fields have no visible labels | Title, category and description are bare `Input`/`Textarea` with placeholder-only labels (`account-app-surface.tsx:17846-17861`); the placeholder vanishes as soon as she types | Every field gets a persistent visible label, a required marker, and a one-line hint. See section 6 |

---

## 4. Flow design

### 4.1 Where setup lives

**Decision: keep two phases, make phase two coherent.**

Account creation stays early (email + password or OAuth, name, phone, role). Studio setup happens
after confirmation, authenticated. This is the right shape: uploads are authenticated, no media
quarantine dance, drafts can live server-side, and the tailor can switch devices freely.

What changes:

- Studio setup moves into a dedicated module, `apps/web/features/account/tailor-onboarding/`,
  with its own component tree. It must not be built inside `account-app-surface.tsx` (29,024 lines).
- The URL `/account/profile?setup=1` is kept so existing emails and links keep working; it renders
  the new module.
- The ~800 lines of unreachable tailor studio setup in `account-auth-form.tsx` (steps 3–6, dead
  because step 2 submits at `:2781`) are deleted, not revived.
- Placeholder writes stop. No more `location: 'Not set'` or empty-string bios. Incomplete fields
  stay null and progress is derived from null.

### 4.2 Progress is server-derived, single source of truth

`deriveTailorSetupProgress` in `packages/shared/src/tailor-setup.ts` already computes per-step and
per-field state and is already used by both the web wizard and the edge function. Keep it as the one
authority and stop layering local overrides on top of it (for example the `pendingProfilePhotoSave`
patch at `:26203-26215`, which exists only because uploads are not automatic).

Client reads it for the checklist. Server reads it for the trust gate. Same answer in both places.

### 4.3 Step map

Four steps, unchanged in substance, changed in behaviour.

**Step 1 — You and your studio**
Profile photo (uploads on select), display name, phone (inline, with OTP), location, about (80 char
minimum with a live counter), languages.

**Step 2 — What you make**
Specialties, business type, currency, price range, order modes.

**Step 3 — Proof of work**
Portfolio media, and ready-made items for boutique and tailor-shop accounts. One uploader that
accepts images and video together. Each item shows its own upload state.

**Step 4 — Getting orders and verification**
Availability, fulfilment, pickup address when relevant, consultation policy, then the trust video.
The recorder is only reachable when steps 1–3 are complete, and the blocking reason is a checklist,
not a single sentence.

### 4.4 Persistent elements on every step

- A step rail showing four steps with completed / current / blocked state.
- A "What's left" panel listing every outstanding requirement across all steps, each item a link
  that jumps to and focuses the relevant field.
- A save indicator. Everything saves as you go; the tailor should never wonder.
- One primary action per step. No competing buttons.

---

## 5. Component work

### 5.1 Error system

Stop using one `error` string per page. Adopt what already exists and is unused in this flow:

- `apps/web/components/ui/field.tsx` — renders a per-field error.
- `packages/shared/src/form-foundation.ts` — `FormErrors`, `clearFieldError`, `firstInvalidField`.

Rules:

- Validation errors render inline at the field, and `aria-describedby` points at them.
- On a failed continue, focus moves to the first invalid field.
- A page-level banner is only for request failures (network, server), never for field validation.
- Keep the wording from `TAILOR_SETUP_VALIDATION`; it is already decent. The problem is placement and
  quantity, not phrasing.

### 5.2 One upload component

A single `MediaUploadField` used for avatar, portfolio images, portfolio video, and ready-made
photos. Responsibilities:

- Upload immediately on select, with visible progress.
- Per-item state: uploading with percentage, saved, or failed with a retry button.
- Client-side validation before upload, with format and size named in the message.
- Accept HEIC/HEIF alongside JPEG/PNG/WebP.
- One size and type policy, defined once in shared code, shared by both web editors. Today the
  non-setup editor allows 12 MB (`profile-workspace.tsx:164`) and the setup editor 10 MB via
  `validateMessagePhoto`.

### 5.3 One media model

Portfolio images are `portfolio_items` rows; portfolio videos are a URL array on the profile. That
split is why the screen has two uploaders, two save buttons, two orderings, and two caps. Unify on
`portfolio_items` with a `kind` column so ordering, cover selection, and alt text work the same for
both. This is a migration and belongs in the last phase, not the first.

### 5.4 Trust video handoff

- Status polling and realtime keyed on `userId`, running whenever status is non-terminal.
- Handoff session persisted so a reload keeps the QR code and the waiting state.
- Honest status text. Never claim to be waiting on a connection nothing is listening for.
- Recording rules shown before the recorder opens: length window, what to say, that no ID is needed.
- Live duration counter, a stop button that is enabled only inside the valid window, and re-record
  without restarting the session.

---

---

## 6. Labels, help, and microcopy

She kept asking questions. That is a content failure as much as a layout one: the flow asks for
things without saying what they are for, and the labels that do exist disappear as soon as she types.

### 6.1 Every field gets three things

1. **A persistent visible label.** Never placeholder-as-label. Today title, category and description
   in the portfolio panel are bare inputs with placeholder text only
   (`account-app-surface.tsx:17846-17861`), and there are 99 `placeholder=` usages in that file to
   audit. Placeholders may only repeat an example of the format, never the field name.
2. **A required marker.** Required is shown up front, not discovered by pressing Continue. Optional
   fields are labelled "Optional" in the label itself.
3. **A one-line hint, always visible.** One sentence saying what good input looks like. The `Field`
   primitive (`apps/web/components/ui/field.tsx`) already renders label, hint and error, and is
   currently used nowhere in this flow.

### 6.2 The (i) help affordance

For anything that raises a "why do you need this?" question, add a small circled **i** button beside
the label that reveals a short explanation.

Requirements:

- **Not a hover tooltip.** Hover does not exist on a phone. Use a click/tap disclosure that opens a
  small popover on desktop and expands inline beneath the label on mobile.
- A real `<button>` with `aria-expanded` and an accessible name like "About your price range", so
  keyboard and screen-reader users get the same content.
- Content is two or three short sentences maximum, answering: what this is, why Drapeon asks, and
  who can see it. Anything longer belongs in a help article, linked from the popover.
- Dismissed by tapping the button again, by Escape, or by tapping outside.

Note on implementation: `@radix-ui/react-tooltip` is already a dependency and
`apps/web/components/ui/tooltip.tsx` exists but is used nowhere. Tooltip is the wrong primitive here
because it is hover-oriented. Either add `@radix-ui/react-popover`, or build a small controlled
disclosure on top of the existing `Field` component. Prefer the latter: fewer dependencies and it
degrades to plain inline text.

### 6.3 Fields that need an (i), and what it says

These are the questions she actually asked or would ask. Copy is a first draft to be reviewed against
the brand voice work.

| Field | (i) content |
|---|---|
| Phone number | "Used for order updates, account recovery, and secure recording links. It is never shown on your public profile and never given to customers." |
| Profile photo | "A clear photo of you or your shopfront. Customers see this on your profile, in messages, and on every order. It is reviewed before your profile goes live." |
| About your work | "Customers read this before they choose you. What you make best, who you sew for, and how fittings and timelines work. At least 80 characters." |
| Languages | "Which languages you can hold a fitting conversation in. Shown on your public profile so customers know they can talk to you." |
| Specialties | "The garments you want to be found for. These drive search and browse, so choose what you actually want to be booked for." |
| Business type | "Tailor makes to order. Boutique sells ready-made pieces. Tailor shop does both. This decides what proof you need and what customers can buy." |
| Typical price range | "The usual low and high price of a full project in your currency. A guide, not a quote, so customers arrive with the right expectations." |
| How customers can order | "Custom means you make to their measurements. Ready-made means they buy an existing piece. You can offer both." |
| How customers receive orders | "Pickup from you, local delivery, or shipping. Choose every option you actually offer." |
| Pickup address | "Only shared with a customer who has a confirmed order needing collection. Never shown publicly." |
| Consultations | "A call before ordering. Free builds trust; paid protects your time. You can credit a paid fee toward the order." |
| Portfolio | "Real photos of work you made. This is the single biggest factor in whether a customer contacts you. At least one is required to go live." |
| Ready-made item | "One real listing with price, size and stock, so customers can see what buying from you looks like." |
| Trust video | "A short private video where you say a phrase we generate. It proves a real person runs this studio. Only the Drapeon Trust team sees it; it is never public, and we never ask for a government ID." |
| Availability | "Open, limited, or fully booked. Shown on your profile and you can change it at any time." |
| Currency | "The currency your prices are shown and paid in." |

### 6.4 Copy rules for this flow

- Say what to do, not what went wrong: "Add one photo of your work" over "Portfolio media missing."
- Never show database language. The current empty state says "No editable portfolio rows yet"; a
  tailor does not have rows.
- Never write instructions that exist to paper over a broken interaction. The three-step lists now on
  screen for the profile photo (`:17228`) and the portfolio panel (`:17831-17840`) are both symptoms.
  When the interaction is fixed, the instructions get deleted, not rewritten.
- One numbering scheme per screen. The portfolio panel currently has three at once: the wizard's
  "step 3 of 4", its own "Add a portfolio item in 3 steps", and a field labelled "Step 1 · Portfolio
  item image".

---

## 7. Address entry

### 7.1 The duplication bug

Reproduced with a real Nominatim payload for `215 Elm Street`:

```
line1        = "215"
line2        = "215 Elm Street, Camberwell"
displayValue = "215, 215 Elm Street, Camberwell, London, Greater London, SE5 8AB, United Kingdom"
```

`parseAddressSearchSuggestion` derives `providerLabel` from `display_name.split(',')[0]`
(`packages/shared/src/address.ts:56`), which for a street address is the house number alone, and then
prefers it over the assembled street at `:60`. The house number therefore appears twice, and
`uniqueParts` cannot catch it because `"215"` and `"215 Elm Street"` are not equal strings.

This parser is shared, so the bug is on web and mobile.

### 7.2 Address UX beyond the bug

- **Show the structured result, not a long single line.** After selection, display the parsed fields
  (street, city, region, postcode, country) in a small confirmation card the tailor can correct. A
  70-character comma string is unverifiable at a glance, which is why the duplication went unnoticed
  until she read it aloud.
- **Two different jobs, two different fields.** Step 1 asks for a city or base location; step 4 asks
  for a private full pickup address. They currently look identical. Label and hint them distinctly,
  and say who can see each.
- **A 5-character minimum before searching** hides the field's behaviour. Say "Keep typing to see
  suggestions" instead of showing nothing.
- **Keep the manual fallback reachable.** Step 1 sets `allowManualFallback={false}`, so a tailor whose
  area is not in Nominatim cannot proceed at all. That must never be a hard block.
- **Attribution and rate limits.** Nominatim's usage policy requires attribution and discourages
  production geocoding volume. The project notes already call for Mapbox. Decide before launch;
  a failed lookup currently just says suggestions are unavailable.

---

## 8. Portfolio setup — redesign

This screen is the worst part of the flow and needs redesigning, not patching. What it does today, in
order of appearance:

1. A green box explaining how to add an item in three steps.
2. A presentation editor for alt text and focal points — **rendered above the add form**, so during
   onboarding the first thing she sees is an empty editor for media that does not exist, plus a note
   that its controls "unlock after the first portfolio image is saved."
3. Bare `Title` and `Category` inputs with no labels.
4. A file input labelled "Step 1 · Portfolio item image", with a hint that the file uploads only when
   she clicks a button further down.
5. A description textarea, also unlabelled.
6. An "Add portfolio item" button.
7. A separate bordered block for portfolio videos, with its own file input, its own "Add video"
   button, its own 0/4 counter, its own sortable grid and its own format rules.
8. A "Portfolio gallery order" grid where cover status is implied by position, while a separate
   set-cover action exists elsewhere.

So: two upload mechanisms, three numbering schemes, an editor before the thing it edits, no visible
labels, no upload progress, and a required title she only learns about by failing.

### 8.1 Target design

**One uploader.** A single drop zone and file picker that accepts images and video together. Multiple
files at once. Files upload on drop with per-item progress. No save button for the upload itself.

**A grid of what she has added.** Each tile shows the thumbnail and its own state: uploading with
percentage, added, or failed with Retry. The first tile is marked "Cover" with a "Make cover" action
on the others. Drag to reorder, with arrow-button fallbacks for touch and keyboard.

**Details are per item, and optional by default.** Tap a tile to open a sheet with title, category,
description and alt text. Nothing blocks the upload. If a title is genuinely required for a public
listing, generate a sensible default from the filename or category and let her edit it — do not
reject the upload.

**Requirements stated once, at the top.** "Add at least one photo or video of your work. Up to 12
items, up to 4 videos, 30 seconds each." Not three boxes of instructions.

**Presentation controls appear only when there is media to present**, below the grid, never above the
uploader, and only in the profile editor rather than during onboarding. Alt text belongs in the
per-item sheet, where the image is visible.

**The proof requirement is visible and live.** "1 of 1 required item added" ticks over as soon as the
first upload lands, so the tailor knows she has cleared the gate before pressing Continue.

**Ready-made items get the same treatment** for boutique and tailor-shop accounts: one uploader, one
grid, one clear statement of what is required.

### 8.2 States the design must cover

Empty; one item uploading; mixed added and uploading; an upload failed with retry; at the 12-item
cap; at the 4-video cap; video too long; unsupported format; and the boutique variant where
ready-made proof is required instead of portfolio media. Every one of these needs a harness state and
a screenshot.

---

## 9. Browser view is required for this work

**This cannot be done from code alone.** Everything in sections 4 through 8 is a judgement about what
something looks and feels like at a given viewport, in a given state. Reading the source tells us
what exists; it does not tell us whether it reads as calm, whether the checklist competes with the
form, or whether an error lands where the eye is. Every iteration needs rendered pixels.

### 9.1 What already exists

`apps/web/playwright.config.ts` is configured with three viewports — `mobile-375`, `tablet-768`,
`desktop-1440` — screenshots and traces on failure, and a `webServer` that boots the app on
`127.0.0.1:3004` with Google auth enabled. That is most of the harness.

### 9.2 What to add

**A state harness route.** Follow the pattern already used by `/lifecycle-preview`,
`/survey-preview`, and `/marketing-topics-preview`: add `apps/web/app/signup-preview/` rendering
every signup and onboarding step against mock data, with no auth, no Supabase, and no email. It must
cover each state we need to look at, because most of these states are unreachable by hand:

- Step 1–4, empty.
- Step 1–4, with validation errors shown.
- Upload in progress, upload failed, upload saved.
- Trust video: rules, recording, too short, too long, uploading, submitted, waiting for another
  device, rejected.
- Blocked step 4 with a multi-item checklist.
- OAuth tailor with no phone, mid-OTP, verified.
- Confirmation screens: sent, link failed, confirmed elsewhere.
- Every (i) help disclosure open, at mobile width, where inline expansion shifts the layout.
- Address: typing below the search minimum, suggestions open, selected with the structured
  confirmation card, lookup failed with manual fallback.
- Portfolio: empty, uploading, mixed, failed with retry, at the 12-item cap, at the 4-video cap,
  rejected format, and the boutique ready-made variant.

Gate it out of production the way the other preview routes are, and keep it out of `robots.ts`.

**A screenshot pass.** A script that walks the harness at all three viewports and writes PNGs to
`qa-artifacts/signup/<date>/`, so each iteration produces a reviewable grid. I look at these; the
diff between passes is the review.

**A real-device pass** at the end of each phase. Camera permissions, HEIC handling, the iOS file
picker, Safari's MediaRecorder behaviour, and Gmail's in-app webview cannot be emulated. Minimum:
iPhone Safari and Android Chrome, one pass each.

### 9.3 Working agreement

For any change in this plan: harness state first, screenshot, review, then implement. I should not be
asked to judge UI I have not seen rendered, and I will say so rather than guess.

---

## 10. QA and replay

The existing `sign-up-flow.spec.ts` covers registration only up to account creation. Nothing covers
post-confirmation setup, the trust handoff, cross-device confirmation, or the OAuth phone path —
which is exactly where every blocking defect lives.

### 10.1 Full replay matrix

Run each as a separate scenario and record the exact on-screen text:

1. Email tailor signup, single device, happy path, end to end to trust submitted.
2. Google tailor signup, completed within 15 minutes.
3. Google tailor signup, deliberately delayed past 15 minutes. Can she set a phone? (B1, B2, B3)
4. Confirmation email opened on a different device, and in Gmail's in-app webview. (B5)
5. Trust video recorded on a phone with the laptop tab never backgrounded; then repeated with a
   laptop reload before recording. (B4)
6. Trust video edge cases: 30 second clip, iPhone `.MOV`, sub-1 second clip, very small file. (B8)
7. HEIC profile photo; and continuing without an explicit save. (B6, B7)
8. Portfolio: image with no title, video, both together, an 11 MB image (between the two limits). (5.2)
9. Everything complete except one step-1 field, then attempt the trust video. (B9)
10. Boutique and tailor-shop business types, which require ready-made proof.
11. Address entry: a house-number address, a named venue, a landmark with no match, and a lookup
    failure. Read the saved value back character by character. (B10)
12. A fresh tailor who has never seen Drapeon walks the flow unaided, with someone noting every
    question she asks out loud. Each question is either a missing label, a missing hint, or a missing
    (i). That list is the microcopy backlog.
13. Customer signup, email and Google, for parity.
14. Mobile app tailor signup, same matrix, to confirm parity and catch regressions.

### 10.2 Automated coverage to add

- `tailor-onboarding.spec.ts`: step gating, checklist contents, inline error placement, focus
  movement to the first invalid field.
- Upload states against the harness, including failure and retry.
- Handoff acknowledgement without a visibility change — the regression test for B4.
- A `token_hash` confirmation callback test — the regression test for B5.
- OAuth phone OTP path — the regression test for B1.
- `address.test.ts` cases for a house-number address, a named venue, and a landmark — the regression
  test for B10.
- A lint or test rule that fails when an input in this flow has a placeholder but no label — the
  regression test for B11.

---

## 11. Phasing

| Phase | Contents | Size |
|---|---|---|
| 0 | Harness route, screenshot pass, full replay of the current build to capture baseline evidence | S |
| 1 | Blocking defects B1–B5. Flow becomes completable by any tailor on any device | M |
| 1b | Address duplication (B10) — small, shared, and visible on every profile. Ship with phase 1 | S |
| 2 | Interaction rebuild: error system, upload component, checklist, save-as-you-go (B6–B9) | M |
| 2b | Labels, hints, required markers, and the (i) disclosure across the flow (B11, section 6) | M |
| 2c | Portfolio redesign (section 8) and the structured address confirmation card (section 7) | M |
| 3 | Consolidation: extract the onboarding module, delete dead signup steps, stop placeholder writes, unify the media model | L |
| 4 | Visual polish to the design system, plus mobile parity pass | M |

Phase 1 removes the hard blocks. Phases 2b and 2c are what stop the questions — they are the
difference between a flow that works and a flow a tailor can complete alone. Phase 3 is what stops
all of it coming back.

Note on phase 4: polish should not start until the design tokens are settled. There is live drift —
`design-system/drapeon-web/MASTER.md` specifies a purple palette and Playfair Display, the apps ship
needle green with Fraunces, and the project notes call for Cormorant Garamond and DM Sans. Polishing
against three conflicting sources wastes the work.

---

## 12. Decisions needed

1. **Phone verification:** confirm OTP-always, password-reauth-only-when-a-password-exists. This is
   the only way an OAuth tailor can ever hold a phone number.
2. **Trust video window:** confirm widening 8–15s to 8–30s. Anything recorded outside the flow will
   otherwise keep failing.
3. **Media model unification:** confirm the `portfolio_items` migration in phase 3, or accept two
   models and the divergent UI that follows.
4. **Scope of phase 4:** polish tailor onboarding only, or customer signup at the same time.
5. **Is a portfolio title required?** Today it blocks the upload. Recommend generating a default and
   letting her edit it, so adding work is never blocked by naming it.
6. **Geocoding provider:** stay on Nominatim, or move to Mapbox as the project notes propose. This
   affects attribution, rate limits, and address quality in Nigeria and Ghana specifically.
7. **Who writes the final (i) copy?** The drafts in section 6.3 need one pass against the brand voice
   before they ship.

---

## 13. Out of scope

Payout onboarding, ops review tooling, and the tailor dashboard after go-live. They touch this flow
but are separate work.
