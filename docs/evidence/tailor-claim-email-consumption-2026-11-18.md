# Email claim consumption repair (development, 2026-11-18)

PR #216. Development project `pqptfuqogvrajozfsqzi` only. No production change.

The approved disposable web claim fixture `Web finish route check 2026-11-18` (invite `05c16a7b-19d6-4cac-a1ff-141488ab3cd5`) initially failed in `prepare_tailor_profile_claim_v1` with SQLSTATE `23514`. The function sets a verified email code to `CONSUMED`, but the existing `tailor_claim_email_codes_check1` required `verified_at` to be non-null only while status was `VERIFIED`. The transaction aborted before Auth handover.

Migration `20261119044734_allow_consumed_tailor_claim_email_code.sql` allows `VERIFIED` and `CONSUMED` rows to retain `verified_at`. It is a forward migration; no applied file was edited. Stage 4 is now **2/5 migrations**.

Proof:

- `scripts/test-tailor-claim-email-consumed-postgres.sh` passed on disposable Postgres 17. It first reproduced the old check failure, then applied the migration and proved verified-to-consumed succeeds while invalid timestamp/status combinations still fail.
- The tailor-claim email Postgres workflow now runs this proof on PRs and watches both the script and migration path.
- Because this migration was already applied to development, its file remains immutable. `supabase/tests/tailor_claim_email_consumed_preflight.sql` is a read-only guard to run immediately before applying it elsewhere; it stops with the observed constraint definition unless the exact original check is present. The fresh-Postgres proof runs the same guard before applying the migration.
- Development schema was inspected before the change. The migration was applied in one transaction and recorded under its canonical version `20261119044734`. Readback showed the new check and exactly one canonical history row.
- The same fixture was retried through the development web claim page. It reached **Your shop is claimed** with the desktop QR and store badges. Database readback: invite and profile `CLAIMED_AWAITING_EMAIL`, transition receipt `SUCCEEDED`, Auth handover recorded, and pickup postcode `NULL` for its Lagos address. This is a claim-only fixture, not a LIVE proof.

The private claim token, email code, test password, and full claim URL are omitted.
