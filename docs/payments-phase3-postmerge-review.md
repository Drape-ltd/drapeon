# Phase 3 post-merge review

Reviewed merge: `c654fea0068998e00b28581a0559ba2d3d4600a0`  
Implementation head: `fcc14a1e88236ff5b0ef25fe8d2488594d5790d2`  
Requested range: the 54 first-parent commits after `750e23e5` through
`fcc14a1e` (`git rev-list --count --first-parent` = 54).

## Edge deployment parity

The approved 41-function Production deployment used reviewed head
`288acd6cf0fa5106ed0ceb80a97e0b01a4c24571`. The deployment is recorded by the
immediately following evidence commit `6674a56b`. The exact manifest is in
`payments-phase3-production-release-plan.md`.

A path-scoped diff from `288acd6c` to merged `c654fea0`, covering all 41
function directories and `supabase/functions/_shared`, is empty. The four later
pre-merge commits touch only Phase 3 evidence, Dev-account documentation, and
mobile readiness presentation. There is no undeployed Edge delta hidden by the
merge.

## Money-path review

| Path | What it guards | Fail-closed behavior | Test/evidence |
|---|---|---|---|
| `commercial-adjustment-action` | Separates TAILOR/FULFILLMENT/MATERIAL allocation, blocks unsupported adjustment refunds, binds payment preparation to the accepted route, and requires delivery evidence for a tailor-adjustment earning. | Unsupported/refunded/unready adjustments create or retain reviewed Ops work; no provider call, earning mutation, or fallback provider is selected. | Shared commercial-adjustment and Money Desk tests; Dev deployment evidence in `payments-phase3-progress.md`. **Gap:** no function-level integration test drives every action branch. |
| `_shared/ops-money-execution` | Allows only a reviewed `TAILOR_ADJUSTMENT_PAYOUT` execution and routes unsupported adjustment refunds to the visible fail-closed issue builder. | Missing review, wrong purpose, or unsupported refund stops before provider execution. | `reviewed-adjustment-payout_test.ts`, `money-desk.test.ts`, and Money Desk contract checks. |
| `monitor-settlements` | Reconciles Bachs payment settlement evidence, overdue transfers, and reviewed adjustment-payout readiness without inventing a provider result. | Missing exact Money Desk linkage opens/retains a case and does not call the provider; unknown outcomes remain pending. | Bachs settlement/reconciliation unit tests and Dev runtime evidence. **Gap:** no dedicated test invokes the monitor end-to-end with a real queue row. |
| `_shared/bachs-operations` | Centralizes authenticated Bachs reads/writes, idempotency keys, sandbox withdrawal operations, and provider response typing. | Non-2xx or malformed provider responses throw; callers preserve claim state and reconcile by provider ID rather than create a second operation. | `bachs-operations_test.ts` and `bachs_test.ts`; provider-sandbox proof remained incomplete at merge and is a Phase 4 gate. |
| `release-tailor-adjustment` | Releases one accepted TAILOR adjustment only after immutable capture, route, destination, delivery+72h, review, and claim checks. | Any mismatch, open refund/dispute, unready destination, or unsupported provider stops before transfer; uncertain provider results retain the same claim for lookup-only recovery. | `reviewed-adjustment-payout_test.ts`, payout-purpose contract test, SQL guard tests, Dev deployment evidence. **Gap:** Stage 1 must prove a signed sandbox transfer and duplicate replay. |

## New migration review

| Version/file | Guard and failure mode | Test coverage |
|---|---|---|
| `20261029043814_phase3_consultation_adjustment_claim_guards_forward.sql` | Restores eight consultation/adjustment identity, refund-hold, exact-payment and released-entitlement guards. Ambiguous/mismatched claims raise before mutation. | `supabase/tests/phase3_consultation_adjustment_claim_guards.sql`; local rollback and Dev/Production postflight recorded. |
| `20261029062510_phase1_fabric_worker_wakeup_forward.sql` | Adds `PROCESS_FABRIC_RELEASE` to the bounded event-driven wake/recovery path while durable queue rows remain authoritative. Invocation failure is a warning and the row remains retryable. | Local/Dev migration rehearsal and Production scheduler/trigger postflight. **Gap:** no isolated automated race test for wake failure plus recovery. |
| `20261029063007_phase1_legacy_dispute_rpc_acl_forward.sql` | Revokes public/anon/authenticated execution of the legacy SECURITY DEFINER dispute resolver and leaves service-role-only access. | Migration self-check plus Production ACL postflight. **Gap:** no pgTAP/SQL regression file calls each rejected role. |
| `20261029131928_20261029082845_route_aware_reviewed_adjustment_payout.sql` | Freezes the adjustment business key, operation key, order route snapshot, provider, destination, exact capture, earning, delivery evidence and review. Any divergence raises before claim/provider work. | `reviewed-adjustment-payout_test.ts`, payout-purpose contract test, Dev/Production guard verification. **Gap:** Stage 1 sandbox proof must exercise the complete provider path. |
| `20261029132040_20261029132019_tailor_adjustment_delivery_confirmation_index_policy.sql` | Adds the order lookup index and an owner-scoped authenticated read policy using `auth.uid()`. Non-parties see no rows. | Dev/Production policy/index postflight. **Gap:** no standalone RLS test with customer, tailor, and stranger sessions. |

