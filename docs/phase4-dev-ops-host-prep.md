# Phase 4 Dev Ops host preparation

This branch adds a separate `drape-ops-dev` Worker configuration for
`ops-dev.drapeon.co` and a runtime guard that accepts only the Dev Supabase
project with both normal and sensitive Cloudflare Access audiences present.
The existing Production configuration remains pointed at Production.

## Deployment state

- No Dev Ops Worker, DNS route, or Access application has been created by this
  branch. No Production object has been changed.
- Wrangler's current Cloudflare account lists zero Access applications through
  the account API, while the existing Production Ops login is Access-protected.
  Its OAuth permission list does not include an Access management scope. The
  correct account and an Access-capable credential must be identified before
  creating the two Dev applications and policies.
- A Dev Edge secret-name check found the normal `CF_ACCESS_AUD` and team domain,
  but no `CF_ACCESS_SENSITIVE_AUD`. The Money Desk stays closed to independent
  sensitive approvals until that separate Dev audience is configured.
- The Dev Worker must not be deployed to its route until a normal Access app
  and a separate sensitive Access app protect the route. Both must allow only
  the two existing Ops identities, use One-time PIN with authenticator MFA,
  use 15-minute sessions, and have no bypass or service-token policy.
- After those apps exist, bind their distinct audiences and the Dev public
  Supabase key as Worker secrets. Bind the distinct audiences and team domain
  to the Dev Edge money gateways. Keep all values out of source and logs.
- Verify unauthenticated access is denied, a normal Access assertion cannot
  perform a sensitive action, and the two distinct fresh-MFA approvers can
  decide a synthetic Dev Money Desk request before testing a provider transfer.

## Focused checks

- Node 22 `apps/ops/scripts/runtime-boundary.test.mjs`: 15 passing, including
  Dev host/project isolation, missing-audience denial, and bootstrap denial.
- Node 22 `apps/ops/scripts/verify-dev-environment.mjs`: passing.
- Node 22 `apps/ops/scripts/verify-environment.mjs`: passing after pointing the
  existing CSP check at the module that now owns those directives.
- `git diff --check`: passing.

No approval has been simulated or inserted. The #269 recovery proof remains
stopped at the independent Access approval gate.
