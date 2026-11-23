# C2 payout writer audit

Scope: every current Edge write to `payouts`, every live database routine that changes
`payouts.status`, and the provider event/watchdog paths requested in PR #86. Read-only
references and writes to `provider_payout_events`, claims, attempts, tips, tranches, or
adjustments are not counted as payout status writers. Historical definitions replaced by
later `create or replace function` migrations are listed separately.

## Guarded transition matrix

| From | Allowed payout-status destinations | Evidence / condition |
|---|---|---|
| PENDING | PROCESSING, PAID, FAILED, CANCELED, BLOCKED | ordinary forward processing |
| PROCESSING | PAID, FAILED, BLOCKED | ordinary terminal processing |
| PROCESSING or PAID | REVERSED | `drape.payout_reversal=evidenced` only |
| PROCESSING or PAID | FAILED | `drape.payout_returned_funds=evidenced` only; confirmed returned funds |
| FAILED or BLOCKED | PROCESSING | reviewed destination correction, new provider operation number |
| BLOCKED | FAILED, CANCELED | terminal Ops disposition |
| PAID, FAILED, CANCELED, REVERSED | anything else | blocked |

Same-status updates remain legal. Bank-settlement fields are not status-transition gates,
so a later bank failure can be recorded without pretending that a completed provider
transfer moved backward. Claim-bound provider, amount, currency, destination, and transfer
ID are immutable except for the reviewed two-person correction operation.

## Edge and shared-runtime writers

| Writer / call sites | From -> to | Guard result | Proof |
|---|---|---|---|
| `stripe-webhook` via `apply_stripe_transfer_event_to_payout` | PENDING/PROCESSING -> PROCESSING; PROCESSING/PAID -> REVERSED | allowed only after transfer identity verification; late `transfer.created` on PAID/REVERSED is a no-op | `payout-transfer-event_test.ts`; `c2_forward_only_payouts.sql` |
| `bachs-webhook` payout-event block | no individual payout write | n/a; writes account-level `provider_payout_events` with `payout_id = null` | source contract in this document; webhook classification tests |
| `bachs-transfer-watchdog` | no payout write | n/a; pure age/notification assessment | `bachs-transfer-watchdog_test.ts` |
| `release-order-tip` lines 83, 129, 310, 412, 442, 457 plus `_shared/tip-payout.ts` lines 155, 258 | new/PROCESSING -> PROCESSING/PAID/FAILED | allowed; PAID cannot be reopened by OTP/retry writes | `tip-payout_test.ts`; `tip_payout_runtime_claim_gate.sql`; `c2_forward_only_payouts.sql` |
| `release-settlement-tranche` claimed route | new -> PROCESSING; PROCESSING -> PAID/FAILED | allowed; concurrent loser returns 200 with claim status and no Ops issue | `claimed-tranche-payout_test.ts`; `claimed-payout-execution_test.ts`; `phase3_claimed_route_tranche_finalize.sql` |
| `release-settlement-tranche` legacy Paystack/Stripe route | new -> PROCESSING -> PROCESSING/PAID; PROCESSING -> FAILED before confirmed completion | allowed; any attempted PAID regression is blocked | `c2_forward_only_payouts.sql`; static type check |
| `release-tailor-adjustment` (claim RPCs own the payout write) | new -> PROCESSING; PROCESSING -> PROCESSING | allowed; concurrent loser returns 200 with claim status and no Ops issue | `claimed-payout-execution_test.ts`; `phase3_consultation_adjustment_claim_guards.sql` |
| `release-order-payouts` (`insertBlockedPayout`, `updatePayoutRow`, release paths) | new -> BLOCKED/PROCESSING; PROCESSING -> PROCESSING/PAID/FAILED | allowed; PAID/REVERSED regression blocked | `payout_provider_operation_attempt_tracking.sql`; static type check |
| `release-consultation-earning` lines 135, 153, 181, 198, 209 | new -> PROCESSING; PROCESSING -> PROCESSING/PAID/FAILED | allowed | `phase3_consultation_adjustment_claim_guards.sql`; static type check |
| `material-advance-action` lines 1640, 1687, 1852, 1902 | new -> PROCESSING; PROCESSING -> PROCESSING/PAID | allowed | `c2_forward_only_payouts.sql`; static type check |
| `_shared/fabric-release.ts` lines 171, 207 | new -> PROCESSING; PROCESSING -> PROCESSING/PAID | allowed | `c2_forward_only_payouts.sql`; static type check |
| `paystack-webhook` line 1426 | PROCESSING -> PAID/FAILED | allowed; terminal payout cannot be reopened by a late event | webhook ordering contracts; `c2_forward_only_payouts.sql` |
| `monitor-settlements` line 113 | PROCESSING -> PAID/FAILED/CANCELED | allowed; only selects PROCESSING Stripe rows; bank fields remain independently writable | monitor source predicate; `c2_forward_only_payouts.sql` |
| `reverse-stripe-transfer` line 120 | PROCESSING/PAID -> REVERSED | allowed only through evidenced reversal flag; partial reversal keeps status | `c2_forward_only_payouts.sql` |

