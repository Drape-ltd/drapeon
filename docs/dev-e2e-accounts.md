# Dev E2E accounts

These accounts exist only in Supabase Dev (`pqptfuqogvrajozfsqzi`). Never use
them against Production, never promote their rows, and never commit passwords,
recovery codes, session tokens, identity documents, bank details, or provider
credentials.

## Verified tailor

- Email: `dimowoope+drapeon25@outlook.com`
- Purpose: authenticated web and mobile E2E checks for the verified/live tailor
  workspace, portfolio uploads, route availability, payout onboarding, earnings,
  withdrawals, and money-timeline presentation.
- State: verified and live in Dev. Tests must not change its trust decision or
  make it discoverable outside Dev.
- Access: use the normal Dev authentication/recovery flow. Keep the password in
  the owner's credential store, not in the repository, CI, logs, screenshots, or
  chat.

## Ops two-person fallback status

- `founders@drapeon.co` receives the development Cloudflare Access email code
  and remains the existing founder Ops identity.
- `founders+ops-qa@drapeon.co` did not receive an Access code, so it was not
  provisioned and must not be counted as an independent approver.
- The checked-in localhost `local-workforce` bridge is not evidence of real
  MFA: it selects one identity from environment variables and marks the signed
  development session MFA-verified. Do not use it for the two-person Money Desk
  regression.
- The approved fallback is implemented on `codex/dev-ops-supabase-mfa` and
  remains pending account enrollment: two distinct Dev Supabase Auth users,
  each with a separately verified TOTP factor, mapped by `auth.users.id` to
  distinct active development workforce principals.
- Start the local-only flow with `pnpm --filter @drape/ops dev:mfa`, then use
  `/local-mfa`. The gate also requires the exact Dev project ref and a
  non-production runtime. The flag is forbidden from every production build
  and deployed Worker.
- The two approved emails are `founders@drapeon.co` and
  `founders+ops-qa@drapeon.co`. The owner sets both passwords and enrolls both
  TOTP entries. No password, TOTP seed, recovery code, or session token belongs
  in this file.
- The QA principal row is not part of the schema migration. Required Dev order:
  apply `20261030133137`, run the rollback SQL test and retain its PASS output,
  run `supabase/verification/seed_dev_ops_mfa_principals.sql`, then create the
  two real Auth users and enroll their separate TOTP factors. The rollback test
  temporarily owns `founders@drapeon.co`, so it must run before either real Auth
  account exists. The seed checks the database-bound environment and exact Dev
  project ref inside the same `DO` block as its insert; never add it to a
  Production migration batch.
- Binding requires `auth.users.email_confirmed_at`. A password alone cannot bind
  an Auth user to workforce authority.

## Safety rules

- Confirm the active Supabase project is `pqptfuqogvrajozfsqzi` before login or
  fixture work.
- Provider calls must use sandbox/test credentials only. Stop if a response says
  live mode or if credential mode cannot be proven.
- Do not enable a Production payment route, notify real recipients, or move real
  money during E2E checks.
- Record test evidence and any durable fixture changes in the relevant phase
  progress log.
