# Drapeon declutter inventory

Status: **approved with corrections; Batch A authorized**
Baseline: committed `main` at `b6fb81e28d80cd43e0622458014c4014f1081023`
Prepared: 2026-10-30

This audit treats a “blurb” as explanatory copy attached to a screen, state, field group, card, modal, or empty state. Functional labels, live values, validation tied to a field, and user-authored content are not counted as blurbs. Word counts are for the displayed copy, excluding dynamic names and values; `~` marks conditional copy whose exact count varies.

Verdicts:

- **CUT**: remove the card/blurb.
- **SHORTEN**: keep the useful state or instruction, but reduce it to one sentence.
- **MOVE TO SHEET**: replace inline detail with a short “Learn more” or info action.
- **KEEP**: retain because it holds an action, live state, or an approved disclosure. A KEEP does not approve wording changes listed in the rule-3 section.

## Shared copy and cross-cutting states

| Batch | Screen / source | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---|---:|---|---|---|
| Shared | `packages/shared` (new constant) | Repeated weak-connection/load errors | ~12–24 each | SHORTEN | 2 | `Couldn't load this. Check your connection and try again.` |
| Shared | Upload/save actions across mobile | Repeated weak-connection essays | ~14–25 each | SHORTEN | 2 | `Couldn't save this. Check your connection and try again.` |
| Shared | Payment actions across mobile | Repeated payment failure essays | ~15–24 each | SHORTEN | 2, 3 | `Payment didn't start. Check your connection and try again.` Keep any “card not charged” fact where provider state confirms it. |
| Shared | Payments, approvals, decisions, refunds, and releases | Outcome cannot be confirmed | varies | KEEP | 2, 3 | `We couldn't confirm this went through. Check the order before trying again.` Never invite a second attempt until the user checks authoritative state. |
| Shared | Empty states across mobile/web | Multi-sentence guidance below an empty result | ~12–35 each | SHORTEN | 2 | One state-specific line plus the existing action; e.g. `No orders yet.` |

Global safeguards added at review:

- Keep a short reason beside every disabled primary action.
- Success/receipt screens keep the reference ID, human status, and one next-step line.
- Shared copy belongs in `packages/shared` so mobile and web use identical wording.

## A. Tailor onboarding

