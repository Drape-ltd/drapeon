# Batch A declutter evidence

PR #94 remains a draft until the complete before/after device matrix below is captured from a fresh Dev tailor account. No screenshots are currently presented as valid evidence. The six earlier Android images were removed: the New item “before” was the Expo launcher, and Access review “before” duplicated Trust access.

## Capture matrix

Capture these seven screens on each device and on each build: four Tailor setup steps, Trust & access, Access review, and Shop / New item. Use the same fresh account in the Dev project (`pqptfuqogvrajozfsqzi`). “Before” means the main build; “after” means this branch. Do not submit setup or access-review forms while capturing.

| Device | Main build (“before”) | PR branch (“after”) |
| --- | --- | --- |
| iPhone SE | Pending | Pending |
| Large iPhone (iPhone 17 Pro Max) | Pending | Pending |
| Android (Pixel 8) | Pending | Pending |

Suggested file layout once captured:

```text
ios-se/main-before/{setup-01,setup-02,setup-03,setup-04,trust-access,access-review,shop-new}.png
ios-se/branch-after/{setup-01,setup-02,setup-03,setup-04,trust-access,access-review,shop-new}.png
ios-large/main-before/...
ios-large/branch-after/...
android/main-before/...
android/branch-after/...
```

## MD5 inventory

This table must contain one row for every captured PNG. Hashes will be computed with `md5` after capture and checked for duplicates before the PR is marked ready.

| File | Screen | Build | Device | MD5 |
| --- | --- | --- | --- | --- |
| No valid captures yet | — | — | — | — |

## Trust & access state copy: before → after

The copy comes from `deriveTailorAccessGuidance` in `apps/mobile/lib/tailor-access.ts`. Blocked capabilities continue to come from readiness and remain visible under “Blocked right now.”

| State | Before | After |
| --- | --- | --- |
| Profile incomplete | **Finish setup before full seller access opens.** “This is a self-fixable setup hold, not a trust strike. Customers should not discover or pay a storefront that is still missing the core public profile.” Next: complete the public profile and return if access still looks stuck. | **Finish your profile to open seller access.** “Add your shop details and portfolio so customers can find your work.” Next: complete the profile and return if access still looks blocked. |
| Trust video not submitted / unknown status | Previously fell through to payout setup: **Set up your payout account before paid work opens.** | **Submit a trust video to open seller access.** “We need your trust video and profile before customers can find or pay your shop.” Next: record a trust video in setup, then return here. |
| Trust review pending | **Identity review is in progress.** “This is a review state, not an appeal state. Public discovery and paid work should stay conservative until identity review finishes.” The reason said “Identity review”; next steps mentioned contacting verification and possibly submitting the wrong document; an extra appeal note said appeals were usually unnecessary. | **Trust review in progress.** “We're reviewing your trust video and profile.” Reason: “Trust review.” Next: “We'll update this page when the review is complete.” The appeal note is removed. |
| Trust review rejected | **Verification needs attention before access can expand.** “This usually means Drapeon still needs clearer or corrected identity evidence. It should be treated as fix-first, not full appeal-first.” The next step asked for clearer evidence. | **Trust review needs an update.** “Your trust video or profile needs an update before access can expand.” Next: record a new trust video or update the profile in setup, then submit again. |
| Payout not ready | **Set up your payout account before paid work opens.** “This is an operational hold, not a trust strike. Identity checks look good, but Drapeon should not route paid work to a seller whose payout path is not actually ready.” | **Set up your payout account before paid work opens.** “Your trust review is complete, but payout setup is not ready yet.” Next: finish payout setup before accepting paid work. |
| International shipping enabled | **Access is open, with higher-risk work kept conservative.** Body and next step asked the tailor to keep higher-risk international work conservative and “clean.” | **Standard seller access is open.** “Your setup supports standard paid work. Keep international order details clear in each order thread.” Next: keep storefront and payout details current; share order details in Drapeon so support can help. |
| Standard access ready | **Your standard seller access looks healthy.** “Profile, identity, and payout signals currently support normal paid work.” | **Seller access is ready.** “Your profile, trust review, and payout setup are ready for standard paid work.” Next: keep the storefront and payout details up to date. |

## Other corrected copy and layout

- Setup now says “Trust review in progress.” for pending review, “Trust review complete.” for verified/approved review, and “Trust review needs an update.” for rejected review. The submission confirmation follows the same status instead of promising a notification after a completed review.
- Shop / New item shows one Shop now line, without repeating its title or inserting pickup-address guidance.
- Shop / New item has one dock action. Save draft remains an inline secondary action; the existing save handlers are retained.
- Trust & access uses the canonical load-error string without a redundant conditional.

## Scope

- Tailor setup, Trust & access, Access review, and Shop / New item.
- Shared trust/access guidance and action-error copy.
- Removal of three zero-import UI cards.
- Payout setup is explicitly excluded pending separate payout work.

## Copy and behavior notes

- The exact consent text for the private challenge video is unchanged. Tailors record a trust video; government ID documents are not requested.
- The unsupported 24-hour trust-review promise is removed.
- Shared load/save connection failures use one canonical source. A separate unknown-outcome message remains for order/payment-style actions where retrying could duplicate work.
- Access-review success preserves the status and next step. No reference ID is displayed because the existing endpoint does not return one.
- No API contract, navigation, persistence, validation, approval, payment, or order logic is changed.

## Deleted components

- `PaymentTrustCard`
- `BrandCompanionCard`
- `GreetingCard`

Repository-wide import searches returned zero consumers before deletion.
