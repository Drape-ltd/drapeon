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
- The approved fallback remains pending: two distinct Dev Supabase Auth users,
  each with a verified TOTP factor, mapped to distinct active development-only
  workforce principals. No password, TOTP seed, recovery code, or session token
  belongs in this file.

## Safety rules

- Confirm the active Supabase project is `pqptfuqogvrajozfsqzi` before login or
  fixture work.
- Provider calls must use sandbox/test credentials only. Stop if a response says
  live mode or if credential mode cannot be proven.
- Do not enable a Production payment route, notify real recipients, or move real
  money during E2E checks.
- Record test evidence and any durable fixture changes in the relevant phase
  progress log.
