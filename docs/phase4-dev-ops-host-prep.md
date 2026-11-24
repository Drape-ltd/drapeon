# Phase 4 Dev Ops host preparation

This branch adds a separate `drape-ops-dev` Worker configuration for
`ops-dev.drapeon.co` and a runtime guard that accepts only the Dev Supabase
project with both normal and sensitive Cloudflare Access audiences present.
The existing Production configuration remains pointed at Production.

## Deployment state

### 2026-11-24 Dev deployment

- The isolated `drape-ops-dev` Worker is deployed only at
  `ops-dev.drapeon.co/*`, backed by the Dev Supabase project. The hostname is
  proxied and unauthenticated requests are redirected to Cloudflare Access.
- Normal and sensitive Access audiences are configured only in Dev Edge
  secrets. No Production Worker, Access application, secret, route, or
  payment configuration changed.
- `WEB_PUSH_VAPID_PUBLIC_KEY` is intentionally not required by the isolated
  Dev Ops Worker: this proof host does not send notifications, and a missing
  VAPID key must not make Access or the Money Desk unavailable.

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

## Access creation and deployment sequence

1. Identify the Cloudflare account that owns the existing Production Ops Access
   application. The account currently selected by Wrangler returns no Access
   applications, so do not assume that it is the right account. Compare account
   IDs privately; record only a match or mismatch here.
2. In that account, create a **separate** self-hosted Access application for
   `ops-dev.drapeon.co/*`. Allow only the two existing Ops email identities.
   Permit One-time PIN as the login method and require Cloudflare independent
   authenticator-app MFA. Set both application and policy sessions to 15
   minutes. Do not add a bypass, service token, group, or other identity rule.
3. Create a second self-hosted application for
   `ops-dev.drapeon.co/ops/sensitive/*`, with a distinct audience and the same
   two identities, login and MFA requirements, and 15-minute sessions. Confirm
   this more specific application takes precedence over the general host app.
   Record application IDs and audiences only in the private deployment record.
4. Confirm DNS for the Dev hostname and the two Access applications are active
   **before** binding a Worker route. Build `apps/ops` with `cf:dev:build`,
   supplying `DRAPE_DEV_SUPABASE_PUBLIC_KEY` through the environment. That
   build selects `wrangler.dev.jsonc`, isolates local dotenv files, and checks
   the artifact for Production references and privileged key names. The
   existing `cf:build`/`cf:deploy` scripts are Production-only and must not be
   used for this build. Check the OpenNext artifact for Production project
   references, service-role values, and local bypass settings before deploy.
5. Deploy only the separate `drape-ops-dev` Worker. Set its normal and sensitive
   Access audiences, Dev public Supabase key, and web-push public key through
   Worker secrets. Set `CF_ACCESS_AUD`, `CF_ACCESS_SENSITIVE_AUD`, and
   `CF_ACCESS_TEAM_DOMAIN` on **Dev Edge only**. Do not copy Production secret
   values, and do not alter Production Worker, Access, or Edge settings.
6. Check denial before any money request: unauthenticated requests are stopped
   at Access; a normal Access token cannot reach sensitive pages or decide a
   Money Desk request; missing or stale MFA is denied. Then test a synthetic
   Dev request with two distinct fresh-MFA approvers and confirm the requester
   cannot approve. Keep the provider mutation gate off until these checks pass.

The narrow Cloudflare token for steps 1–3 needs **account-scoped `Access: Apps
and Policies Read` and `Access: Apps and Policies Write`** on the account that
owns the Ops Access configuration. Worker deployment additionally needs
`Workers Scripts Edit` on that account and `Workers Routes Edit` on the
`drapeon.co` zone. Create or change DNS only with a separate zone-scoped `DNS
Edit` grant if the hostname has no existing record. Scope the token to this
account/zone and a short expiry. The current Wrangler OAuth credential does not
have Access management permission; a token with these grants is not yet
available. Cloudflare documents these permission names in its API-token
permission reference and supports independent authenticator MFA at the Access
application/policy level.

## Focused checks

- Node 22 `apps/ops/scripts/runtime-boundary.test.mjs`: 15 passing, including
  Dev host/project isolation, missing-audience denial, and bootstrap denial.
- Node 22 `apps/ops/scripts/verify-dev-environment.mjs`: passing.
- Node 22 `apps/ops/scripts/verify-environment.mjs`: passing after pointing the
  existing CSP check at the module that now owns those directives.
- Node 22 `pnpm launch:contracts`: passing after an offline frozen-lockfile
  dependency install. An isolated `cf:dev:build` also passed using the Dev
  public key held only in the build process environment. Its generated client
  assets contain the Dev project reference and no Production project reference;
  the OpenNext runtime artifact contains no privileged key name. No Worker was
  deployed.
- `git diff --check`: passing.

No approval has been simulated or inserted. The #269 recovery proof remains
stopped at the independent Access approval gate.
