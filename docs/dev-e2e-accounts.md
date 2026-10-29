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

## Safety rules

- Confirm the active Supabase project is `pqptfuqogvrajozfsqzi` before login or
  fixture work.
- Provider calls must use sandbox/test credentials only. Stop if a response says
  live mode or if credential mode cannot be proven.
- Do not enable a Production payment route, notify real recipients, or move real
  money during E2E checks.
- Record test evidence and any durable fixture changes in the relevant phase
  progress log.