| Screen | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---:|---|---|---|
| `profile/setup.tsx` | Section opener: “Complete the profile pieces Drapeon needs before review.” | 9 | CUT | — | — |
| `profile/setup.tsx` | Profile photo helper | 12 | SHORTEN | 1 | `Choose a clear photo customers can recognise.` |
| `profile/setup.tsx` | Display-name helper | 10 | SHORTEN | 1 | `Use your public name; no contact details.` |
| `profile/setup.tsx` | Bio helper + duplicate counter guidance | ~27 | SHORTEN | 1 | `Describe your work and experience in at least 80 characters.` |
| `profile/setup.tsx` | Specialties helper | 11 | SHORTEN | 1 | `These appear on your public profile.` |
| `profile/setup.tsx` | Currency provider note | ~20 | SHORTEN | 2 | `Customers see this currency on your profile.` |
| `profile/setup.tsx` | Ready-made shop explainer | ~13 | SHORTEN | 2 | `Add one ready-made item to continue.` |
| `profile/setup.tsx` | Custom-order availability explanations | ~20 | SHORTEN | 2 | Live state only: `Custom briefs are on.` / `Custom briefs are paused.` |
| `profile/setup.tsx` | Shop availability explanations | ~18 | SHORTEN | 2 | Live state only: `Shop checkout is on.` / `Shop checkout is paused.` |
| `profile/setup.tsx` | Fulfilment explainer | 14 | SHORTEN | 1 | `Choose at least one fulfilment option.` |
| `profile/setup.tsx` | Address-search instructions | 27 | SHORTEN | 1 | `Search for your address or enter it manually.` |
| `profile/setup.tsx` | Trust-video instructions and consent | ~42 | KEEP | 3 | Approval required; see rule-3 table. |
| `profile/setup.tsx` | Setup success/review process copy | ~19–27 | SHORTEN | 2, 3 | Live state first; see rule-3 table for review wording. |
| `profile/trust-access.tsx` | Error recovery paragraph | 17 | SHORTEN | 2 | Shared load error. |
| `profile/trust-access.tsx` | “review state” advice card | 23 | CUT | — | — |
| `profile/trust-access.tsx` | “self-fixable hold” advice card | 22 | CUT | — | — |
| `profile/trust-access.tsx` | Current access status card and missing requirements | dynamic | KEEP | 2 | Keep status, blocker, and existing action only. |
| `profile/access-review.tsx` | Hero shown before request form | ~22 | CUT | — | Open on the explanation input and submit action. |
| `profile/access-review.tsx` | Explanation field helper | 15 | SHORTEN | 1 | `Tell support what looks wrong.` |
| `profile/access-review.tsx` | Email/WhatsApp fallback essays | ~16–22 | SHORTEN | 2 | `Couldn't send this. Contact tailor support.` |
| `shop/new.tsx` | Listing-readiness intro/status essay | ~18–30 | SHORTEN | 2 | Keep the exact missing fields as a compact checklist. |
| `shop/new.tsx` | Media helper stack | ~20–31 | SHORTEN | 1 | `Add clear photos or a video up to 30 seconds.` |
| `shop/new.tsx` | Category/title/description explainers | ~8–22 each | SHORTEN | 1 | One short field hint only where validation needs it. |
| `shop/new.tsx` | Size and stock helper cards | ~14–28 each | SHORTEN | 1, 2 | `Choose sizes, then add stock for each size.` |
| `shop/new.tsx` | Fit-guide teaching paragraphs | ~18–31 | MOVE TO SHEET | — | Inline: `Add measurements customers can compare.` Sheet: current category-specific detail. |
| `shop/new.tsx` | Fulfilment helper stack | ~12–24 | SHORTEN | 1 | `Choose how customers can receive this item.` |
| `shop/new.tsx` | Fee and private-address detail | ~8–22 | KEEP | 3 | Approval required; see rule-3 table. |
| `shop/new.tsx` | Publish confirmation paragraph | 22 | SHORTEN | 2 | `This item will be visible and available to buy.` |
| `profile/payout-setup.tsx` | Intro hero: badge/title/body | 13 | CUT | — | Open on payout currency/method. |
| `profile/payout-setup.tsx` | Three benefit rows | 49 | CUT | — | — |
| `profile/payout-setup.tsx` | Step chips with numbered labels | 4 labels | SHORTEN | — | Compact progress indicator without “Step” badges. |
| `profile/payout-setup.tsx` | Currency hero and provider explanation | 31 | SHORTEN | 3 | `Payout method`; provider eligibility detail moves to info sheet. |
| `profile/payout-setup.tsx` | Currency/KYC/reverification info card | ~38 | KEEP | 3 | Approval required; see rule-3 table. |
| `profile/payout-setup.tsx` | Connect hero and provider process copy | ~18–24 | SHORTEN | 3 | Approval required; see rule-3 table. |
| `profile/payout-setup.tsx` | Verified/pending summary hero | ~18–34 | KEEP | 2, 3 | Keep current status/blocker; approval required for shortened disclosure. |
| `profile/payout-setup.tsx` | Load-error protection explanation | 15 | CUT | — | Keep shared error and retry action. |
| `profile/payout-setup.tsx` | Bank loading/fallback/paused cards | dynamic | KEEP | 2 | One short live-state line each. |
| `profile/payout-setup.tsx` | Manual-entry explainer | ~18–26 | SHORTEN | 1 | `Use manual entry only if your bank is missing.` |

**Payout hold:** do not edit `profile/payout-setup.tsx` until PR #92 is merged and the batch branch has been rebased. Re-audit the merged screen before implementation; the rows above describe the current `main` baseline only.

## B. Customer ordering

