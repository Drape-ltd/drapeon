# Recruitment tailor exceptions: runbook and Oladimeji case

Recorded 2026-09-28. Internal operational record; do not copy private contact details, credentials, or evidence URLs into public material.

## What this exception does

This is an explicit administrator-reviewed **missing challenge-video waiver**, not a general onboarding or identity-check bypass. Use the protected Ops workflow; never directly set `is_live`, `is_verified`, or verification status in SQL.

The normal private randomized challenge-video route remains the default. The exception records that no video was reviewed; it does not manufacture a video, challenge, consent, verified phone ownership, approved media, or payment-provider verification. It is not automatic approval for every recruited tailor.

## Repeatable process

1. Identify the exact profile and owning account. Check for test/dummy accounts, existing verification state and any prior exception case. Obtain explicit product-owner authorization and a specific recruitment reason.
2. Inspect the profile and public portfolio evidence through Ops. Confirm a usable display name, contact phone, profile image, specialties and portfolio records. Inspect separate safety cases; a video waiver does not approve media or override removals.
3. Resolve missing contact information before approval. Prefer the account owner's normal setup/settings flow. Any authorized support repair must target only the confirmed account, check duplicate numbers, preserve existing contact-change security, write an audit and verify persistence. Saving an owner-supplied phone is not proof of SMS ownership. Never fill a placeholder number merely to pass a gate.
4. Open the tailor's Ops record and choose **Review recruitment video exception**, or open `/ops/trust-exceptions?profileId=<exact profile UUID>` on `ops.drapeon.co`.
5. Renew protected workforce access when requested. An active administrator with fresh protected access is required; the sensitive session expires after 15 minutes. Do not weaken or circumvent authentication when it expires.
6. Record a specific reason (at least 20 characters) and recruitment/authorization reference (at least 8 characters). State explicitly that no challenge video was reviewed, what evidence was inspected, what is accepted temporarily, and who owns follow-up.
7. Record the request case/receipt. A pending request is NOT an approval. Re-read the current case after repairs or stale-state errors rather than replaying an old payload or opening duplicate cases.
8. After actual review and explicit authorization, acknowledge the public-evidence review and missing-video waiver. Use **Approve waiver and activate storefront** or reject the waiver. Rejection preserves the original trust state; approval is an audited protected transition.
9. Retain the terminal decision receipt. Re-read production state and reload Ops: approval should show `VERIFIED`, `is_live=true`, `is_verified=true`, with `approval_basis=RECRUITMENT_VIDEO_WAIVER` and `video_reviewed=false`. A terminal decision must not reopen controls; supported retries recover the existing receipt.
10. Check the public gateway and actual public web page, not just DB flags. Inspect images separately, verify the brief link targets this tailor, and record what remains untested on native apps. Do not equate storefront visibility with successful paid checkout.
11. Assign recruitment follow-up and record outstanding portfolio, business-name, fulfillment and payment-provider work. This workflow does not send email/push; notifications must be explicitly requested and their delivery proven separately.

### Stale evidence recovery (2026-09-29; Development verified, not yet production)

If setup is saved after an exception request, the profile timestamp no longer matches the case's evidence snapshot. A longer reason or rechecking boxes cannot repair that mismatch. Do not patch verification flags or weaken the stale-state check.

The scoped recovery adds a visible stale warning and **Refresh reviewed evidence snapshot**. Review the current public evidence, supply the reason/reference and acknowledgements, then refresh. Refresh writes a versioned audit/event/receipt only; it does not activate the storefront. The acknowledgements reset, and a separate protected approval is required. Terminal cases cannot be reopened, and retries recover receipts. Concurrent profile edits remain rejected.

Implementation and release evidence: [stale waiver recovery](trust-exception-stale-recovery-evidence-2026-09-29.md). Do not instruct a production operator to use this new control until its production deployment is verified.

### Suggested reason template

> Owner-authorized recruitment exception: [tailor] missed the challenge-video step. No challenge video was reviewed. [Profile/portfolio evidence] was inspected. [Owner] accepts [specific temporary limitation]. [Recruitment owner] will obtain [outstanding updates]. Media-safety review, phone ownership verification and payment-provider verification remain independent.

Do not paste the template without checking its claims against this particular case.

## Case: Oladimeji Mahuntan

