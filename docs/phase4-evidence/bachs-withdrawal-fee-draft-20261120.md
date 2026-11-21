# Bachs withdrawal fee reserve: Dev draft evidence

This is a draft, Dev-only implementation. It is not a completed payout proof or a Production release candidate.

## State and verification

- Source branch: `codex/bachs-payout-fee-reserve-20261120` (draft PR #273).
- Exact migration `20261120180000` was applied to Dev project `pqptfuqogvrajozfsqzi` after an isolated local apply, guard, negative-case, and rollback rehearsal. Dev has both claim and audit tables with RLS enabled, two active guards, zero withdrawal claims, and zero enabled payment routes.
- The `bachs-withdrawal-action` Edge function is deployed to Dev with its mutation gate off (`BACHS_SANDBOX_WITHDRAWAL_PROOF_ENABLED` is unset). A service-authenticated `START` probe returned `WITHDRAWAL_PROOF_DISABLED` and left zero claims.
- A service-authenticated read-only `BALANCE` probe for synthetic destination `3300fa5b-e261-4e1b-b59e-aa07f40f3e20` returned provider `403 FORBIDDEN` with both the regular sandbox key and the separate sandbox payout key. The key-scope versus account-capability cause is unverified. No reserve transfer, payout, or sweep was sent.
- Bachs' connected-balance contract requires `balance:read` and `X-Account-Id`. The shared client sends `X-Account-Id`, and its focused test asserts that header. The replacement key's scopes are still unverified. A direct GET check could not run because the Mac clipboard no longer held a sandbox key; no key value was displayed or recorded.
- The signed-in sandbox key list shows the payout-only key with read/write payouts, while the replacement QA key's collapsed scope summary does not display balance or connected-account access. The remaining scopes are hidden in that summary, so the exact scope mismatch remains unverified. Automatic approval review blocked expanding the credential row because it could reveal key material. No credential was read, copied, or changed.
- The state machine now has mocked-provider tests for reserve transfer, payout, final fee ledger entry, sweep, and terminal replay; a failed transfer-receipt commit recovers by provider lookup without another POST; concurrent advances commit one POST. These are code-path proofs, not a substitute for the sandbox money movement.
- A pending first payout leaves the fee and sweep untouched until a completed provider retrieval supplies final evidence. A fee above the configured reserve moves the claim to Ops review without booking or sweeping. Both paths pass mocked-provider tests.
- A read-only Dev destination check confirmed `BACHS`/`NG`/`NGN`, active transfers and payouts, a bank destination, and `CLEARED` first-withdrawal review. A separate Dev query confirmed zero enabled payment routes. These checks narrow the 403 to provider access and do not justify bypassing the provider balance preflight.
- The Bachs sandbox dashboard itself shows the synthetic connected account as Live with payouts on and NGN 300.00 available. Its activity shows a previous NGN 100.00 payout failed and returned to that balance. This narrows the failure to API access or request scope; the dashboard balance does not authorize bypassing the API preflight.
- The claim flow persists each provider ID before advancing; an uncertain response is recovered by GET or bounded list lookup, never by repeating a POST. The fee ledger call is keyed by claim ID. This has not yet been exercised against a provider payout.

## Remaining proof

1. Resolve sandbox balance-read permission for the synthetic connected account without exposing key material.
2. Test the claim state machine, including two concurrent advances, a provider success followed by a failed receipt write, a pending first payout, an actual fee at or below reserve, and a fee above reserve.
3. With the Dev mutation gate temporarily enabled, prove reserve transfer, payout for the earned amount, final provider fee, platform-cost ledger entry, unused-reserve sweep, and replay with no duplicate. Return the gate to off immediately afterward.
4. Record provider, claim, transfer, payout, sweep, ledger, and event IDs only, then seek exact-head review before any merge or Production release.

The Android API 35 Dev client at source `7b75357e` signed in the synthetic receiving tailor for order `b075928d-33db-4be9-a8e5-b5ed4ec74eac`. Its dashboard shows that order as paid. Opening the order redirects to the unfinished tailor-profile setup, so the order-detail and NGN 109.65 rendering remain unverified. The setup requires a profile photo, phone, real work sample and trust video. A plain synthetic placeholder photo was selected in the emulator, but no profile completion or trust approval was claimed. The profile's trust status was not changed.

## 2026-11-21 sandbox continuation

- Rotated the regular Bachs sandbox integration key at 18:39 UTC. The replacement has only balance, connected-account, payment, refund, transfer and payout scopes. The earlier exposed and superseded keys are revoked. No key value is recorded here.
- The earlier provider `403` was Bachs' Cloudflare layer rejecting a generic runtime `User-Agent`, not a connected-account permission failure. A descriptive server `User-Agent` returned `200` for platform balance, connected balance and the exact synthetic connected account; its reported parent was the platform. The shared adapter now sends that header, with a focused test.
- Dev still held a revoked `BACHS_SANDBOX_API_KEY`, which took precedence over the valid replacement `BACHS_API_KEY` and produced `401`. Removed only that stale Dev override. The redeployed Dev `bachs-withdrawal-action` then returned `200` for synthetic destination `3300fa5b-e261-4e1b-b59e-aa07f40f3e20`, with NGN 300.00 available. Production was untouched.
- Started Dev-only withdrawal claim `51a5ce0d-5037-42a2-982d-0893ffdb357d` for NGN 300.00. The NGN 100.00 fee-reserve transfer `tr_f4cf431da5d84f7296a48c9a` reached `paid` and was persisted. Payout `pay_9lgS1e9dz7tRQxju` completed and was persisted. The provider reported an actual NGN 50.00 fee and total debit of NGN 350.00; ledger entry `392bfa6b-9c3a-4086-9d3f-3cc4b0b8c1a5` booked that cost once.
- The connected account's API balance and Bachs dashboard both showed NGN 100.00 still available after the payout, whereas the reported total debit implies NGN 50.00. The dashboard activity listed the NGN 100.00 reserve transfer and NGN 300.00 payout, with no separate fee debit. The claim entered `REVIEW` with `CONNECTED_BALANCE_CHANGED_BEFORE_SWEEP`; **no sweep transfer was sent**. A focused mocked-provider test now reproduces this mismatch and verifies the fail-closed outcome. Bachs must explain which account paid the fee or correct the balance before an Ops-reviewed resolution. No second payout or transfer should be created for this claim.
- The Dev mutation gate was returned to off, and a new `START` probe received `403 WITHDRAWAL_PROOF_DISABLED`. The route remains disabled. This is partial sandbox proof, not a completed fee-reserve cycle.
