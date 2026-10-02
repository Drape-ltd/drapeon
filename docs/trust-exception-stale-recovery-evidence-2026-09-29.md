# Stale waiver recovery

Date: 2026-09-29. Status: implemented and verified in Development; deployed to production. Protected live-case verification awaits a fresh Cloudflare authenticator challenge.

## Reported cause

Wearsbysafiyya's exception OPS-A9786E2B retained an older profile timestamp. A later setup save invalidated that snapshot. The supplied phone was repaired separately without claiming SMS verification. This recovery does not approve her waiver or fix the installed app's currency/video submission sequence.

## Scope

- Protected RPC wrapper adds READ snapshotStale and audited REFRESH; original approval/rejection and authority gates remain authoritative.
- Ops shows stale-state instructions, disables stale approval, and resets both review acknowledgements after refresh.
- Edge returns specific stale-profile, changed-case and missing-profile-evidence messages.
- Development-only session cookie now covers /api action handlers as well as /ops pages. Production never accepts the local workforce bridge. Existing logout expires both cookie paths.
- Applied Development migrations 20260929160000 and forward compatibility correction 20260929161000 are immutable. Production promotion must include only these reviewed migrations, not the pending backlog.

## Verification

Development target: pqptfuqogvrajozfsqzi. Disposable synthetic profile bc4d5c74-9648-4c57-b41d-74059deec2e3; case OPS-69D21106.

- Database rejected stale approval and refresh without review acknowledgements.
- Refresh replay recovered its receipt; profile remained not-live and not-verified after refresh.
- Connected in-app browser at localhost:3006 displayed the exact stale fixture and enabled only the review-gated refresh. Clicking refresh persisted success and reset both checkboxes; approval remained disabled.
- Separate database approval activated only the disposable Development profile. Approval replay recovered its receipt; terminal refresh was rejected.
- Deno policy/broker tests: 4 passed. Ops typecheck passed. Diff whitespace check passed.
- Development DB lint found no waiver-wrapper errors. It reported existing extensions.index_advisor missing hypopg_reset and update_account_currency_with_price_conversion text-versus-UUID equality errors. These are not repaired by this change and must not be described as clean database health.

## Production deployment

- The 2026-09-29 deployment record treated 20260929160000 and 20260929161000 as applied. A fresh 2026-10-02 direct production query returned no `supabase_migrations.schema_migrations` rows for those versions, 20260929162000, 20260929163000, or 20261002130000. Both active and snapshot waiver functions exist and the active function mentions `REFRESH`, so deployed SQL and migration history have diverged. Do not use the earlier history claim as promotion proof or mark versions applied without a function-by-function comparison.
- Deployed only `ops-trust-exception-action`; production version 5, active at 2026-09-29 15:51 UTC.
- Built the Ops Worker in an isolated checkout from committed base 4bb3567 with only the scoped waiver changes. Typecheck and OpenNext production build passed. Wrangler dry-run targeted `ops.drapeon.co` and project `wkfsrunetmgjdtcurmoj`.
- Deployed Worker `drape-ops`, version `075a9808-8483-4e73-b5b1-c50937d8a77a`.
- Live route loaded the correct Wearsbysafiyya profile and portfolio. After refresh, Cloudflare required a fresh six-digit authenticator challenge before protected case state could load. No approval action was taken. Complete the post-MFA stale warning/refresh check before claiming the production UI path is verified.

## Promotion gate

The exact Node 24 pnpm launch:contracts check in the shared worktree failed on unrelated mobile navigation code at apps/mobile/app/(customer)/index.tsx:417. This isolated release did not push to GitHub. Production was deployed directly from the isolated checkout after its own Ops typecheck, production build, and Wrangler dry run. Preserve the other task's edits.

Remaining: complete protected production READ/browser verification after the owner supplies the fresh authenticator code; review production database health. Real waiver approval remains a separate administrator decision. No email or push was sent by this work.