| Screen | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---:|---|---|---|
| `brief/[tailorId].tsx` | Six step subtitles | 89 total | SHORTEN | 1 | Each becomes at most one short hint; remove where the field labels are sufficient. |
| `brief/[tailorId].tsx` | Header “Step n of 6” plus title | duplicate | SHORTEN | — | Keep segmented progress; remove the step badge text. |
| `brief/[tailorId].tsx` | Draft restored/saving/saved card | ~4–21 | KEEP | 2 | `Draft restored.` / `Saving…` / `Saved.` / `Draft couldn't save.` Attachment warning remains one sentence. |
| `brief/[tailorId].tsx` | Loading explanation | 19 | CUT | — | `Loading order brief…` |
| `brief/[tailorId].tsx` | Error “Recovery” guide card | 25 | CUT | — | Shared load error plus `Try again`; retain existing alternate actions only if still needed. |
| `brief/[tailorId].tsx` | Garment/reference-photo education | ~20–60 | MOVE TO SHEET | — | Inline: `Add references that show the style you want.` |
| `brief/[tailorId].tsx` | Holiday-period advice | ~18 | MOVE TO SHEET | — | Inline: `This date may need extra time.` |
| `brief/[tailorId].tsx` | Measurement age/profile guidance | ~12–34 | SHORTEN | 2 | Show profile age and `Update if your fit changed.` |
| `brief/[tailorId].tsx` | Fabric-source option hints | 28 total | SHORTEN | 1 | `You provide fabric.` / `The tailor sources fabric for approval.` |
| `brief/[tailorId].tsx` | Fabric handoff guide card | 30 | SHORTEN | 2 | `Work starts after the tailor confirms your fabric arrived.` |
| `brief/[tailorId].tsx` | Tailor-sourced fabric approval card | 28 | SHORTEN | 2 | `Approve the fabric before cutting starts.` |
| `brief/[tailorId].tsx` | Natural-light/photo advice | 13 | MOVE TO SHEET | — | Move under fabric-photo info action. |
| `brief/[tailorId].tsx` | Delivery option hints | 33 total | SHORTEN | 1 | `Local delivery.` / `Shipping.` / `Collect in person.` |
| `brief/[tailorId].tsx` | Address-search explanation | ~20 | SHORTEN | 1 | `Search for your address or enter it manually.` |
| `brief/[tailorId].tsx` | Standard fee/surcharge/customs disclosure | 32 | KEEP | 3 | Approval required; see rule-3 table. |
| `brief/[tailorId].tsx` | Collection-code guide | 41 | MOVE TO SHEET | 3 | Inline: `Use the code only after collecting your order.` Timing detail in sheet; approval required. |
| `brief/[tailorId].tsx` | Checkout preview explanatory sentence | 12 | KEEP | 3 | `Review the full total before payment.` |
| `brief/[tailorId].tsx` | Handmade variation note | 28 | SHORTEN | 3 | Keep inline: `Handmade variation can occur. Fit, finish, wrong-item and quality concerns remain protected.` |
| `brief/[tailorId].tsx` | Cancellation policy rows and acknowledgement | dynamic | KEEP | 1, 3 | Keep action and approved policy text; no change before approval. |
| `tailor/[id].tsx` | Availability/unavailable paragraphs | ~19 | SHORTEN | 2 | `Not accepting custom briefs right now.` |
| `tailor/[id].tsx` | Messaging process explanation | 17 | CUT | — | Existing order action makes the behavior clear. |
| `tailor/[id].tsx` | New-seller/no-reviews companion copy | 18 | SHORTEN | 2 | `No Drapeon reviews yet.` |
| `tailor/[id].tsx` | Media-report trust process explanation | 19 | SHORTEN | 2, 3 | `Choose a reason to report this media.` Keep success state: `Report sent.` |
| `item/checkout/[itemId].tsx` | Stock and size state messages | dynamic | KEEP | 2 | Keep the shortest matching live state. |
| `item/checkout/[itemId].tsx` | Recipient/delivery field essays | ~16–25 | SHORTEN | 1 | `Add the recipient and full delivery address.` |
| `item/checkout/[itemId].tsx` | Tax/total calculation state | ~11–17 | KEEP | 2, 3 | `Couldn't calculate the total. Check the address and try again.` |
| `item/checkout/[itemId].tsx` | Two-hour stock/promotion hold explanation | 25 | KEEP | 2 | `Checkout is held for 2 hours.` |
| `item/checkout/[itemId].tsx` | Payment protection sentence | 8 | KEEP | 3 | No change proposed. |
| `item/checkout/[itemId].tsx` | Pickup privacy/code paragraph | 37 | MOVE TO SHEET | 3 | Inline: `Pickup details appear when the order is ready.` Approval required. |
| `item/checkout/[itemId].tsx` | Delivery fee/surcharge/customs paragraph | 35 | KEEP | 3 | Approval required; see rule-3 table. |
| `item/checkout/[itemId].tsx` | Cancellation/refund prompt and policy | dynamic | KEEP | 1, 3 | Keep acknowledgement and approved terms. |
| `orders/[id].tsx` | Initial weak-connection/load essay | 20 | SHORTEN | 2 | Shared load error. |
| `orders/[id].tsx` | Order-stage explainer sections | ~90 across section intros | SHORTEN | 2 | Keep live status, blocker, deadline, and next action only. |
| `orders/[id].tsx` | Consultation process paragraphs | ~15–27 each | SHORTEN | 2, 3 | One live state sentence; fee disclosure retained. |
| `orders/[id].tsx` | Fabric/style approval teaching copy | ~15–24 each | SHORTEN | 2 | `Approve or request changes before cutting.` |
| `orders/[id].tsx` | Material-advance and escrow/release explanations | ~24–32 each | KEEP | 3 | Approval required; see rule-3 table. |
| `orders/[id].tsx` | Delivery proof instruction | 31 | SHORTEN | 1, 2 | `Add a photo before confirming receipt.` Keep concern action visible. |
| `orders/[id].tsx` | Pickup/privacy/handoff help essays | ~17–28 each | SHORTEN | 2, 3 | Status-specific one line; privacy wording requires approval. |
| `orders/[id].tsx` | Group-order process cards | ~25–45 | SHORTEN | 2 | Keep payer, recipients, and current blocker as live values. |
| `orders/[id].tsx` | Evidence/gallery description blurbs | ~12–19 each | CUT | — | Keep the gallery action label. |
| `orders/[id].tsx` | Review/tip helper copy | ~12–18 | SHORTEN | 1 | `Review or tip your tailor.` |

