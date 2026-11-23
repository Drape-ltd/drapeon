# Phase 4 controlled live-proof plan

This runbook is preparation only. It does not authorize a live Bachs request,
an order, a payout, a withdrawal, or a route-state change. The public
`ng-ngn-ngn-bachs` route remains `DISABLED` throughout the proof.

## Purpose and boundary

The proof is one deliberately funded, Nigerian-corridor order that verifies
the production path after the Dev sandbox evidence recorded in
`docs/payments-phase4-progress.md`:

`collection -> signed settlement evidence -> one transfer -> account-level withdrawal`

It is not a launch. It excludes Stripe, Paystack, every non-NGN currency,
bank-transfer checkout, UK, Ghana, Kenya, public discovery and any normal
customer/tailor traffic.

## Preconditions — all required before proposing the proof

1. **Bachs country confirmation.** Ticket `#154675279` must either confirm
   that the live platform account country is Nigeria, or confirm in writing
   that explicit `country: "NG"` on every Nigerian bank-list and
   bank-resolution request is sufficient for live connected-account payouts.
   The adapter must continue to send the explicit country regardless of the
   account default.
2. **Live platform controls.** The owner enters Production-only Bachs secrets
   and registers both signed event subscriptions. A signed test delivery must
   be recorded for payment, account, transfer, refund/dispute and payout event
   families. No secret, account ID, bank details or event payload is recorded
   in Git.
3. **Exact deployed-source provenance.** The Bachs Production Edge functions
   must be traceable to a merged `main` SHA. The currently deployed source and
   this follow-up patch must be reviewed/merged and redeployed from that SHA;
   no unmerged worktree commit may remain the only source of a deployed
   function.
4. **Cloudflare release control.** An account admin verifies the active Worker
   version and that Workers Builds may publish Production only from `main`.
   The repository guard is supporting defense, not evidence of the account
   setting. No branch is pushed while that check is unresolved.
5. **Production state.** Read-only preflight confirms the single NGN/Bachs
   route is still `DISABLED`, there are no other enabled payment routes, and
   no prior Bachs order, payout destination, enablement request or approval
   exists.
6. **Real participant consent.** One named Nigerian customer and one named
   Nigerian tailor agree to the exact test. The tailor completes Bachs-hosted
   live KYC and adds their own real Nigerian bank account; Drapeon does not
   collect identity documents or bank credentials.
7. **Funding and amount.** Founder approval records the exact low NGN amount,
   expected processing disclosure, expected transfer amount, and the NGN 50
   withdrawal fee source. The transfer cannot be reversed, so the founder also
   approves the recipient before any provider request.
8. **Ops ownership.** A named operator is available for the proof and its
   refund/incident response. This is distinct from the later two-person route
   enablement requirement.

## Controlled access design — must be built and reviewed before use

The public resolver must remain unavailable. A separate server-side proof
allowlist may be proposed only after the preconditions above are met. Its
contract must be:

- one immutable proof ID, one exact customer, one exact tailor, one exact NGN
  amount, one expiry and one route version;
- accepted only by a service-side proof action; no client flag, URL parameter,
  profile field or UI toggle can select it;
- checks every normal route/delivery/payout-readiness rule plus the immutable
  proof tuple;
- creates one initial-order attempt with the ordinary fixed idempotency key and
  uses the ordinary Bachs webhook, claim, ledger, refund and transfer paths;
- rejects every other order, phase, currency, country, payment method and
  account; expires automatically and has an audited manual kill switch;
- has a negative test proving that neither a second order nor an altered amount
  can reach Bachs while the public route is `DISABLED`.

No proof allowlist is implemented or active today.

## Execution sequence — requires a separate founder approval

1. Record the approved amount, participant references and expected timeline in
   an Ops case. Keep identifiers and provider references in the authenticated
   case only, never this repository.
2. Re-run the preflight above immediately before collection. If any condition
   differs, stop without creating checkout.
3. Create the single hosted NGN card checkout with the locked customer total.
   The customer sees the stored `Payment processing` disclosure before the
   handoff. Record the checkout reference in the Ops case.
4. Confirm only from signed Bachs collection/settlement evidence and the
   matching provider GET. If they disagree, leave the order unresolved and
   open the existing Money Desk path; never infer a fee or success.
5. Complete real delivery/local-handoff evidence. Release only the
   snapshotted first tranche through the existing claim path. Verify the
   provider transfer, immutable claim, attempt and commercial ledger agree.
6. Have the tailor initiate their own bank withdrawal. Track the provider
   payout at the connected-account level, including the withdrawal fee. Do not
   attach a bank withdrawal to a single earning.
7. Keep the remaining tranche subject to the normal policy. Do not accelerate
   it merely to finish the proof.
8. Exercise the ordinary refund/dispute response only if a genuine approved
   test condition requires it. Transfers are not reversed; any post-transfer
   refund follows the Drapeon-funded/reviewed path.

## Success evidence

The proof passes only when the authenticated Ops case contains identifier-only
evidence for all of the following:

- locked accepted-route/entity/destination/fee/terms snapshot;
- customer checkout, signed collection event and provider-read settlement net;
- one capture ledger entry and fee reconciliation with the disclosed amount;
- one payout claim, one provider operation and one transfer to the verified
  connected account;
- account-level payout event showing the tailor's withdrawal terminal result;
- route remains `DISABLED`, no public order can begin Bachs checkout, and the
  proof allowlist is expired/revoked;
- queue, webhook, settlement-monitor and Ops-case health are normal after the
  run.

Any unknown, duplicated, unsigned, late or mismatched event is a failed proof,
not a condition to retry with a new business key.

## After a successful proof

The proof does not enable the route. Route enablement separately requires the
two distinct fresh-MFA Ops principals, two recorded approvals, all provider and
legal evidence in `docs/launch-gates.md`, an explicit founder approval, and an
audited `DISABLED -> ENABLED` transition. The first 72 hours then require the
existing settlement/webhook/payout monitoring and a named incident owner. A
kill-switch change back to `DISABLED` is the immediate response to a material
money-path failure.