Rollback files exist for `20261029043814`, `20261029131928`, and
`20261029132040`. The ACL and worker-wakeup repairs are forward-only operational
repairs and intentionally have no destructive rollback; corrective roll-forward
is the safe recovery strategy.

## Migration name/history reconciliation

| Source file | Dev history | Production history | Rollback file |
|---|---|---|---|
| `20261029131928_20261029082845_route_aware_reviewed_adjustment_payout.sql` | version `20261029131928`, name `20261029082845_route_aware_reviewed_adjustment_payout` | version `20261029131928`, name `20261029131928_20261029082845_route_aware_reviewed_adjustment_payout` | `20261029131928_route_aware_reviewed_adjustment_payout.rollback.sql` |
| `20261029132040_20261029132019_tailor_adjustment_delivery_confirmation_index_policy.sql` | version `20261029132040`, name `20261029132019_tailor_adjustment_delivery_confirmation_index_policy` | version `20261029132040`, name `20261029132040_20261029132019_tailor_adjustment_delivery_confirmation_index_policy` | `20261029132040_20261029132019_tailor_adjustment_delivery_confirmation_index_policy.rollback.sql` |

The authoritative applied versions match in Dev and Production; the descriptive
names do not match exactly because the projects recorded these files through
different release mechanisms. Do not edit history. For release and rollback,
address these migrations by the leading applied version. A future docs-only
cleanup may add aliases to the rollback runbook, but applied migration filenames
remain immutable.

## 54-commit first-parent ledger

The range contains 12 implementation/security/test commits and 42 evidence or
release-control commits. The implementation commits are reviewed above or below;
the remaining commits update evidence without changing a money path.

| Commit | Classification and review result |
|---|---|
| `6d1471f0`, `76021d8c` | Release-status/scope docs; no runtime change. |
| `922c23b6` | Consultation/adjustment claim guards; fail-closed SQL test present. |
| `7c72ea36`, `f35f4924`, `1da21000`, `01005ae6` | Cloudflare/migration release evidence only. |
| `d332ef1e` | Cloudflare branch build guard; non-main or missing branch metadata fails before Production build. Covered by `cf-build-mode.test.mjs`. |
| `478d481d`, `5f2daf8c` | Sandbox withdrawal/review-boundary docs only. |
| `1d37ff49` | Bachs sandbox withdrawal API operation; provider errors remain nonterminal. Covered by Bachs operation tests; signed provider completion remains Stage 1 evidence. |
| `4287f16a`, `0aaac56e`, `65d3a864`, `6f34ecf7`, `4ce4249c`, `70012276`, `537e9663` | Provider/release evidence only. |
| `a724a0cf` | Durable fabric worker wakeup repair; bounded recovery preserves the row. Automated wake/recovery race test is missing. |
| `14725e50` | Legacy dispute resolver restricted to service role. Role-level regression test is missing. |
| `425fcce9`, `453ff21c`, `c9f0603b`, `63a7ff7f`, `af7b095c`, `b298ad66`, `42ef2cc4`, `dcd98c65`, `639b840c`, `eecbd9d5`, `b6f0d230`, `81d230c1`, `338f5a39`, `5ade51ba`, `0eca6b9b`, `e63c184c`, `37928624`, `43fdc2ae` | Reconciliation, release, or provider-gate evidence only. |
| `7ab04aee` | Reviewed tailor-adjustment claim/releaser foundation; immutable claim and fail-closed route/destination/capture checks. Tests noted above. |
| `349a054a`, `ac3835e8` | Provider requirements and Production release evidence only. |
| `c3b7aab1` | Unsupported adjustment refunds become a visible reviewed case, with no provider call. Covered by shared Money Desk tests; no full function integration test. |
| `02bc9441` | Dev deployment evidence only. |
| `3a41745d` | Web delivery-status guard for adjustment review; avoids presenting incomplete delivery as payable. Static/type checks only; visual proof deferred. |
| `84c2221b` | Adds adjustment payout purpose to payment contract coverage. |
| `de817776`, `91479675`, `4f05f7da`, `288acd6c`, `5ca1c804`, `6674a56b` | Webhook, route-disable, release and Edge-deployment evidence only. |
| `8edd8b9a`, `fcc14a1e` | Mobile paid-order readiness presentation; no money mutation. Typecheck/lint passed; visual evidence recorded. |
| `0f5fb741` | Dev E2E account documentation only; no credential stored. |

## Review conclusion

The merged Edge scope matches the deployed 41-function source. The money paths
fail closed on missing review, ambiguous identity, unready destinations,
unconfirmed provider state, and unsupported refunds. The open test gaps are
explicit above and belong in Phase 4 Stage 1; none authorizes a route today.