| Record | Value |
| --- | --- |
| Date / environment | 2026-09-28 / production |
| Profile | `bf63097d-16b4-4504-ab69-c8d6c92a5d6a` |
| Account | `f27f55bb-cc0a-4af1-bab4-eab534dee0af` |
| Exception case | `OPS-9D076893` |
| Request receipt | `4af15d96-823a-42c3-adbe-55662cfe2ce6` |
| Approval receipt | `6966411c-2a31-443d-b60c-c050f9a1e592` |
| Ops workspace | [Protected recruitment review](https://ops.drapeon.co/ops/trust-exceptions?profileId=bf63097d-16b4-4504-ab69-c8d6c92a5d6a) |
| Public profile | [Oladimeji Mahuntan](https://drapeon.co/tailors/bf63097d-16b4-4504-ab69-c8d6c92a5d6a) |

### What happened

- Recruitment had not explained the video submission requirement; there was no challenge video. The product owner explicitly authorized a documented waiver and temporarily accepted the existing profile/portfolio, with follow-up promised.
- The protected approval initially refused to proceed because the account had no persisted contact phone. No verification-status SQL patch was used to get around this gate.
- The owner supplied the real contact. An identity- and duplicate-guarded support repair filled the empty canonical account contact and auth contact metadata, recording `account.onboarding_phone_support_repair`. Contact ending **6255** was read back successfully. `phone_verified_at` remained null: no SMS verification was claimed. The full number is intentionally not duplicated in this document.
- After renewed Cloudflare protected access, the administrator approved through Ops. Production readback confirmed live/verified/VERIFIED; the terminal waiver receipt survived reload. The record explicitly says no video was reviewed.
- Storefront approval did not publish media automatically. The avatar and portfolio initially had separate PENDING_REVIEW records, so the public API withheld all their URLs. The website incorrectly interpreted that as a nonexistent profile.
- The web detail mapper was corrected to retain the approved profile with a clear unavailable-portfolio state. Production release `2139ec41-77d9-46af-9fd8-2c2797ce6178` was built in an isolated checkout; unrelated dirty web/mobile changes were excluded. Exact public profile and nonexistent-profile behavior were inspected live. No media-safety filter was removed.
- Following the owner's media approvals, the public API returned two portfolio images and the avatar. Avatar reference **DD52DBA5**, full asset `dd52dba5-da12-4031-89d4-be18363ad516`, is ACTIVE/APPROVED, reviewed at `2026-09-28T17:32:20.43406+00:00`. Its approval audit correlation is `de6fd032-da3f-483a-9722-57b8d5755fbf`; media issue `d4f03321-b386-49dd-a59b-d2655f83ef53`.
- The avatar is not a portfolio piece. The current web renderer prioritizes portfolio media and does not separately display the avatar beside the name when a portfolio exists. This remains a rendering follow-up, not a failed moderation approval or missing upload.

### Currency and business-name boundaries

The public price guide was verified as **NGN** after the earlier owner-requested USD-to-NGN conversion. This document does not reconstruct an unrecorded FX rate or certify the pricing amounts. The last payout readback remained **USD / Stripe / unverified**: payout setup was not changed by trust approval. Recruitment must clarify the tailor's intended payment/provider setup; do not assume the public pricing currency proves provider readiness.

The profile's `business_name` was empty. **Tunic** is currently the title of two seller items in category **Kaftan**, not evidence of a business name. No business-name change was made; await the tailor's confirmation before updating it.

### Outstanding follow-up

- **Recruitment (owner has contacted them):** obtain a substantially stronger portfolio with clear full-outfit photos and fit/finishing close-ups; confirm business name and intended storefront presentation. Do not feature the current portfolio in launch marketing yet.
- **Tailor / recruitment:** clarify and finish payment-provider setup; storefront approval alone does not establish paid-order readiness. Audit fulfillment-origin readiness separately before promising a submission/checkout path.
- **Web engineering:** render an approved avatar independently beside the profile name without counting it as a portfolio item. Not implemented in this case's closeout.
- **Engineering release:** the preventative server phone-save fix is deployed to production as `account-profile-action` version 42. Mobile source now confirms persistence before advancing, but the owner deferred app builds. Installed clients may retain their local OTP bypass until a later app release. Authenticated production/native setup E2E remains outstanding; do not mistake this account's manual repair or server deployment for fleet-wide client rollout.
- **Trust follow-up:** any later challenge-video submission must use the real randomized workflow. Do not rewrite this historical waiver to claim that a video was reviewed.

## Verification limits and supporting evidence

Verified for this case: protected production approval and durable receipt, canonical contact persistence, unchanged payout readiness, public API visibility, live public web rendering and avatar moderation audit. No new mobile build, full native setup/capture, paid order, push/email delivery, or fleet-wide production-health certification is claimed.

See [implementation and deployment evidence](protected-trust-exception-development-evidence.md), [phone-save prevention evidence](tailor-onboarding-phone-save-evidence.md), and [trust verification contract](drapeon-trust-video-verification.md). The protected Ops case/audit/receipts remain authoritative; this document is the operational explanation, not a replacement for them.

## Case: Kenny Abdullahi (2026-10-02)

Production profile `836574ea-42dd-4c31-8391-c79933f81f85` has exception case `OPS-CFD34A87`. The case has a persisted waiver **request** receipt and no decision receipt. A read-only production query confirmed a name, avatar, specialties and portfolio are present, but the owning account has no nonblank phone. The approval RPC checks all five fields and raises `Non-video profile requirements missing` when any is absent. This explains the failed approval; the current production Ops response collapses that database reason into a generic conflict. The profile remained `NOT_SUBMITTED`, `is_live=false`, `is_verified=false` at the readback.

Recruitment should obtain Kenny's real number from him, then have him save it through the normal account flow. If that cannot work, use the audited support repair in step 3 after checking the exact account and duplicates. Re-read the profile and protected case before any separate approval decision. Do not enter a placeholder phone or claim SMS ownership verification. Public media-safety cases and payout readiness still require their own review.

### Ops repair status (2026-10-02)

The local Ops repair now displays the five approval prerequisites, leaves approval disabled when any prerequisite cannot be read or is missing, and gives a specific recovery instruction for a missing account phone. The protected broker returns actionable conflict text and a correlation reference; malformed local requests are distinct from interrupted database requests. A Development-only stale-case fixture was inspected in the authenticated browser and a read-only reload restored the same pending state. No waiver decision was made during this test.

Migration `20261002130000_record_recruitment_waiver_method.sql` was applied to **Drape- DEV** only and recorded in its migration history. A readback of `ops_trust_exception_action_snapshot_v1` confirmed future approvals there now write `ADMIN_RECRUITMENT_WAIVER`, not `CHALLENGE_VIDEO`. This changes no existing verification records. The separate pending diary-invite migration was not applied. Development database lint ran but failed on an unrelated existing function, `update_account_currency_with_price_conversion`, which compares text to UUID. This lint gate is not green; the waiver function's successful compile/readback does not waive it. Neither this migration nor the Ops broker/UI repair has been promoted to production; do not describe Kenny as approved or live.

The isolated release checkout `codex/ops-waiver-20261002` passed the Ops build, full Ops lint/typecheck, Edge typecheck, targeted waiver tests, and `pnpm launch:contracts`. It was not pushed or deployed. A read-only production migration-history check found more than five pending local versions, including the four 2026-09-29 waiver-refresh versions and this new migration, plus production-only 2026-09-28 versions absent from this checkout. Some waiver function changes may have been applied manually, but history alone does not establish which function bodies are live. Do not run a broad migration push or mark missing history entries applied without inspecting the actual production functions and reconciling the backlog. Ops web and Edge are separate release units and also remain unchanged in production.

A subsequent direct production SQL inspection on 2026-10-02 confirmed the active waiver wrapper and snapshot function both exist, and the active wrapper contains `REFRESH` and calls the snapshot. None of the four 2026-09-29 refresh versions or the 20261002130000 method correction appears in `supabase_migrations.schema_migrations`. The snapshot still writes `CHALLENGE_VIDEO`, not `ADMIN_RECRUITMENT_WAIVER`. A protected recruitment waiver completed for profile `a55ad11a-9657-4eec-bdae-279121ea1d3c` after a separate phone-only repair: its metadata records `approval_basis=RECRUITMENT_VIDEO_WAIVER`, `video_waived=true`, `video_reviewed=false`, but its method is `CHALLENGE_VIDEO`. This is live evidence of the labeling defect, not evidence that a video was reviewed. Do not rewrite this historical verification record under the preventative migration; reconcile migration history and promote the forward fix before claiming future waivers have truthful method labels.