## C. Tailor work

| Screen | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---:|---|---|---|
| `orders/[id].tsx` | Initial weak-connection/load essay | ~18–22 | SHORTEN | 2 | Shared load error. |
| `orders/[id].tsx` | Order-stage and “what happens next” cards | ~100 across states | SHORTEN | 2 | Keep current status, blocker, deadline, and next action only. |
| `orders/[id].tsx` | Quote/payment/release explanations | ~18–35 each | KEEP | 2, 3 | Approval required for any payment/fee/release shortening. |
| `orders/[id].tsx` | Measurement/style/fabric teaching copy | ~15–30 each | SHORTEN | 2 | One required next action per checkpoint. |
| `orders/[id].tsx` | Referral trust card | ~20 | CUT | — | Referral context belongs in the referral action/sheet. |
| `orders/[id].tsx` | Delivery/pickup privacy and proof guidance | ~18–33 each | SHORTEN | 2, 3 | One live state line; disclosure changes require approval. |
| `earnings.tsx` | Earnings intro/explainer copy | ~30–45 | CUT | — | Open on amount and payout status. |
| `earnings.tsx` | Currency notice card | ~20 | SHORTEN | 2, 3 | `Amounts use each order's locked currency.` Approval required if refund/payout detail changes. |
| `earnings.tsx` | Empty earnings state | ~18 | SHORTEN | 2 | `No earnings yet.` plus existing action. |
| `clients/index.tsx` | Client-list introduction/empty guide | ~18–30 | SHORTEN | 2 | `No clients yet.` plus action where available. |
| `clients/[clientId].tsx` | Empty diary/info card | ~17 | SHORTEN | 2 | `No diary entries yet.` plus action. |
| `clients/diary/[id].tsx` | Diary hero/explainer card | ~25–40 | CUT | — | Open on the diary entry and actions. |
| `clients/diary/[id].tsx` | Privacy/sharing guidance | ~15–30 | SHORTEN | 2, 3 | Show audience/state in one line; consent detail requires approval. |

