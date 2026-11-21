# PR 232 Production GA checklist — planning only

This is a read-only release plan. No Production setting, migration, function, account, or data was changed. It is also posted on [PR #232](https://github.com/Drape-ltd/drapeon/pull/232#issuecomment-7066869595).

## Migration inventory

The 19 claim migration files on the stacked #216/#232 diff must be reconciled with Production history and Development's drift ledger before any promotion. No batch exceeds five migrations:

| Batch | Migration versions |
| --- | --- |
| Stage 1 (5/5) | `20261117212042`, `20261117212332`, `20261117212502`, `20261117212930`, `20261117213656` |
| Stage 2 (5/5) | `20261117225500`, `20261118015235`, `20261118021045`, `20261118023943`, `20261118034153` |
| Stage 3 (5/5) | `20261118190130`, `20261118190140`, `20261118190334`, `20261118194515`, `20261118203934` |
| Stage 4 (4/5) | `20261118212546`, `20261118220734`, `20261119010000`, `20261119044734` |

These are repo filenames, not authorization to apply them. Dry-run and compare installed objects before each batch. Do not rename an already-applied migration. Stage 2 installs `db_pre_request` ahead of every PostgREST request: prove anonymous, customer, tailor and service-role traffic still passes after installation. Keep its reviewed rollback command ready: `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`. Run the STAFF_DRAFT denial suite again.

## SMS and existing accounts

Read-only Production check recorded on #216/#232 on Nov 19–20: Termii-related secret **names** exist, but `PHONE_OTP_MODE` is absent. Current code defaults an absent mode to `bypass`. Audit had five `account.phone_otp_bypassed` events and no `account.phone_otp_sent` or `account.phone_otp_verified` events. Working provider credentials alone do not make phone verification enforced.

1. Approve the `Drapeon` sender and a Nigerian OTP/DND route, then prove real delivery on a Nigerian network. Carrier delivery is currently unproven. `dev_capture` is strictly Development-only and must not be selected in Production.
2. Review a separate Production setting change to `PHONE_OTP_MODE=enforced` only after the provider works. Do not bulk-mark existing numbers verified: customers and tailors who saved phones during bypass may have `phone_verified_at IS NULL`; the saved number is not ownership proof. Onboarding, profile edits and claim finalization that require verification must guide them through real OTP. Changing a phone clears its verification.
3. After enforcement, regress an anonymous session, existing customer, existing tailor, freshly claimed tailor and service role. Check onboarding/profile edits, one real OTP, and that the verified timestamp matches the number. Check live site and app data access after the request hook.
4. Only after those checks, run a separately approved GA test: fresh invite → email and Apple claim → real SMS → FINALIZE → LIVE → Explore, Ops and notification outcomes. Check the production website/Ops claim settings and a store client at version **1.0.4 or newer**.

The Production release of #213, any Production claim stage, and a merge of #216/#232 still require the founder's separate approval.