## Live database payout-status writers

| Routine / defining migration | From -> to | Guard result | Proof |
|---|---|---|---|
| `finalize_claimed_stripe_tip_payout` (`20261022034759`) | PROCESSING -> PROCESSING | allowed | `tip_payout_runtime_claim_gate.sql` |
| Bachs staged tranche finalizer (`20261028035153`) | PROCESSING -> PROCESSING | allowed; does not write destination; trigger merges response evidence | `phase3_claimed_route_tranche_finalize.sql` |
| `finalize_claimed_route_tranche_release` (`20261028061641`) | PROCESSING -> PROCESSING | allowed; idempotent EXISTING receipt | `phase3_claimed_route_tranche_finalize.sql`; `claimed-tranche-payout_test.ts` |
| `private.sync_returned_snapshot_tranche_payout` (latest: `20261030120000`) | PROCESSING/PAID -> FAILED | allowed only when FAILED_RETURNED has final failure ref, funds-return ref, and confirmation time; flag reset on success/error | `c2_forward_only_payouts.sql` (Stripe and Bachs cases) |
| destination correction apply (`20261028132459`) | FAILED -> PROCESSING | allowed only for linked approved correction and provider operation number > 1 | `phase3_snapshot_destination_correction_identity.sql`; `c2_forward_only_payouts.sql` |
| tip claim forward closure (`20261028210000`) | PROCESSING -> PROCESSING | allowed; response merged | `tip_payout_runtime_claim_gate.sql` |
| reviewed adjustment finalizer (`20261029131928`) | PROCESSING -> PROCESSING | allowed; response merged | `phase3_consultation_adjustment_claim_guards.sql` |
| Stripe transfer-event RPC (`20261030100000`) | forward/no-op/reversal as above | identity checked before mutation | `c2_forward_only_payouts.sql`; `payout-transfer-event_test.ts` |
| C2 destination repair (`20261030110000`) | no status change | allowed data-only destination repair from unambiguous claim evidence | migration preview/postflight |

Older payout-writing migrations (`20260429000001`, `20260429000003`,
`20260607031500`, `20260818100000`, `20260823150000`, `20261025020517`,
`20261026211141`) are schema/backfill or superseded function bodies. They do not execute as
additional runtime writers after the later `create or replace` definitions above. The C2
trigger still guards any legacy function body that remains callable.

## Bachs-specific conclusion

- `bachs-webhook` withdrawal events use the connected account ID to identify the provider
  account, then write an account-level settlement event. They never update an individual
  payout, destination, status, or `provider_response`.
- `bachs-transfer-watchdog` is pure assessment code and performs no payout mutation.
- Bachs tranche and adjustment finalizers do not overwrite `provider_destination_id`.
  Their status write is PROCESSING -> PROCESSING, and the C2 trigger merges rather than
  replaces `provider_response`.
- Confirmed returned Bachs funds use the same evidenced return path as Stripe and may move
  PAID/PROCESSING -> FAILED so the reviewed two-person correction and new operation can run.