## D. Account

| Screen | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---:|---|---|---|
| Customer `profile/help.tsx` | Customer-guide hero | 22 | CUT | — | Open on help topics/search. |
| Tailor `profile/help.tsx` | Tailor-guide hero | 21 | CUT | — | Open on help topics/search. |
| Both help screens | Repeated section introduction paragraphs | ~12–35 each | MOVE TO SHEET | — | Topic title + action; detail opens on demand. |
| Customer `profile/privacy.tsx` | “Your data stays under your control” hero | 21 | CUT | — | Open on privacy controls. |
| Tailor `profile/privacy.tsx` | Privacy hero | 25 | CUT | — | Open on privacy controls. |
| Both privacy screens | Operational/legal-notice helper | ~10–14 | KEEP | 3 | Approval required if shortened. |
| Customer `profile/data-request.tsx` | Request-form hero | 26 | SHORTEN | 3 | `Request your data. We may verify your identity first.` Approval required. |
| Tailor `profile/data-request.tsx` | Request-form hero | 26 | SHORTEN | 3 | Same proposal; approval required. |
| Customer `profile/data-request.tsx` | Success hero/process paragraph | 27 | SHORTEN | 2, 3 | `Request received. We may verify your identity before release.` Approval required. |
| Tailor `profile/data-request.tsx` | Success/export process paragraph | ~22 | SHORTEN | 2, 3 | `Request received. We may verify your identity before release.` Approval required. |
| Both `profile/delete-account.tsx` | Request-form hero/retention disclosure | 30 | KEEP | 3 | Approval required; see rule-3 table. |
| Both `profile/delete-account.tsx` | Success hero and active-order explanation | ~20–39 | KEEP | 2, 3 | Approval required; show request state and active-order blocker only. |
| `CurrencySettingsScreen.tsx` | Account-default info card | 19 | SHORTEN | 2, 3 | `New orders use this currency; existing orders do not change.` Approval required. |
| `CurrencySettingsScreen.tsx` | “Before you switch” notice | 31 | MOVE TO SHEET | 3 | Inline: `Existing orders keep their original currency.` Full detail in info sheet; approval required. |
| Customer/tailor profile indexes | Intro/guide cards above settings/actions | ~15–35 each | CUT | — | Open on profile status and actions. |

## E. Links and messages

| Screen | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---:|---|---|---|
| `passport/claim/[passportId].tsx` | Measurement-passport hero | 31 | SHORTEN | 2 | `Claim measurement passport` + live owner/field summary. |
| `passport/claim/[passportId].tsx` | “How claiming works” guide | 22 | CUT | — | The claim action and result already communicate this. |
| `passport/claim/[passportId].tsx` | Loading/error/success guide cards | ~12–28 | SHORTEN | 2 | One live state sentence plus retry/continue action. |
| `referral/[code].tsx` | Referral hero explanation | ~24 | SHORTEN | 2 | `{Name} invited you to Drapeon.` |
| `referral/[code].tsx` | Trust-context explanation | ~15–25 | CUT | — | — |
| `group-invite/[code].tsx` | Invite hero explanation | ~26 | SHORTEN | 2 | `Join {owner}'s order as {member}.` |
| `group-invite/[code].tsx` | Linked-profile/order process copy | ~15–30 | SHORTEN | 2, 3 | State what accepting shares in one line; consent changes require approval. |
| Customer `messages/index.tsx` | Sync notice cards | dynamic | KEEP | 2 | `Syncing messages…` / `Messages couldn't sync. Try again.` |
| Customer `messages/index.tsx` | Empty-message guidance | ~18–30 | SHORTEN | 2 | `No messages yet.` plus existing navigation action. |
| Customer/tailor message threads | Guide/empty cards | ~15–30 | SHORTEN | 2 | Keep thread state or blocker only. |

