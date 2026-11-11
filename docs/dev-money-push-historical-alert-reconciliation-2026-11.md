# Dev historical money-push alert reconciliation — proposed, not executed

## Scope and preflight

This one-off is proposed after #150 merges and its forward receipt worker passes live Dev proofs. It targets the seven recent `SEND_PUSH` jobs whose queue status is `SUCCEEDED` but durable `PUSH` outcome is `DEAD` after #137. Three were exposed by #137; four already had a dead outcome. The seven comprise three payment confirmations, two ordinary refund completions, one cancellation-refund completion, and one payout release. The classification is based on payload kind and preference, without exposing recipients or order IDs. It does not resend a customer notification or touch payment, payout, ledger, tax, or review state. Production is excluded.

The operator will use a service-role process pointed at Supabase Dev project `pqptfuqogvrajozfsqzi`, with its key supplied through the process environment only. Before any write it must verify `current_ops_environment() = DEVELOPMENT`, #137 exact migration version `20261110173730`, and the deployed #150 function version. A read-only selection must use the same `isMoneyPushPayload` classifier as #150, durable `PUSH/DEAD` outcome, `SEND_PUSH`, queue status `SUCCEEDED`, and a fixed reviewed cutoff covering the Nov 4–10 failures. It must return exactly seven distinct job IDs, with zero `money-push-delivery-dead:<job>` cases. The IDs and any linked order IDs stay in the private Ops ledger, not this public document. A changed count or existing mismatched case stops the run for review.

Seven older `paymentReleased` jobs with dead queue status from Sep 12 have no order link. They are outside this one-off. Classify their fixture provenance separately before deciding whether they need an Ops case.

## Reviewed execution design

Use #150's `reportDeadMoneyPushOutcomes` helper with the seven preflighted IDs and a distinct source label, `historical-money-push-reconciliation`. The dedupe key stays `money-push-delivery-dead:<job>`, shared with the live worker. The helper re-reads the durable outcome and job payload, links the job and order where present, and requests Ops notice. Do not insert `ops_issues` directly or invoke a customer notification resend. Keep the seven-ID selection fixed for the run; fail if the helper reports a different count. Expect seven Ops notices in one batch and check that the Ops delivery channel can handle them before execution.

Afterward, verify seven distinct open job-keyed issues, seven `ISSUE_CREATED` audit rows, and terminal outcomes for any Ops notice jobs. Replay the exact seven IDs: zero new issues, zero new `ISSUE_CREATED` rows, zero duplicate Ops notices. Check that notification outcomes, customer job count, payments, payouts and ledgers remain unchanged. Record role-based counts and the run time in the regression evidence. Stop on any count mismatch or failed Ops notice.

This document is a proposal only. After #150 is merged and proven on Dev, obtain the owner's explicit go-ahead for the seven-case Dev write. No reconciliation has run and no Production authorization is implied.
