# Production ID-type compatibility audit — #219 and R2–R5

## Scope and method

This is a read-only compatibility review before resubmitting #219 Batch 1 and
before authoring any R2–R5 forward repairs. It compares each existing source
migration selected as semantic input for those plans with Drape-PROD's current
catalog.

Production uses native UUIDs for `orders.id`, `orders.customer_id`,
`orders.tailor_id`, `tailor_profiles.id`, `tailor_profiles.user_id`,
`payouts.order_id`, and `payouts.tailor_profile_id`. Its cross-version bridge
columns are text: `orders.id_text`, `payout_claims.order_id`,
`payout_claims.payout_id`, `payout_claims.source_id`,
`payout_claims.tailor_profile_id`, `order_settlement_plans.order_id`, and
`order_settlement_tranches.order_id`.

“Compatible” means the existing source either does not compare an ID, compares
native UUID values, or explicitly bridges both sides through an existing text
representation. It does **not** authorise historical replay. R2–R5 remain
forward-only repairs; their source files are reviewed only to identify the
compatibility rules their new replacements must preserve.

## Results

| Plan | Source / proposed migration | Result | Required disposition |
| --- | --- | --- | --- |
| #219 Batch 1 | `20261117170000_production_shared_order_policy_authenticated` | **Compatible.** It changes only the `TO` role and does not touch the existing predicate. Production currently has no policy with that name, so it is a guarded no-op. | Rehearse against UUID and text baselines; recheck policy existence immediately before promotion. |
| #219 Batch 1 | `20261117171105_fix_public_catalogue_profile_policy` | **Incompatible.** It recreates the predicate with `orders.customer_id = auth.uid()::text`; Production has UUID `orders.customer_id`. | Superseded for Production; never promote or marker-repair it. |
| #219 Batch 1 | `20261117190000`, `20261117191500`, `20261117194900` | **No ID comparison.** | Eligible only in the exact reviewed batch. |
| #219 Batch 1 | `20261117194812_restrict_tailor_profile_owner_columns` | **Functionally compatible.** The owner RPC compares both `user_id` and `auth.uid()` as text, so UUID and text baselines work. | Keep as the deliberate cross-schema bridge for the owner singleton lookup; do not transplant the pattern into indexed multi-row order predicates. |
| #219 Batch 2 | `20261118014508_phase4_production_tailor_profile_policy_helpers` | **Compatible by explicit bridge.** Both profile ID shapes are passed through the helper as text; this was already rehearsed for UUID and text. | Keep. It must precede B0b `is_test_profile` revoke. |
| #219 Batch 2 | `20261118022149_stage_tailor_profile_test_flag_revoke` | **No ID comparison.** | Keep in Batch 2 only. |
| R2 PAY-003 | `20261030030000`, `20261030040000`, `20261030060000` | **Compatible.** Payment IDs remain UUID; order-state guards compare through `order_id::text = orders.id::text` where the bridge is needed. | New R2 functions must retain the native-UUID/payment-ID and text-order bridge split. Do not replay historical source. |
| R3 dispatch refund retry | `20261108224000` | **Compatible.** It casts request target IDs to UUID only at UUID primary-key lookups and compares order identity through text. | Preserve this shape in the new forward replacement. |
| R4 payout identity/retry | `20261102204053`, `20261102210052`, `20261110140000`, `20261110150000`, `20261111180000` | **Compatible in the reviewed comparisons.** The tranche-close source uses `orders.id::text`, `payouts.id::text`, and payment `order_id::text` when it meets claim fields. | Use as semantic input only; keep bridge columns index-friendly by casting the UUID-side value rather than the indexed text bridge. |
| R4 payout identity/retry | `20261110130000_reviewed_claimed_payout_retry` | **Incompatible.** It compares `payouts.order_id` (UUID) directly with `payout_claims.order_id` (text) at multiple points, including the failed-payout lookup and retry result validation. | Do not replay. The R4 forward function must join via `payouts.order_id::text = payout_claims.order_id` (and retain native UUID comparison where both sides are UUID). Add a UUID-shape negative test before proposing R4. |
| R5 tax/fabric/tranche | `20261102180324`, `20261102182653`, `20261102200000` | **No cross-ID comparison in the migration body.** | Author as separate schema/data steps, as already planned. |
| R5 tax/fabric/tranche | `20261110042832_allow_accounted_non_tailor_refunds_for_tranches` | **Incompatible.** It directly compares `order_settlement_plans.order_id` (text) to `order_payments.order_id` (UUID), `orders.tailor_id` (UUID) to a text-cast plan value, and `payouts.order_id`/`tailor_profile_id` (UUID) to text claim values. | Do not replay. R5 needs a new Production-shaped forward implementation that uses `orders.id_text` and UUID-side `::text` bridges only at the text-boundary. Add an isolated UUID-schema payment/tranche/refund rehearsal. |
| R5 tax/fabric/tranche | `20261111120000_reverse_failed_refund_journal` | **Compatible in the reviewed comparisons.** Its plan/refund journal order identifiers are text and payment links are UUID. | Preserve the existing split in a forward replacement; prove it alongside the R5 source-payment test. |

## Consequence

There are two additional UUID/text blockers beyond the failed #219 source:

1. **R4:** `20261110130000` cannot be used as a Production migration source
   without replacing direct `payouts.order_id` UUID ↔ `payout_claims.order_id`
   text comparisons.
2. **R5:** `20261110042832` cannot be replayed on Production without replacing
   multiple UUID ↔ text comparisons in tranche reservation/finalisation.

These findings do not change currently deployed Production behaviour because
neither historical source was applied. They are gates on the future forward
repair designs. No marker repair may be used to claim either historical source
is applied.