## F. Drape Vision

| Screen | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---:|---|---|---|
| `NativeDrapeVisionScreen.tsx` | Screen intro/brand promise blocks | ~80–140 | CUT | — | Open on camera/source action. |
| `NativeDrapeVisionScreen.tsx` | Capture-mode explanation cards | ~20–50 each | SHORTEN | 1 | Mode name plus one sentence, max 12 words. |
| `NativeDrapeVisionScreen.tsx` | Pose, distance, lighting, and framing lessons | ~120 total | MOVE TO SHEET | 3 where safety applies | Inline live capture cue only; detailed guide behind info. |
| `NativeDrapeVisionScreen.tsx` | Camera/permission blockers | dynamic | KEEP | 2 | What is blocked + one settings/retry action. |
| `NativeDrapeVisionScreen.tsx` | Upload/analysis progress cards | dynamic | KEEP | 2 | Short live status only. |
| `NativeDrapeVisionScreen.tsx` | Repeated weak-connection errors | ~15–28 each | SHORTEN | 2 | Shared load/save error as applicable. |
| `NativeDrapeVisionScreen.tsx` | Results interpretation paragraphs | ~80–150 | MOVE TO SHEET | 3 where fit/safety applies | Show result and next action; methodology/detail in info sheet. |
| `NativeDrapeVisionScreen.tsx` | Privacy/consent/media-use language | dynamic | KEEP | 3 | No change before approval. |

## G. Web equivalents (after A–F)

Web uses fewer of the mobile style names, so this pass follows the equivalent journeys rather than CSS identifiers.

| Screen / source | Element | Current words | Verdict | Rule for KEEP | Proposed new text |
|---|---|---:|---|---|---|
| `features/account/tailor-onboarding/*` | Onboarding introductions and step explanations | ~20–60 each | Apply A decisions | 1–3 as above | Mirror approved mobile copy. |
| `features/account/brief/brief-form.tsx` | Brief step subtitles, fabric/delivery guides, review notices | ~15–45 each | Apply B decisions | 1–3 as above | Mirror approved mobile copy and sheets. |
| `components/tailor-profile-view.tsx` | Availability, messaging, new-seller explanations | ~15–30 each | Apply B decisions | 2 | Mirror approved mobile copy. |
| `features/account/orders/*order-detail*` | Customer/tailor order process cards | ~15–45 each | Apply B/C decisions | 2, 3 | Same status-first copy as mobile. |
| `features/account/work/work-workspace.tsx` | Work/earnings/client empty and guide states | ~15–35 each | Apply C decisions | 2 | One line plus action. |
| `features/account/messages/*` | Message intro, empty, and sync states | ~15–30 each | Apply E decisions | 2 | Mirror approved mobile copy. |
| `app/help/page.tsx` | Help-page hero and topic introductions | ~20–50 each | CUT / MOVE TO SHEET | — | Open on topics; detail on demand. |
| `features/account/account-workspace-shell.tsx` | Account/profile explanatory panels | ~15–35 each | Apply D decisions | 2, 3 | Status/actions first; approved disclosures only. |
| `app/vision/page.tsx` | Vision marketing/instruction blocks inside the tool path | ~25–90 each | Apply F decisions | 1–3 | Camera/source action first; detail on demand. |
| Web passport/referral/group invite routes | Invite/claim explainer heroes | ~20–40 each | Apply E decisions | 2, 3 | Mirror approved mobile copy. |

## Rule-3 disclosures requiring explicit approval

No text in this section may be changed merely because the proposed version is shorter. Product/legal/security approval is required row by row. Dynamic policy tables and acknowledgement text should remain unchanged unless their full generated copy is separately reviewed.

