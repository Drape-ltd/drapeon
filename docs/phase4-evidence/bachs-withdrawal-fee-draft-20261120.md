# Bachs withdrawal fee reserve: Dev draft evidence

This is a draft, Dev-only implementation. It is not a completed payout proof or a Production release candidate.

## State and verification

- Source branch: `codex/bachs-payout-fee-reserve-20261120` (draft PR #273).
- Exact migration `20261120180000` was applied to Dev project `pqptfuqogvrajozfsqzi` after an isolated local apply, guard, negative-case, and rollback rehearsal. Dev has both claim and audit tables with RLS enabled, two active guards, zero withdrawal claims, and zero enabled payment routes.
- The `bachs-withdrawal-action` Edge function is deployed to Dev with its mutation gate off (`BACHS_SANDBOX_WITHDRAWAL_PROOF_ENABLED` is unset). A service-authenticated `START` probe returned `WITHDRAWAL_PROOF_DISABLED` and left zero claims.
- A service-authenticated read-only `BALANCE` probe for synthetic destination `3300fa5b-e261-4e1b-b59e-aa07f40f3e20` returned provider `403 FORBIDDEN` with both the regular sandbox key and the separate sandbox payout key. The key-scope versus account-capability cause is unverified. No reserve transfer, payout, or sweep was sent.
- The Bachs sandbox dashboard itself shows the synthetic connected account as Live with payouts on and NGN 300.00 available. Its activity shows a previous NGN 100.00 payout failed and returned to that balance. This narrows the failure to API access or request scope; the dashboard balance does not authorize bypassing the API preflight.
- The claim flow persists each provider ID before advancing; an uncertain response is recovered by GET or bounded list lookup, never by repeating a POST. The fee ledger call is keyed by claim ID. This has not yet been exercised against a provider payout.

## Remaining proof

1. Resolve sandbox balance-read permission for the synthetic connected account without exposing key material.
2. Test the claim state machine, including two concurrent advances, a provider success followed by a failed receipt write, a pending first payout, an actual fee at or below reserve, and a fee above reserve.
3. With the Dev mutation gate temporarily enabled, prove reserve transfer, payout for the earned amount, final provider fee, platform-cost ledger entry, unused-reserve sweep, and replay with no duplicate. Return the gate to off immediately afterward.
4. Record provider, claim, transfer, payout, sweep, ledger, and event IDs only, then seek exact-head review before any merge or Production release.

The Android API 35 Dev client at source `7b75357e` signed in the synthetic receiving tailor for order `b075928d-33db-4be9-a8e5-b5ed4ec74eac`. Its dashboard shows that order as paid. Opening the order redirects to the unfinished tailor-profile setup, so the order-detail and NGN 109.65 rendering remain unverified. The profile's trust status was not changed.
