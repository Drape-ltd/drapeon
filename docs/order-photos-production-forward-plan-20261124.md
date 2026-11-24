# P1: private order-photo Production-forward release plan

**No Production change has been made.** Read-only Production preflight on 2026-11-24 found `storage.buckets.order-photos.public=true`, 16 objects, both existing party policies, none of the three old Dev source versions or three new forward versions in migration history, and the Production guard marker `20261124170000` present. The old policies permit only `brief`/`briefs` owner and `progress` order-party access. Public download bypasses that intended policy boundary.

## Exact forward set, each separately applied in order

| Version | Scope | Source relationship |
| --- | --- | --- |
| `20261124190000` | Replace party read policy; assigned tailor may read exact linked legacy brief path. | Forward form of `20261123190000`. |
| `20261124190100` | Replace party read/upload policies for `progress`, `receipts`, `fabric-receipts`, `vision-qc` and legacy brief paths. | Forward form of `20261123193000`. |
| `20261124190200` | Require both policies, then set only `order-photos` private. | Forward form of `20261123195000`. |

Each file checks the Production-only `20261124170000` ledger marker and UUID `orders.id`/`tailor_profiles.id` shape before changing anything. Dev lacks that marker and is not a target. The UUID policy expressions use indexed UUID equality for order/profile joins, with a guarded cast for object-path segments; the older Dev expressions compare text IDs. The bucket switch never rewrites stored references or modifies other buckets. Apply by exact version only, never a broad migration push.

## Preflight immediately before any approved release

1. Confirm project `wkfsrunetmgjdtcurmoj` and the two UUID column types, guard marker present, all three new versions absent, old Dev versions absent, `order-photos` public with the object count recorded, and exact current read/upload policy definitions unchanged from this worksheet. Stop on any drift.
2. Inventory object prefixes and legacy reference forms by aggregate counts; record no paths or signed URLs in the PR. Confirm the deployed web/mobile/Edge clients normalize legacy URLs and call `createSignedUrl` for this bucket. Confirm service-role Ops and notification readers do the same.
3. Require Dev proof below, a Production-shaped local PostgreSQL replay, `git diff --check`, migration lint, Advisors baseline, and a founder approval naming the exact three versions. The three files run in three transactions and stop at the first error.

## Dev evidence and remaining gates

- Dev `order-photos` is already private. Read-only Dev role simulation on one existing progress object returned visible=1 for its customer and assigned tailor, visible=0 for an unrelated UUID. An assigned tailor could read a linked legacy brief object; an unrelated UUID could not. This proves current Storage RLS selection, not an actual signed HTTP download.
- An unauthenticated GET of an existing Dev object's `/storage/v1/object/public/order-photos/...` URL returned **HTTP 400**; no object bytes were retrieved.
- The existing shared writer contract passed 2/2, and a disposable Production-shaped UUID Postgres rehearsal applied all three forward files and passed customer/tailor/unrelated policy checks. These are code and database checks, not UI coverage.
- **Still required before Production approval:** actual signed URL reads on Dev customer web and mobile order detail, tailor order detail, Ops evidence views, and photo links composed by email/push. Record only screen/result and synthetic order IDs; never record signed URLs or object bytes. Until those checks pass, the bucket switch remains held.
- **Style-alignment repair in this PR:** `tailor-order-action` now accepts the private `progress/<order>/style-alignment-*` object path (and normalizes legacy public/signed delivery URLs to that path) before saving and queuing review. Its focused tests cover both path forms and reject another order's path. The Edge function must be deployed to Dev and an actual style-alignment submission checked there before the bucket switch. An Edge release from merged code would be a separate Production approval.
- A source search across web, mobile, Ops and Edge found no other `getPublicUrl('order-photos')` or hard-coded public order-photo URL consumer. Generic mobile/web `getPublicUrl` helpers explicitly return a private object path for this bucket; customer/tailor/Ops readers and order email mint signed URLs. This code review does not replace the signed HTTP screen checks above.

## Postflight and forward recovery

After each policy version, verify the ledger marker, authenticated-only policy role, expected `qual`/`with_check`, unchanged bucket visibility and object count, and no new Storage permission errors. After `20261124190200`, verify bucket private, all 16 preflight object IDs still present, anonymous public URL returns 400/403, authorised customer/tailor signed URLs return 200, unrelated account cannot mint one, and Ops/email/push evidence links work. Recheck Security/Performance Advisors and Storage error rates. No payment route changes.

If a private reader fails, **leave the bucket private** and roll forward with a narrow reader or policy compatibility repair. Restore the last reviewed policy expression only if it preserves the private-bucket party boundary. The exact operational rollback is to disable the affected reader/write feature, restore its last reviewed Edge/web bundle where applicable, and repair the private reader; it does **not** revert `storage.buckets.public=false`. Reopening public access would expose all stored order photos again and is an emergency privacy exception requiring a new, explicit founder decision and incident record. Do not delete objects, replay old Dev migrations or expose signed URLs in incident logs. Escalate affected order IDs to Ops and hold the release until a party-scoped fix is proven.