| ID | Screen | Topic | Before | Proposed after | Planned treatment |
|---|---|---|---|---|---|
| R3-01 | Tailor setup | Trust-video consent/instructions | Existing recorded consent text plus instructions to show face, voice, and private challenge phrase. | Consent text remains **exactly unchanged**. Instructions: `Show your face and say the challenge phrase clearly.` | KEEP consent/action; shorten adjacent instructions only. |
| R3-02 | Tailor setup | Trust vs payout verification | `Your profile is saved. Record your private trust video to submit for review. Your payout provider handles payout verification separately.` | `Record your private trust video for review. Payout verification is separate.` | KEEP distinction. |
| R3-03 | Tailor setup | Review timing claim | `We'll review your private trust video within 24 hours. You'll be notified when your profile goes live.` | `Trust video submitted. We'll notify you after review.` | Remove the 24-hour promise unless operations confirms it. |
| R3-04 | Payout setup | Currency/provider eligibility | Stale Paystack/Stripe provider matrix. | **HELD.** Re-audit after PR #92 and propose exact Bachs-for-NGN / Stripe-international wording. | Do not edit in Batch A. |
| R3-05 | Payout setup | KYC and eligible bank verification | `Choosing {currency} does not create a foreign bank account or change your country. Stripe will require identity and eligible bank verification.` | `Stripe verifies your identity, country, and eligible bank account.` | KEEP disclosure. |
| R3-06 | Payout setup | Provider verification | Stale Paystack verification text. | **HELD.** Re-audit after PR #92 for Bachs and Stripe. | Do not edit in Batch A. |
| R3-07 | Payout setup | Reverification and order currency | `You can change this later, but you must verify the new payout route again. Existing orders keep their original currency.` | `Changing payout method requires verification again. Existing orders keep their currency.` | KEEP. |
| R3-08 | Payout setup | Stripe handoff | `We use Stripe to send payments securely to your bank account. You'll be taken to Stripe's secure setup and then returned here.` | `Continue in Stripe to verify your payout account.` | KEEP provider handoff; security wording removed unless required. |
| R3-09 | Payout setup | Account-name confirmation | Stale Paystack-specific sequence. | **HELD.** Re-audit the Bachs/Stripe flows after PR #92 and send exact text. | Do not edit in Batch A. |
| R3-10 | Brief / checkout | Standard fee and extras | `Drapeon includes/collects a standard delivery or shipping fee ... Carrier surcharges, customs, or import duties are never charged automatically; we will ask you to approve anything extra before dispatch.` | `Includes standard delivery. Surcharges, customs or duties are never charged without your approval.` | KEEP the promise. Use “shipping” dynamically where applicable. |
| R3-11 | Brief | Collection code and timing | `Share it only when you have collected the order. Try to collect within 7 days ... after 14 days Drapeon may follow up...` | Inline: `Share the code only after collection.` Sheet: `Collect within 7 days. Drapeon may follow up after 14 days.` | KEEP safety instruction; MOVE timing detail. |
| R3-12 | Brief | Handmade variation/aftercare | `Bespoke garments can have small handmade variation. Fit, finish, wrong item, or quality issues are still protected through the order concern and aftercare path.` | `Handmade variation can occur. Fit, finish, wrong-item and quality concerns remain protected.` | KEEP inline. |
| R3-13 | Brief / checkout | Cancellation and refund policy | Generated cancellation policy rows plus required acknowledgement. | No change proposed pending a separate full policy review. | KEEP action and wording. |
| R3-14 | Checkout | Payment protection | `Payment stays protected until the handoff is confirmed.` | No change proposed. | KEEP. |
| R3-15 | Checkout | Pickup privacy, tax, and code | `Pickup has no delivery fee, but tax can still apply ... Pickup details stay private until ... Bring your collection code and inspect the item before closing the order.` | Inline: `Tax may apply. Pickup details appear when ready.` Sheet: `Bring your code and inspect the item before closing the order.` | KEEP/MOVE TO SHEET. |
| R3-16 | Customer order | Material advance from funded allowance | `This exact amount comes from the fabric allowance already paid at checkout. Approval does not charge you again; Drapeon Money Desk reviews the release before the tailor receives it.` | `This uses your paid fabric allowance; approval does not charge you again. Drapeon reviews release.` | KEEP money/release facts. |
| R3-17 | Customer order | Separate material payment | `This is separate from the main order funds. Approve only if this material cost makes sense; Drapeon reviews the release before the tailor receives it.` | `This is an extra payment, separate from your order total. Drapeon reviews it before the tailor is paid.` | KEEP. |
| R3-18 | Customer/tailor orders | Consultation fee and credit | Current state-specific fee text, including whether the fee counts toward an accepted order. | Keep amount and `Credited toward an accepted order` where applicable; remove surrounding process prose. | KEEP live amount and fee treatment. |
| R3-19 | Shop listing | Delivery fee variability | `Courier fees can vary. Confirm shipping before checkout.` / `Use delivery for local handoff after confirming the fee.` | `Confirm the delivery fee before checkout.` | KEEP. |
| R3-20 | Shop listing | Pickup address privacy | `Pickup address stays private until you mark the order ready for collection.` | `Pickup address appears only when the order is ready.` | KEEP. |
| R3-21 | Privacy | Required notices | `Order, [verification, payout,] safety, and legal notices still arrive when needed.` | `Required order, safety, and legal notices still arrive.` Tailor version also retains `verification and payout`. | KEEP. |
| R3-22 | Data request | Identity verification | `For security, we may verify identity before releasing anything sensitive.` | `We may verify your identity before release.` | KEEP. |
| R3-23 | Delete account | Retention limits | `This does not behave like an instant total wipe. Drapeon may retain limited records where required for security, fraud prevention, active transactions, legal obligations, or claims handling.` | `Some records are kept where required for security, fraud prevention, active transactions, legal obligations or claims.` | KEEP the retention meaning. |
| R3-24 | Delete account | Active orders block deletion/anonymisation | `We found {n} active order(s), so Drapeon will resolve open transactions before deletion or anonymization.` | `{n} active order(s) must be resolved before deletion or anonymisation.` | KEEP live blocker. |
| R3-25 | Currency settings | Locked currency records | `Once an order is created, payment, refund, tax, and payout records stay in the original locked currency.` | `Existing payment, refund, tax, and payout records keep their original currency.` | MOVE detail to sheet; keep one-line notice inline. |
| R3-26 | Group invite / diary sharing | Shared profile, measurements, or diary audience | Current invite-specific description of what accepting shares and with whom. | One explicit sentence naming the data and recipient; exact proposal must be generated from the rendered branch state. | KEEP consent context; do not implement until exact dynamic variants are reviewed. |
| R3-27 | Drape Vision | Camera/media consent and privacy | Current consent, retention, and media-use variants. | No change proposed until each rendered variant is captured verbatim. | KEEP. |

