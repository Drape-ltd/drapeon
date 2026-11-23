# Security check — 2026-11-23

## Scope

Read-only Production catalogue/advisor review; no customer rows, secrets, routes,
payments, Edge deployments, or web deployments were changed.

## P0 remediation in this branch

Production exposed five `SECURITY DEFINER` mutation functions through PostgREST
RPC: `finalize_order_terminal` and both overloads of seller-item inventory
reserve/release. Their bodies accept caller-controlled identifiers and do not
perform caller authorization, so client roles must not execute them directly.

`20261123162913_revoke_public_security_definer_executes.sql` revokes `PUBLIC`,
`anon`, and `authenticated` execution and grants only `service_role`. The
service-role Edge and Ops callers remain supported. The companion SQL contract
asserts that all five signatures deny client roles, deny `PUBLIC`, and retain
service-role execution.

Dev was used to apply and verify the exact privilege-only migration. Its
migration-history marker was corrected to the source version without re-running
schema SQL. Production remains unchanged and needs a separately approved exact
version release.

## Follow-up security work

The advisor also reports other exposed `SECURITY DEFINER` routines, mutable
search paths, auth leaked-password protection disabled, and insufficient MFA
options. These are not bulk-changed here: each routine needs its own caller and
authorization review to avoid breaking legitimate public or authenticated RPCs.
