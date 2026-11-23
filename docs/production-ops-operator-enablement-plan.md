# Production Ops operator enablement plan

## Status

**Planning only.** This document creates no user, workforce principal, role,
or permission. Production currently has three active workforce principals, but
none is permitted for `production`. Consequently, audited money, reliability,
and route-enablement actions must remain unavailable until the founder names
and approves at least two distinct operators.

The three stale `SEND_PUSH` jobs stay untouched. They must be closed through
the audited Ops workflow after operator enablement; they must not be deleted or
manually updated.

## Proposed minimum operating model

| Need | Minimum configuration | Why |
| --- | --- | --- |
| Two-person route enablement | Two distinct founder identities, each with a separate Production workforce principal | `payment_route_approvals` records one approver per row and links a workforce principal or Auth user. Distinct people/accounts are required for independent approval. |
| Money Desk review | Both principals receive `admin`; nominate one as the routine `finance` reviewer only if they will handle Money Desk cases | The active Production `money-desk` policy permits `finance` or `admin` for prepare/approve/execute/reconcile. `admin` is sufficient for the minimum founder pair without manufacturing a finance role. |
| Reliability actions | Both principals receive `admin`; nominate an `engineering` operator only if that person will own reliability incidents | The active `reliability` policy permits `engineering` or `admin` for recover/resolve. |
| Audit and revocation | Each principal uses an individual email and Auth subject, `ACTIVE` status, `production` in `permitted_environments`, review date, and a recorded creator | The principal table has fields for subject, status, roles, environments, review date, and revocation. Shared accounts do not satisfy dual control. |

The two named founders should not approve their own route request or act as both
the requester and the second approver. Each production action must retain the
existing issue/correlation ID, expected record version, idempotency key, action
receipt, and audit row.

## Required founder decision

Name the two individual founders/operators, their separate sign-in identities,
and which one (if any) should also carry the `finance` and/or `engineering`
role. Do not send credentials. The implementation can then be proposed as a
separate, exact Production change for approval.

## Approved implementation sequence — not yet executed

1. **Preflight (read-only):** confirm both Auth users exist, neither has a
   conflicting active Production principal, the current queue policies still
   permit the selected roles, and the two route approvers are distinct.
2. **Create principals (separate approved Production change):** create one
   `ops_workforce_principals` record per named person, with individual Auth
   subject/email, `ACTIVE`, `production` environment, least-privilege roles,
   access-review date, and the provisioning actor/reason. No shared mailbox or
   generic `ops@` identity.
3. **Validate access without money movement:** authenticate each operator,
   open a non-money Ops item, and prove actor attribution, role gate and audit
   receipt. Do not use a payment, refund, route, or provider action for this
   check.
4. **Dual-control proof:** create a non-production/Dev route-enable fixture;
   show the requester cannot satisfy both approvals, and that two distinct
   principals with evidence can. Keep all Production routes `DISABLED`.
5. **Postflight:** record principal IDs only (never email addresses) in the
   restricted Ops audit, verify the scheduled access-review date, and confirm
   revoke workflow invalidates the affected principal's sessions.
6. **Only then resolve stale notices:** create/link the proper reliability
   issue and close each stale `SEND_PUSH` job using
   `perform_ops_dead_job_review_action` with `STALE_NO_LINKED_PAYOUT_ATTEMPT`.
   Preserve the job, issue, action receipt, and audit record.

## Current evidence (read-only 2026-11-18)

- `ops_workforce_principals`: 3 total, 3 active, **0 active for Production**.
- `money-desk` allows `finance` or `admin`; `reliability` allows `engineering`
  or `admin`; all are scoped by the active Production queue policy.
- `perform_ops_dead_job_review_action(...)` is callable by `service_role`, not
  directly by browser roles. Its caller must supply the actor principal,
  expected record version, reason, idempotency key, environment, and
  correlation ID; this is why an audited Ops path rather than a direct job
  update is required.
- `payment_route_approvals` carries an approver ID or a workforce principal ID,
  evidence, reason, and a request/route reference. The application-level
  two-approver check must be proven as part of the Dev dual-control fixture.

## R1 natural-push observation

As of this read-only check, no new `SEND_PUSH` job has been created since the
R1 release. Therefore there is no natural terminal delivery outcome to report
yet. Do not manufacture a Production notification; observe and record the
first real terminal outcome when it arrives.