## Dead component proof

Search scope: committed `main`, across `apps/mobile`, `apps/web`, and `packages/shared`.

| Component | Definition | Other matches | Verdict |
|---|---|---|---|
| `PaymentTrustCard` | `apps/mobile/components/ui/PaymentTrustCard.tsx` | Barrel export in `components/ui/index.ts` only | Delete component and export after implementation approval. |
| `BrandCompanionCard` | `apps/mobile/components/ui/BrandCompanionCard.tsx` | Barrel export in `components/ui/index.ts` only | Delete component and export after implementation approval. |
| `GreetingCard` | `apps/mobile/components/ui/GreetingCard.tsx` | Barrel export in `components/ui/index.ts` only | Delete component and export after implementation approval. |

No additional component is marked for deletion from name-based search alone. Several apparently single-use card modules are composed dynamically or exported through feature barrels; they need import-graph confirmation on the implementation branch before deletion.

## Approval checklist

- [x] Rule-3 decisions recorded from review.
- [x] Remove the 24-hour trust-review promise (R3-03).
- [x] Collection timing may move behind Learn more (R3-11).
- [x] Standard-fee/customs wording approved (R3-10).
- [x] Deletion retention and active-order wording approved (R3-23, R3-24).
- [x] Locked-currency wording approved (R3-25).
- [ ] Re-audit payout setup after PR #92 merges; do not approve its exact implementation from this baseline alone.
- [ ] After approval, create `codex/declutter-a` and implement Batch A only. No merge or OTA without separate approval.
