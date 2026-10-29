# Phase 4 Bachs NGN live-readiness progress

This log records evidence for Phase 4. It is not authority to move money or
enable a route. Production writes, deployments, secrets, route rows,
enablement, and merges remain separately approved release units.

## Stage 0 — post-merge checks (2026-10-29)

- **Branch:** `codex/phase4-bachs-live`, created from `origin/main` at merge
  `c654fea0068998e00b28581a0559ba2d3d4600a0`. The prior Phase 3 worktree and
  its unrelated `deno.lock` edit were left untouched.
- **Edge parity:** the approved 41-function Production deployment ran from the
  reviewed branch head `288acd6cf0fa5106ed0ceb80a97e0b01a4c24571` between
  its 11:04 CDT commit and the 11:09 CDT evidence commit. The exact 41-function
  manifest is in `payments-phase3-production-release-plan.md`. A path-scoped
  `git diff --name-only 288acd6c c654fea0` across those 41 directories and
  `supabase/functions/_shared` returned no files. The merged source is therefore
  byte-identical for the deployed Edge scope.
- **Review range:** `git rev-list --count --first-parent
  750e23e5..fcc14a1e` returned 54. The post-merge review is in
  `payments-phase3-postmerge-review.md`.
- **Migration naming:** the two double-timestamp source files use applied
  versions `20261029131928` and `20261029132040` in both Dev and Production.
  Production names retain the double timestamp. Dev records only the suffix for
  both, so the history *names* are not identical even though the authoritative
  versions are. The first rollback also omits the embedded original timestamp;
  the second retains it. No history marker or filename was changed. The exact
  mapping and safe convention are documented in the post-merge review.
- **Route state:** no route was created or enabled during Stage 0.
- **Production writes:** none.

### Stage 0 commands/evidence

- `git diff --name-only 288acd6c c654fea0 -- <41 function dirs>
  supabase/functions/_shared` → empty.
- Supabase read-only migration inventories: Dev `pqptfuqogvrajozfsqzi` and
  Production `wkfsrunetmgjdtcurmoj`.
- `git diff --check` and documentation checks are run before the Stage 0 commit.

### Open operator gates

- Cloudflare dashboard branch/deployment controls must be checked by the account
  owner using this exact checklist:
  1. Workers & Pages → `drape` → Settings → Builds: Production branch is exactly
     `main`.
  2. Non-production branch builds are Preview builds only; they have no command,
     environment, or branch rule capable of deploying the Production Worker.
  3. Deployments → Production: the active version was built from merged `main`
     commit `c654fea0068998e00b28581a0559ba2d3d4600a0` (not PR-head
     `76021d8c`, `6d1471f0`, or another feature-branch SHA).
  4. The build command uses the repository's guarded build path and receives
     `WORKERS_CI_BRANCH=main`; no dashboard override bypasses it.
  5. Save screenshots of the Production-branch setting and active deployment
     SHA/version in the Phase 4 evidence pack. If any item differs, do not build
     or deploy; report the current value first.
- A second named Production Ops principal must be provisioned with independent
  MFA before any route-enable request. No account was created in Stage 0.

## Stage 1 — sandbox proof (blocked at 1.1 on 2026-10-29)

- Deployed a temporary token-gated, Dev-only probe to Supabase Dev
  `pqptfuqogvrajozfsqzi`. It used the existing server-side Bachs sandbox key and
  called only the three required `POST /v1/misc/bank-accounts/resolve` fixtures.
  No key or full account number was returned or logged.
- Results:
  - bank code `058`, fixture ending `6789`: `resolved=false`, no account name,
    message `Account resolution is not supported for country US`;
  - bank code `101`, fixture ending `6789`: the same result;
  - bank code `999`, fixture ending `2223`: the same result.
- **Gate result:** zero of three fixtures resolved. Stage 1.1 explicitly says to
  stop when none resolves, so no QA recipient submission, route row, checkout,
  transfer, withdrawal, refund, or failure-path test was attempted.
- **Root cause evidence:** the Bachs sandbox organization/API-key context still
  defaults reference resolution to `US`, matching the account-country issue
  reported during business registration. The NG onboarding corridor cannot be
  proved from this sandbox context until Bachs changes the sandbox platform
  country to Nigeria or provides an authorized NG sandbox fixture/account scope.
- The temporary function was replaced with an HTTP 410 responder and its probe
  token was removed from Dev after the evidence was captured. Production was
  untouched and every route remains disabled.

### Required external resolution

Ask Bachs to change Drapeon's **sandbox platform country/reference-data context
to Nigeria (`NG`)** or provide the account-scoping/header and an authorized NG
sandbox fixture that makes `POST /v1/misc/bank-accounts/resolve` resolve. Once
they confirm the change, repeat Stage 1.1 from the beginning. Do not use a real
personal bank account merely to bypass this failed sandbox gate.

